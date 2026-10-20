import { JUMP_KINDS } from '../../constants.ts';
import { SC } from '../opcodes.ts';

/** Wire-level entity state; every field is an integer exactly as transmitted. */
export interface EntityState {
  id: number;
  /** Millimetres (int32). */
  x: number;
  y: number;
  z: number;
  /** uint16 quantized angle. */
  yaw: number;
  anim: number;
  animPhase: number;
  hp: number;
  /** bit 0: shield up (upper-body shield layer); bits 1-2: layered swing (1 left, 2 right, 3 air); bit 3: swing parity. */
  flags: number;
}

export const FIELD = {
  POS: 1 << 0,
  YAW: 1 << 1,
  ANIM: 1 << 2,
  HP: 1 << 3,
  FLAGS: 1 << 4,
} as const;
const FIELD_ALL = 0b1_1111;
/** Mask bits 5-6: the entity's update interval for this receiver (UPDATE_INTERVALS index). */
const INTERVAL_SHIFT = 5;
/** Mask bit 7: the position is an int16 millimetre delta from the baseline's (6 bytes, not 12). */
const POS_DELTA = 1 << 7;
/** Ticks between a remote entity's updates, by the code in its mask. */
export const UPDATE_INTERVALS = [1, 2, 4, 8] as const;

/**
 * How often a receiver hears about an entity (bandwidth, performance-testing.md): the nearest
 * eight and anything within 4 m (melee) every tick, then every 2, 4 and 8 ticks by rank, and
 * far ones (beyond 40 / 52 m) at 4 / 8 whatever their rank. With a handful of creatures around,
 * as in the original's levels, everything within 40 m stays at 20 Hz.
 */
export function updateInterval(rank: number, distance: number): number {
  if (distance < 4) return 1;
  let n = rank < 8 ? 1 : rank < 16 ? 2 : rank < 24 ? 4 : 8;
  if (distance > 52) n = 8;
  else if (distance > 40) n = Math.max(n, 4);
  return n;
}

export interface SnapshotHeader {
  serverTick: number;
  /** 0 = full snapshot; otherwise the client-acknowledged tick this delta is relative to. */
  baselineTick: number;
  lastProcessedInput: number;
  /** Receiving player's own vertical velocity, mm/s (needed to replay inputs mid-jump). */
  selfVelY: number;
  selfGrounded: boolean;
  /** Receiver's roll in progress (0 = none): direction 1-4 (ROLL_DIRS + 1) and ticks left. */
  selfRollDir: number;
  selfRollTicks: number;
  /** Receiver's jump: kind (0 none, else its ASM state JUMP_*), horizontal velocity (mm/s), distance (mm). */
  selfAirKind: number;
  selfAirVelX: number;
  selfAirVelZ: number;
  selfAirTravel: number;
  /** Receiver's jump: vertical distance travelled since take-off (mm). */
  selfAirRise: number;
  /** Receiver's locomotion clip: state (LOCO_*, 0 standing) and frame (quarter frames on the wire). */
  selfLocoState: number;
  selfLocoFrame: number;
}

/**
 * Header: op, serverTick u32, baseline age u8 (0 = full snapshot), lastProcessedInput u32, bits
 * (0 grounded, 1-5 rollDir, 6 jump block follows, 7 velY follows), rollTicks, locoState,
 * locoFrame, entity count u16; then velY i32 when moving vertically and the jump block (kind,
 * velX i32, velZ i32, travel u16, rise u16) when in the air: 16 bytes standing, 33 at most.
 */
const HEADER_BYTES = 16;
const HEADER_MAX_BYTES = HEADER_BYTES + 4 + 13;
const ENTITY_COUNT_AT = 14;
const HAS_AIR = 1 << 6;
const HAS_VEL_Y = 1 << 7;
/** Baselines further back than this cannot be named (the server keeps them within 20 ticks). */
export const MAX_SNAPSHOT_BASELINE_AGE = 255;
const ENTITY_MAX_BYTES = 5 + 1 + 12 + 2 + 2 + 2 + 1;

export function snapshotMaxBytes(entities: number, removed: number): number {
  return HEADER_MAX_BYTES + entities * ENTITY_MAX_BYTES + 2 + removed * 5;
}

/** The tick a snapshot is a delta against (0 = a full snapshot), to look its baseline up. */
export function snapshotBaselineTick(view: DataView): number {
  if (view.byteLength < HEADER_BYTES) return 0;
  const age = view.getUint8(5);
  return age === 0 ? 0 : view.getUint32(1, true) - age;
}

/** Unsigned LEB128 (entity ids: one byte below 128, two below 16384). */
function writeVarint(view: DataView, o: number, v: number): number {
  v >>>= 0;
  while (v >= 0x80) {
    view.setUint8(o++, (v & 0x7f) | 0x80);
    v >>>= 7;
  }
  view.setUint8(o++, v);
  return o;
}

/** Reads a varint at `at[0]` (advanced past it); null when it runs past `len` or over 32 bits. */
function readVarint(view: DataView, at: [number], len: number): number | null {
  let v = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    if (at[0] >= len) return null;
    const b = view.getUint8(at[0]++);
    v += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return v > 0xffffffff ? null : v;
  }
  return null;
}

const fitsInt16 = (d: number) => d >= -32768 && d <= 32767;

export function createEntityState(id = 0): EntityState {
  return { id, x: 0, y: 0, z: 0, yaw: 0, anim: 0, animPhase: 0, hp: 0, flags: 0 };
}

function changedMask(cur: EntityState, base: EntityState | undefined): number {
  if (!base) return FIELD_ALL;
  let m = 0;
  if (cur.x !== base.x || cur.y !== base.y || cur.z !== base.z) m |= FIELD.POS;
  if (cur.yaw !== base.yaw) m |= FIELD.YAW;
  if (cur.anim !== base.anim || cur.animPhase !== base.animPhase) m |= FIELD.ANIM;
  if (cur.hp !== base.hp) m |= FIELD.HP;
  if (cur.flags !== base.flags) m |= FIELD.FLAGS;
  return m;
}

/** What to write for one entity: its fields (vs the baseline) and its update interval. */
export interface SnapshotSend {
  mask: number;
  interval: number;
}

/**
 * Encodes SC_WORLD_SNAPSHOT. With a baseline, unchanged entities are omitted and entities
 * present in the baseline but absent from `current` are listed as removed. `plan` (the server's
 * per-receiver rate limiting) names the entities to write and their fields; without it every
 * entity that differs from the baseline is written. Fields left out must equal the baseline's.
 * `view` must hold at least snapshotMaxBytes(current.size, baseline?.size ?? 0) bytes.
 */
export function encodeSnapshot(
  view: DataView,
  header: SnapshotHeader,
  current: ReadonlyMap<number, EntityState>,
  baseline: ReadonlyMap<number, EntityState> | null,
  plan?: ReadonlyMap<number, SnapshotSend>,
): number {
  const age = baseline ? header.serverTick - header.baselineTick : 0;
  if (baseline && (age < 1 || age > MAX_SNAPSHOT_BASELINE_AGE)) throw new Error(`snapshot baseline ${age} ticks back`);
  const travel = Math.min(0xffff, Math.max(0, header.selfAirTravel | 0));
  const rise = Math.min(0xffff, Math.max(0, header.selfAirRise | 0));
  const air = (header.selfAirKind & 0xff) !== 0 || (header.selfAirVelX | 0) !== 0 || (header.selfAirVelZ | 0) !== 0 || travel !== 0 || rise !== 0;
  const velY = (header.selfVelY | 0) !== 0;
  view.setUint8(0, SC.WORLD_SNAPSHOT);
  view.setUint32(1, header.serverTick >>> 0, true);
  view.setUint8(5, age);
  view.setUint32(6, header.lastProcessedInput >>> 0, true);
  view.setUint8(10, (header.selfGrounded ? 1 : 0) | ((header.selfRollDir & 31) << 1) | (air ? HAS_AIR : 0) | (velY ? HAS_VEL_Y : 0));
  view.setUint8(11, header.selfRollTicks & 0xff);
  view.setUint8(12, header.selfLocoState & 0xff);
  view.setUint8(13, Math.min(255, Math.max(0, Math.round(header.selfLocoFrame * 4))));
  let o = HEADER_BYTES;
  if (velY) {
    view.setInt32(o, header.selfVelY | 0, true);
    o += 4;
  }
  if (air) {
    view.setUint8(o, header.selfAirKind & 0xff);
    view.setInt32(o + 1, header.selfAirVelX | 0, true);
    view.setInt32(o + 5, header.selfAirVelZ | 0, true);
    view.setUint16(o + 9, travel, true);
    view.setUint16(o + 11, rise, true);
    o += 13;
  }
  let count = 0;
  for (const e of current.values()) {
    const base = baseline?.get(e.id);
    const send = plan ? plan.get(e.id) : undefined;
    if (plan && !send) continue;
    let m = base ? (send ? send.mask : changedMask(e, base)) & FIELD_ALL : FIELD_ALL;
    if (m === 0) continue;
    const code = send ? Math.max(0, UPDATE_INTERVALS.indexOf(send.interval as 1)) : 0;
    m |= code << INTERVAL_SHIFT;
    const delta = !!base && (m & FIELD.POS) !== 0 && fitsInt16(e.x - base.x) && fitsInt16(e.y - base.y) && fitsInt16(e.z - base.z);
    if (delta) m |= POS_DELTA;
    o = writeVarint(view, o, e.id);
    view.setUint8(o, m);
    o += 1;
    if (m & FIELD.POS) {
      if (delta) {
        view.setInt16(o, e.x - base!.x, true);
        view.setInt16(o + 2, e.y - base!.y, true);
        view.setInt16(o + 4, e.z - base!.z, true);
        o += 6;
      } else {
        view.setInt32(o, e.x, true);
        view.setInt32(o + 4, e.y, true);
        view.setInt32(o + 8, e.z, true);
        o += 12;
      }
    }
    if (m & FIELD.YAW) { view.setUint16(o, e.yaw, true); o += 2; }
    if (m & FIELD.ANIM) { view.setUint8(o, e.anim); view.setUint8(o + 1, e.animPhase); o += 2; }
    if (m & FIELD.HP) { view.setUint16(o, e.hp, true); o += 2; }
    if (m & FIELD.FLAGS) { view.setUint8(o, e.flags); o += 1; }
    count++;
  }
  view.setUint16(ENTITY_COUNT_AT, count, true);

  const removedAt = o;
  o += 2;
  let removed = 0;
  if (baseline) {
    for (const id of baseline.keys()) {
      if (current.has(id)) continue;
      o = writeVarint(view, o, id);
      removed++;
    }
  }
  view.setUint16(removedAt, removed, true);
  return o;
}

/**
 * Decodes SC_WORLD_SNAPSHOT into `out` as a full world state (baseline + delta).
 * Returns null if the bytes are malformed or the delta references a baseline the caller lacks.
 * `sent`, when given, receives each entity written in this snapshot with its update interval
 * (an entity left out may be unchanged or only rate-limited: its value then is the baseline's).
 */
export function decodeSnapshot(
  view: DataView,
  baseline: ReadonlyMap<number, EntityState> | null,
  out: Map<number, EntityState>,
  sent?: Map<number, number>,
): SnapshotHeader | null {
  const len = view.byteLength;
  if (len < HEADER_BYTES + 2 || view.getUint8(0) !== SC.WORLD_SNAPSHOT) return null;
  const bits = view.getUint8(10);
  const header: SnapshotHeader = {
    serverTick: view.getUint32(1, true),
    baselineTick: snapshotBaselineTick(view),
    lastProcessedInput: view.getUint32(6, true),
    selfVelY: 0,
    selfGrounded: (bits & 1) === 1,
    selfRollDir: (bits >> 1) & 31,
    selfRollTicks: view.getUint8(11),
    selfAirVelX: 0,
    selfAirVelZ: 0,
    selfAirTravel: 0,
    selfAirKind: 0,
    selfLocoState: view.getUint8(12),
    selfLocoFrame: view.getUint8(13) / 4,
    selfAirRise: 0,
  };
  let o0 = HEADER_BYTES;
  if (bits & HAS_VEL_Y) {
    if (o0 + 4 > len) return null;
    header.selfVelY = view.getInt32(o0, true);
    o0 += 4;
  }
  if (bits & HAS_AIR) {
    if (o0 + 13 > len) return null;
    header.selfAirKind = view.getUint8(o0);
    header.selfAirVelX = view.getInt32(o0 + 1, true);
    header.selfAirVelZ = view.getInt32(o0 + 5, true);
    header.selfAirTravel = view.getUint16(o0 + 9, true);
    header.selfAirRise = view.getUint16(o0 + 11, true);
    o0 += 13;
  }
  if (header.selfAirKind !== 0 && !JUMP_KINDS.includes(header.selfAirKind)) return null;
  const base = header.baselineTick === 0 ? null : baseline;
  if (header.baselineTick !== 0 && !base) return null;

  out.clear();
  if (base) for (const [id, e] of base) out.set(id, { ...e });

  const count = view.getUint16(ENTITY_COUNT_AT, true);
  sent?.clear();
  const at: [number] = [o0];
  for (let i = 0; i < count; i++) {
    const id = readVarint(view, at, len);
    if (id === null || at[0] + 1 > len) return null;
    const m = view.getUint8(at[0]);
    at[0] += 1;
    const fields = m & FIELD_ALL;
    if (fields === 0) return null;
    const delta = (m & POS_DELTA) !== 0;
    if (delta && !(fields & FIELD.POS)) return null;
    let e = out.get(id);
    if (!e) {
      if (fields !== FIELD_ALL || delta) return null; // new entities must be sent in full
      e = createEntityState(id);
      out.set(id, e);
    }
    const need =
      (fields & FIELD.POS ? (delta ? 6 : 12) : 0) + (fields & FIELD.YAW ? 2 : 0) + (fields & FIELD.ANIM ? 2 : 0) +
      (fields & FIELD.HP ? 2 : 0) + (fields & FIELD.FLAGS ? 1 : 0);
    let o = at[0];
    if (o + need > len) return null;
    if (fields & FIELD.POS) {
      if (delta) {
        e.x += view.getInt16(o, true);
        e.y += view.getInt16(o + 2, true);
        e.z += view.getInt16(o + 4, true);
        o += 6;
      } else {
        e.x = view.getInt32(o, true);
        e.y = view.getInt32(o + 4, true);
        e.z = view.getInt32(o + 8, true);
        o += 12;
      }
    }
    if (fields & FIELD.YAW) { e.yaw = view.getUint16(o, true); o += 2; }
    if (fields & FIELD.ANIM) { e.anim = view.getUint8(o); e.animPhase = view.getUint8(o + 1); o += 2; }
    if (fields & FIELD.HP) { e.hp = view.getUint16(o, true); o += 2; }
    if (fields & FIELD.FLAGS) { e.flags = view.getUint8(o); o += 1; }
    at[0] = o;
    sent?.set(id, UPDATE_INTERVALS[(m >> INTERVAL_SHIFT) & 3]!);
  }

  if (at[0] + 2 > len) return null;
  const removed = view.getUint16(at[0], true);
  at[0] += 2;
  for (let i = 0; i < removed; i++) {
    const id = readVarint(view, at, len);
    if (id === null) return null;
    out.delete(id);
    sent?.delete(id);
  }
  if (at[0] !== len) return null;
  return header;
}

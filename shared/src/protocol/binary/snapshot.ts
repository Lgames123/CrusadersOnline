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
}

const HEADER_BYTES = 21;
const ENTITY_COUNT_AT = 19;
const ENTITY_MAX_BYTES = 4 + 1 + 12 + 2 + 2 + 2 + 1;

export function snapshotMaxBytes(entities: number, removed: number): number {
  return HEADER_BYTES + entities * ENTITY_MAX_BYTES + 2 + removed * 4;
}

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

/**
 * Encodes SC_WORLD_SNAPSHOT. With a baseline, unchanged entities are omitted and entities
 * present in the baseline but absent from `current` are listed as removed.
 * `view` must hold at least snapshotMaxBytes(current.size, baseline?.size ?? 0) bytes.
 */
export function encodeSnapshot(
  view: DataView,
  header: SnapshotHeader,
  current: ReadonlyMap<number, EntityState>,
  baseline: ReadonlyMap<number, EntityState> | null,
): number {
  view.setUint8(0, SC.WORLD_SNAPSHOT);
  view.setUint32(1, header.serverTick >>> 0, true);
  view.setUint32(5, baseline ? header.baselineTick >>> 0 : 0, true);
  view.setUint32(9, header.lastProcessedInput >>> 0, true);
  view.setInt32(13, header.selfVelY | 0, true);
  view.setUint8(17, (header.selfGrounded ? 1 : 0) | ((header.selfRollDir & 7) << 1));
  view.setUint8(18, header.selfRollTicks & 0xff);
  let o = HEADER_BYTES;
  let count = 0;
  for (const e of current.values()) {
    const m = changedMask(e, baseline?.get(e.id));
    if (m === 0) continue;
    view.setUint32(o, e.id >>> 0, true);
    view.setUint8(o + 4, m);
    o += 5;
    if (m & FIELD.POS) {
      view.setInt32(o, e.x, true);
      view.setInt32(o + 4, e.y, true);
      view.setInt32(o + 8, e.z, true);
      o += 12;
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
      view.setUint32(o, id >>> 0, true);
      o += 4;
      removed++;
    }
  }
  view.setUint16(removedAt, removed, true);
  return o;
}

/**
 * Decodes SC_WORLD_SNAPSHOT into `out` as a full world state (baseline + delta).
 * Returns null if the bytes are malformed or the delta references a baseline the caller lacks.
 */
export function decodeSnapshot(
  view: DataView,
  baseline: ReadonlyMap<number, EntityState> | null,
  out: Map<number, EntityState>,
): SnapshotHeader | null {
  const len = view.byteLength;
  if (len < HEADER_BYTES + 2 || view.getUint8(0) !== SC.WORLD_SNAPSHOT) return null;
  const header: SnapshotHeader = {
    serverTick: view.getUint32(1, true),
    baselineTick: view.getUint32(5, true),
    lastProcessedInput: view.getUint32(9, true),
    selfVelY: view.getInt32(13, true),
    selfGrounded: (view.getUint8(17) & 1) === 1,
    selfRollDir: (view.getUint8(17) >> 1) & 7,
    selfRollTicks: view.getUint8(18),
  };
  if ((view.getUint8(17) & ~0b1111) !== 0 || ((view.getUint8(17) >> 1) & 7) > 4) return null;
  const base = header.baselineTick === 0 ? null : baseline;
  if (header.baselineTick !== 0 && !base) return null;

  out.clear();
  if (base) for (const [id, e] of base) out.set(id, { ...e });

  const count = view.getUint16(ENTITY_COUNT_AT, true);
  let o = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    if (o + 5 > len) return null;
    const id = view.getUint32(o, true);
    const m = view.getUint8(o + 4);
    o += 5;
    if ((m & ~FIELD_ALL) !== 0 || m === 0) return null;
    let e = out.get(id);
    if (!e) {
      if (m !== FIELD_ALL) return null; // new entities must be sent in full
      e = createEntityState(id);
      out.set(id, e);
    }
    const need =
      (m & FIELD.POS ? 12 : 0) + (m & FIELD.YAW ? 2 : 0) + (m & FIELD.ANIM ? 2 : 0) +
      (m & FIELD.HP ? 2 : 0) + (m & FIELD.FLAGS ? 1 : 0);
    if (o + need > len) return null;
    if (m & FIELD.POS) {
      e.x = view.getInt32(o, true);
      e.y = view.getInt32(o + 4, true);
      e.z = view.getInt32(o + 8, true);
      o += 12;
    }
    if (m & FIELD.YAW) { e.yaw = view.getUint16(o, true); o += 2; }
    if (m & FIELD.ANIM) { e.anim = view.getUint8(o); e.animPhase = view.getUint8(o + 1); o += 2; }
    if (m & FIELD.HP) { e.hp = view.getUint16(o, true); o += 2; }
    if (m & FIELD.FLAGS) { e.flags = view.getUint8(o); o += 1; }
  }

  if (o + 2 > len) return null;
  const removed = view.getUint16(o, true);
  o += 2;
  if (o + removed * 4 !== len) return null;
  for (let i = 0; i < removed; i++) {
    out.delete(view.getUint32(o, true));
    o += 4;
  }
  return header;
}

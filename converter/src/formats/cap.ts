import { explode } from './dcl.ts';
import { capTypeTable, parseStory, type CapStory } from './cap_story.ts';

/**
 * Level object placements (`Caps/*.cap`), asset-format-discovery.md §6.2. Header: u32
 * uncompressed size, magic 0xD00D0012 at +8, the level mesh name at +0x34 (e.g. "Ca_a" for
 * Meshes/Ca_a.msh); one PKWARE DCL stream at 0x94 holds the object records. Only creature
 * records are decoded here: marker 2D 00 00 00 CD CD CD CD, type id at +0x1C, instance name at
 * +0x40, and fields relative to the "XP block" (02 00 00 00 | xp | 0 0 0 | disposition x2):
 *   -0x200 position (3 x float32), -0x1B8 max HP, -0x118 11 resist factors, +4 XP, +20 disposition.
 */
export class CapError extends Error {}

export interface CapCreature {
  type: number;
  name: string;
  /** Original units and axes (left-handed; mirror Z for glTF space). */
  position: [number, number, number];
  hp: number;
  xp: number;
  disposition: number;
  resist: number[];
  /** Facing (the transform's third row, x and z), original axes. */
  facing: [number, number];
  /**
   * What it holds: the items in the inventory slots its inventory header (XP block - 0x10)
   * names as weapon (+0x0A) and shield (+0x0C). The cap is the creature as the level editor
   * left it, so this replaces the type template's loadout (Captain Ursan holds nothing).
   */
  held: { weapon?: string; shield?: string };
  /** Everything it carries (inventory slots of 0x44 bytes: count +0x10, item name +0x24). */
  items: { name: string; quantity: number }[];
  /** Its talk line (stats +0x1E4, Sound.ctx id), played by the use key (0x408980); hostiles cry it on noticing. */
  talk?: number;
  /** ASM state it plays while its line lasts (idle behaviour +0x3C, read by 0x40E8C0; 1..0x80). */
  gesture?: number;
  /**
   * Idle behaviour (stats +0x1DC): kind 0 stands; kinds 1 and 3 walk a path (0x405AC0): pause
   * at each point (ms), back and forth unless `loop` (then from the last point to the first).
   * Points in original units and axes.
   */
  path?: { kind: number; points: [number, number, number][]; pause: number; loop: boolean };
}

export type CapObjectKind = 'prop' | 'item' | 'sprite' | 'chest' | 'flag';

/** Non-creature level object (asset-format-discovery.md §6.4). */
export interface CapObject {
  kind: CapObjectKind;
  name: string;
  /** models.ctx model id (render component +0x18). */
  modelId: number;
  /** Original units and axes. */
  position: [number, number, number];
  /** Row-major 3x3 rotation, original axes. */
  rotation: number[];
  /** Props with hit points can be destroyed; 0 = indestructible. */
  hp: number;
  /** Ground items: item name and quantity (gold pieces use the quantity). */
  item?: { name: string; quantity: number };
  /** Chests: contained items. */
  contents?: { name: string; quantity: number }[];
  /** Sprites: effect name, e.g. "TORCHFIRE". */
  effect?: string;
}

/**
 * Level exit (asset-format-discovery.md §6.2.2): trigger position and the act it leads to. The
 * arrival point in the destination is that act's portal leading back here.
 */
export interface CapPortal {
  /** Exit number within the level (low half of the record's +4 word). */
  exit: number;
  /** Destination act, as written (e.g. "Ca1b"; compare case-insensitively). */
  target: string;
  /** Original units and axes. */
  position: [number, number, number];
  /** Flag 8 of the record (-0x2C): a door exit, used rather than walked into (cell doors, inns, gates). */
  use: boolean;
  /** Trigger volume: a convex x/z polygon (original units) between two heights, when linked. */
  trigger?: { polygon: [number, number][]; yMin: number; yMax: number };
  /**
   * The exit trigger (type 0x13) the record is embedded in, at -0x34: its entry number (+0x0F;
   * arriving through exit n lands at the entry n) and flags (+0x0E: 2 = arrive at the
   * destination's start point `exit`, 4 = arrive at this point without the crossing offset).
   */
  entry: number;
  flags: number;
}

export interface CapLevel {
  /** Mesh file base name, e.g. "Ca_a". */
  mesh: string;
  creatures: CapCreature[];
  objects: CapObject[];
  portals: CapPortal[];
  /**
   * Music: header byte +0x1C (the engine's level struct is this header; its CD player plays
   * redbook track value + 1, track 1 being data). 0 = none; the GOG release ships track N as
   * Music/N.mp3.
   */
  music: number;
  /** Moving level pieces ("brushes": doors, gates, levers, bridges, wheels...). */
  brushes: CapBrush[];
  /** Triggers, scripted sequences (cutscenes) and their cameras (cap_story.ts). */
  story: CapStory;
  /** Drake's start points (type 0x06); a new game puts him at the first. */
  starts: CapStart[];
}

/**
 * A start point: the type-0x06 object points to header +0x20 records of 7 dwords (x, y, z,
 * three angles in degrees, 1). The level load (0x476F20) copies the first to the player on a new
 * game: angles [0] -> +0x1CC, [1] -> +0x1C8, [2] -> +0x1D0, set as (pitch, heading, roll).
 */
export interface CapStart {
  /** Original units and axes (feet). */
  position: [number, number, number];
  /** Pitch, heading (D3D: facing (sin, cos) in x, z), roll; degrees. */
  angles: [number, number, number];
}

/**
 * A brush object (class 0x31): a named convex piece of level geometry with its own vertices
 * (world units, not mirrored), e.g. bDoorE_2 = an 8 x 14 x 1 ft slab. The first vertex is its
 * pivot; faces follow as planes and index lists (not read: the pieces are convex).
 */
export interface CapBrush {
  name: string;
  points: [number, number, number][];
  faces: CapBrushFace[];
  /** Its keyframe mover, when the record has one (doors, gates, levers, lifts...). */
  motion?: CapBrushMotion;
  /**
   * Sound actions placed at its turn centre (Sound.ctx ids): what the use key plays on the door
   * (the door opening sound; one door also has a guard's line).
   */
  sounds?: number[];
}

/**
 * A brush's keyframe mover (object +0x4C -> a 0x230-byte record; update 0x48EFC0): mode flags
 * (+0x100: low 3 bits the end-of-path mode, 8 = return after the delay, 0x2000 = eased speed),
 * key count (+0x105), starting key (+0x106), delay before returning (+0x11E, ms), and three arrays:
 * segment types (+0x120, a byte per key: low 3 bits = move by (dx, dy, dz), 0x08 / 0x10 / 0x20 =
 * turn about X / Y / Z), keys (+0x124, three floats per key: the move, or degrees and the turn
 * centre (y, z) / (x, z) / (x, y)) and speeds (+0x128, 2 x count floats:
 * progress per ms at the ends and, eased, at the middle of a segment).
 */
export interface CapBrushMotion {
  flags: number;
  start: number;
  delayMs: number;
  types: number[];
  keys: [number, number, number][];
  speeds: number[];
}

/** One textured polygon of a brush: texture, indices into `points`, texel coordinates per vertex. */
export interface CapBrushFace {
  texture: string;
  indices: number[];
  /** U.(X - P), V.(X - P) per vertex, in texture units (one picture every 15). */
  texels: number[];
}

/**
 * A creature's held items, talk line and idle behaviour, from its stats object (base = the XP
 * block - 0x1C0, executable-analysis.md §18): inventory header at +0x1B0, idle behaviour pointer
 * +0x1DC, talk line +0x1E4.
 */
function creatureExtras(data: Uint8Array, dv: DataView, x: number): Pick<CapCreature, 'held' | 'items' | 'talk' | 'gesture' | 'path'> {
  const inRange = (o: number, n: number) => o >= 0 && o + n <= data.length;
  const ptr = (o: number) => dv.getUint32(o, true) - CAP_BASE;
  const text = (o: number) => {
    let e = o;
    while (e < data.length && e - o < 0x20 && data[e] !== 0) e++;
    return new TextDecoder('latin1').decode(data.subarray(o, e)).trim();
  };
  const items: CapCreature['items'] = [];
  const held: CapCreature['held'] = {};
  const h = x - 0x10;
  const slots = ptr(h + 4);
  const count = data[h + 9]!;
  if (count > 0 && count <= 16 && inRange(slots, 0x44 * count)) {
    for (let i = 0; i < count; i++) items.push({ name: text(slots + 0x44 * i + 0x24), quantity: Math.max(1, dv.getInt32(slots + 0x44 * i + 0x10, true)) });
    const weapon = data[h + 0x0a]!;
    const shield = data[h + 0x0c]!;
    if (weapon < count && items[weapon]!.name) held.weapon = items[weapon]!.name;
    if (shield < count && items[shield]!.name) held.shield = items[shield]!.name;
  }
  const out: ReturnType<typeof creatureExtras> = { held, items: items.filter((i) => i.name) };
  const talk = dv.getInt32(x + 0x24, true);
  if (talk >= 0 && talk < 0x10000) out.talk = talk;
  const b = ptr(x + 0x1c);
  if (inRange(b, 0x40)) {
    const gesture = dv.getInt32(b + 0x3c, true);
    if (gesture > 0 && gesture <= 0x80) out.gesture = gesture;
    const kind = dv.getUint32(b, true);
    const n = dv.getUint32(b + 4, true);
    const steps = ptr(b + 8);
    // Steps are typed arguments (8 bytes: type, value +4): [int pause ms, int mode, 0x10 path].
    if ((kind === 1 || kind === 3) && n > 2 && n < 16 && inRange(steps, 8 * n) && data[steps + 0x10] === 0x10) {
      const p = ptr(steps + 0x14);
      const np = inRange(p, 0x10) ? dv.getInt32(p + 8, true) : 0;
      const pts = np > 0 ? ptr(p + 0x0c) : -1;
      if (np > 1 && np < 256 && inRange(pts, 12 * np)) {
        const points: [number, number, number][] = [];
        for (let i = 0; i < np; i++) points.push([0, 4, 8].map((k) => Math.round(dv.getFloat32(pts + 12 * i + k, true) * 1000) / 1000) as [number, number, number]);
        const pause = data[steps] === 0x0a ? dv.getInt32(steps + 4, true) : 1000;
        // 0x405FF0: past the last point, a mode int under 1 starts over at the first; else it turns back.
        const loop = data[steps + 8] === 0x0a && dv.getInt32(steps + 0x0c, true) < 1;
        if (points.flat().every(Number.isFinite)) out.path = { kind, points, pause, loop };
      }
    }
  }
  return out;
}

/** Object class (record +0x00) -> kind. 0x2D = creature. */
const OBJECT_CLASSES: Readonly<Record<number, CapObjectKind>> = { 0x34: 'prop', 0x35: 'item', 0x36: 'sprite', 0x38: 'chest', 0x3a: 'flag' };
export const CAP_BASE = 0x08000000;

const HEADER_BYTES = 0x94;

/**
 * `itemNames` (items.ctx names, e.g. from rules/items.json) lets chest contents be recognised;
 * without it chests are returned with empty contents.
 */
export function parseCap(bytes: Uint8Array, itemNames: ReadonlySet<string> = new Set()): CapLevel {
  if (bytes.length < HEADER_BYTES + 2) throw new CapError('file too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8, true) !== 0xd00d0012) throw new CapError('not a placement file (bad magic)');
  let e = 0x34;
  while (e < 0x74 && bytes[e] !== 0) e++;
  const mesh = new TextDecoder('latin1').decode(bytes.subarray(0x34, e));
  const { data } = explode(bytes, HEADER_BYTES, view.getUint32(0, true));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const f32 = (o: number) => dv.getFloat32(o, true);
  const creatures: CapCreature[] = [];
  /** Creature record offset -> index in `creatures` (the story layer names actors by record). */
  const creatureAt = new Map<number, number>();
  const objects = parseObjects(data, dv, itemNames);
  for (let a = 0; a + 0x400 < data.length; a++) {
    if (data[a] !== 0x2d || data[a + 1] !== 0 || data[a + 4] !== 0xcd || dv.getUint32(a, true) !== 0x2d || dv.getUint32(a + 4, true) !== 0xcdcdcdcd) continue;
    const type = dv.getUint32(a + 0x1c, true);
    let n = a + 0x40;
    while (n < a + 0x80 && data[n]! >= 0x20 && data[n]! < 0x7f) n++;
    const name = new TextDecoder('latin1').decode(data.subarray(a + 0x40, n));
    // XP block within the record.
    let x = -1;
    for (let o = a + 0x200; o < a + 0x320; o++) {
      if (dv.getUint32(o, true) === 2 && dv.getUint32(o + 8, true) === 0 && dv.getUint32(o + 12, true) === 0 && dv.getUint32(o + 16, true) === 0) {
        x = o;
        break;
      }
    }
    if (x < 0) continue;
    const position: [number, number, number] = [f32(x - 0x200), f32(x - 0x1fc), f32(x - 0x1f8)];
    if (!position.every(Number.isFinite)) continue;
    const resist: number[] = [];
    for (let i = 0; i < 11; i++) resist.push(Math.round(f32(x - 0x118 + 4 * i) * 1000) / 1000);
    // The transform's 3x3 rotation sits just before the position; its third row is the facing.
    const facing: [number, number] = [f32(x - 0x200 - 0xc), f32(x - 0x200 - 0x4)];
    creatureAt.set(a, creatures.length);
    const npc = creatureExtras(data, dv, x);
    creatures.push({
      ...npc,
      type,
      name,
      position,
      hp: f32(x - 0x1b8),
      xp: dv.getInt32(x + 4, true),
      disposition: dv.getInt32(x + 20, true),
      resist,
      facing: facing.every(Number.isFinite) ? [Math.round(facing[0] * 1e4) / 1e4, Math.round(facing[1] * 1e4) / 1e4] : [0, 1],
    });
    a = x;
  }
  const exitAt = new Map<number, { target: string; exit: number }>();
  const portals = parsePortals(data, dv, exitAt);
  const types = capTypeTable(data, dv, view.getUint32(0, true), view.getUint32(4, true));
  const story = parseStory(data, dv, types, { creatureAt, exitAt, parseVolume: (at) => parseTrigger(data, dv, at) ?? null });
  return { mesh, creatures, objects, portals, music: bytes[0x1c] ?? 0, brushes: parseBrushes(data, dv), story, starts: parseStarts(dv, types, view.getUint32(0x20, true)) };
}

function parseStarts(dv: DataView, types: ReadonlyMap<number, number[]>, count: number): CapStart[] {
  const at = types.get(0x06)?.[0];
  if (at === undefined || count > 64) return [];
  const out: CapStart[] = [];
  for (let i = 0; i < count && at + 28 * i + 24 <= dv.byteLength; i++) {
    const f = (k: number) => Math.round(dv.getFloat32(at + 28 * i + 4 * k, true) * 1000) / 1000;
    const s: CapStart = { position: [f(0), f(1), f(2)], angles: [f(3), f(4), f(5)] };
    if (![...s.position, ...s.angles].every(Number.isFinite)) break;
    out.push(s);
  }
  return out;
}

/**
 * Portal record: [pointer to its own name at +0x20][0xFFFF0000 | exit][...][+0x10 position]
 * [+0x20 NUL-terminated destination act name].
 */
function parsePortals(data: Uint8Array, dv: DataView, exitAt?: Map<number, { target: string; exit: number }>): CapPortal[] {
  const out: CapPortal[] = [];
  for (let o = 0; o + 0x30 < data.length; o++) {
    if (dv.getUint32(o, true) !== CAP_BASE + o + 0x20 || dv.getUint16(o + 6, true) !== 0xffff) continue;
    const target = ascii(data, o + 0x20, 24);
    if (!/^[A-Za-z]{2}[A-Za-z0-9_-]{1,20}$/.test(target) || data[o + 0x20 + target.length] !== 0) continue;
    const position: [number, number, number] = [dv.getFloat32(o + 0x10, true), dv.getFloat32(o + 0x14, true), dv.getFloat32(o + 0x18, true)];
    if (!position.every((v) => Number.isFinite(v) && Math.abs(v) < 1e5)) continue;
    const trigger = parseTrigger(data, dv, dv.getUint32(o - 0x30, true) - CAP_BASE);
    const use = (dv.getUint32(o - 0x2c, true) & 8) !== 0;
    exitAt?.set(o, { target, exit: dv.getUint16(o + 4, true) });
    out.push({ exit: dv.getUint16(o + 4, true), target, position, use, entry: data[o - 0x34 + 0xf]!, flags: data[o - 0x34 + 0xe]!, ...(trigger ? { trigger } : {}) });
  }
  return out;
}

/**
 * A portal's trigger volume (pointed to from the portal record at -0x30): two horizontal
 * planes [normal xyz][d] at +0x00 / +0x10 bounding the height, an edge list pointer at +0x20
 * and the edge count at +0x35; each edge is [x1 z1 x2 z2][outward normal x z][length]
 * (0x1C bytes). E.g. Du1b -> Es1a: a 240 x 24 ft rectangle from y 944 to 1216 ft.
 */
function parseTrigger(data: Uint8Array, dv: DataView, at: number): CapPortal['trigger'] | null {
  if (at <= 0 || at + 0x40 > data.length) return null;
  const f = (o: number) => dv.getFloat32(o, true);
  const heights: number[] = [];
  for (const p of [at, at + 0x10]) {
    const ny = f(p + 4);
    if (Math.abs(Math.abs(ny) - 1) > 1e-3 || Math.abs(f(p)) > 1e-3 || Math.abs(f(p + 8)) > 1e-3) return null;
    heights.push(-f(p + 12) / ny);
  }
  const edges = dv.getUint32(at + 0x20, true) - CAP_BASE;
  const count = data[at + 0x35]!;
  if (count < 3 || count > 32 || edges <= 0 || edges + count * 0x1c > data.length) return null;
  const polygon: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const e = edges + i * 0x1c;
    const x1 = f(e), z1 = f(e + 4);
    const prev = i ? edges + (i - 1) * 0x1c : edges + (count - 1) * 0x1c;
    // Edges chain end to start.
    if (Math.abs(f(prev + 8) - x1) > 0.5 || Math.abs(f(prev + 12) - z1) > 0.5) return null;
    polygon.push([x1, z1]);
  }
  return { polygon, yMin: Math.min(...heights), yMax: Math.max(...heights) };
}

/**
 * Brush records: [0x31][...][3F 00 00 00][02 00 00 00], name pointer at +0x14; after the name a
 * transform, then [vertex count u32][face count u32][pointer][0] and the vertex array (3 x f32 each).
 */
function parseBrushes(data: Uint8Array, dv: DataView): CapBrush[] {
  const out: CapBrush[] = [];
  let pointers: Map<number, number[]> | null = null;
  for (let a = 0; a + 0x40 < data.length; a++) {
    if (data[a] !== 0x31 || data[a + 1] !== 0 || data[a + 2] !== 0 || data[a + 3] !== 0) continue;
    if (dv.getUint32(a + 8, true) !== 0x3f || dv.getUint32(a + 12, true) !== 2) continue;
    const np = dv.getUint32(a + 0x14, true) - CAP_BASE;
    if (np <= a || np >= data.length) continue;
    const name = ascii(data, np, 40);
    if (!/^b[A-Za-z0-9_]+$/.test(name)) continue;
    for (let o = np + name.length; o + 12 < Math.min(data.length, np + 0x200); o++) {
      const nv = dv.getUint32(o, true);
      const nf = dv.getUint32(o + 4, true);
      const ptr = dv.getUint32(o + 8, true);
      if (nv < 4 || nv > 512 || nf < 4 || nf > 512 || ptr < CAP_BASE || ptr > CAP_BASE + data.length) continue;
      if (dv.getUint32(o + 12, true) !== 0) continue;
      const v0 = o + 16;
      if (v0 + nv * 12 > data.length) continue;
      const points: [number, number, number][] = [];
      for (let i = 0; i < nv; i++) points.push([dv.getFloat32(v0 + i * 12, true), dv.getFloat32(v0 + i * 12 + 4, true), dv.getFloat32(v0 + i * 12 + 8, true)]);
      const ok = points.every((p) => p.every((v) => Number.isFinite(v) && Math.abs(v) < 1e5)) &&
        points.every((p) => Math.hypot(p[0] - points[0]![0], p[1] - points[0]![1], p[2] - points[0]![2]) < 400);
      if (!ok) continue;
      const motion = parseBrushMotion(data, dv, a - 0x18);
      const sounds = motion ? hingeSounds(data, dv, (pointers ??= pointerIndex(data, dv)), motion) : [];
      out.push({ name, points, faces: parseBrushFaces(data, dv, ptr - CAP_BASE, nf, points), ...(motion ? { motion } : {}), ...(sounds.length ? { sounds } : {}) });
      break;
    }
  }
  return out;
}

/** Every offset holding a pointer into the act, by the offset it points to. */
function pointerIndex(data: Uint8Array, dv: DataView): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (let o = 0; o + 4 <= data.length; o++) {
    const p = dv.getUint32(o, true) - CAP_BASE;
    if (p < 0 || p >= data.length) continue;
    let list = index.get(p);
    if (!list) index.set(p, (list = []));
    list.push(o);
  }
  return index;
}

/**
 * Sound actions (runtime vtable 0x4E1D58, fired by 0x461430 / played at 0x461500 through
 * 0x4B13C0) whose position list (+0x40, x y z per entry) starts at a turning mover's centre:
 * Sound.ctx id at +0x34, volume at +0x44 (1.0).
 */
function hingeSounds(data: Uint8Array, dv: DataView, pointers: Map<number, number[]>, m: CapBrushMotion): number[] {
  if (!m.types.every((t) => t & 0x10)) return [];
  const [, cx, cz] = m.keys[0]!;
  const ids: number[] = [];
  for (const [at, refs] of pointers) {
    if (at + 12 > data.length || Math.abs(dv.getFloat32(at, true) - cx) > 0.01 || Math.abs(dv.getFloat32(at + 8, true) - cz) > 0.01) continue;
    for (const ref of refs) {
      const a = ref - 0x40;
      if (a < 0 || a + 0x48 > data.length || dv.getFloat32(a + 0x44, true) !== 1) continue;
      const id = dv.getUint16(a + 0x34, true);
      if (id > 0 && id < 4096 && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** The mover of the brush object at `obj` (its class-0x31 record is at +0x18), if any. */
function parseBrushMotion(data: Uint8Array, dv: DataView, obj: number): CapBrushMotion | undefined {
  if (obj < 0 || obj + 0x50 > data.length) return undefined;
  const ptr = (o: number) => dv.getUint32(o, true) - CAP_BASE;
  const mv = ptr(obj + 0x4c);
  if (mv <= obj || mv + 0x230 > data.length) return undefined;
  const count = dv.getInt8(mv + 0x105);
  const start = dv.getInt8(mv + 0x106);
  const types = ptr(mv + 0x120);
  const keys = ptr(mv + 0x124);
  const speeds = ptr(mv + 0x128);
  if (count < 1 || count > 32 || start < 0 || start >= count) return undefined;
  if (types < 0 || types + count > data.length || keys < 0 || keys + 12 * count > data.length || speeds < 0 || speeds + 8 * count > data.length) return undefined;
  const f32 = (o: number) => Math.round(dv.getFloat32(o, true) * 1e4) / 1e4;
  const motion: CapBrushMotion = {
    flags: dv.getUint32(mv + 0x100, true),
    start,
    delayMs: dv.getInt16(mv + 0x11e, true),
    types: [...data.subarray(types, types + count)],
    keys: Array.from({ length: count }, (_, i) => [f32(keys + 12 * i), f32(keys + 12 * i + 4), f32(keys + 12 * i + 8)] as [number, number, number]),
    speeds: Array.from({ length: 2 * count }, (_, i) => dv.getFloat32(speeds + 4 * i, true)),
  };
  if (![...motion.keys.flat(), ...motion.speeds].every((v) => Number.isFinite(v) && Math.abs(v) < 1e6)) return undefined;
  return motion;
}

/**
 * Brush faces, 0x68 bytes each like the level mesh's (asset-format-discovery.md §6.3): plane,
 * texture origin P (+0x10) and axes U / V (+0x1C / +0x28), and the face as one render polygon
 * at +0x3C: index list pointer (+0x40, u16 into the brush vertices), material (+0x48, texture
 * name pointer at material +8) and vertex count (+0x56).
 */
function parseBrushFaces(data: Uint8Array, dv: DataView, at: number, count: number, points: [number, number, number][]): CapBrushFace[] {
  const faces: CapBrushFace[] = [];
  const f32 = (o: number) => dv.getFloat32(o, true);
  const ptr = (o: number) => dv.getUint32(o, true) - CAP_BASE;
  for (let k = 0; k < count; k++) {
    const f = at + 0x68 * k;
    if (f < 0 || f + 0x68 > data.length) break;
    const P = [f32(f + 0x10), f32(f + 0x14), f32(f + 0x18)] as const;
    const U = [f32(f + 0x1c), f32(f + 0x20), f32(f + 0x24)] as const;
    const V = [f32(f + 0x28), f32(f + 0x2c), f32(f + 0x30)] as const;
    const idx = ptr(f + 0x40);
    const mat = ptr(f + 0x48);
    const n = data[f + 0x56]!;
    if (n < 3 || idx < 0 || idx + 2 * n > data.length || mat < 0 || mat + 12 > data.length) continue;
    const namePtr = ptr(mat + 8);
    if (namePtr < 0 || namePtr >= data.length) continue;
    const texture = ascii(data, namePtr, 40);
    const indices: number[] = [];
    const texels: number[] = [];
    for (let i = 0; i < n; i++) {
      const vi = dv.getUint16(idx + 2 * i, true);
      const v = points[vi];
      if (!v) break;
      indices.push(vi);
      const d = [v[0] - P[0], v[1] - P[1], v[2] - P[2]];
      texels.push(U[0] * d[0]! + U[1] * d[1]! + U[2] * d[2]!, V[0] * d[0]! + V[1] * d[1]! + V[2] * d[2]!);
    }
    if (indices.length === n && /^[\w-]+$/.test(texture)) faces.push({ texture: texture.toLowerCase(), indices, texels });
  }
  return faces;
}

const ascii = (data: Uint8Array, o: number, max = 64): string => {
  let e = o;
  while (e < data.length && e - o < max && data[e]! >= 0x20 && data[e]! < 0x7f) e++;
  return new TextDecoder('latin1').decode(data.subarray(o, e));
};

/**
 * Generic object record: [class u32][CD CD CD CD][3F 00 00 00][02 00 00 00]..., instance name at
 * +0x40, six component pointers at +0x28..+0x3C (absolute addresses in the 0x08000000 image):
 * 0 = transform (+4: 3x3 rotation, +0x28: position), 4 = class component (prop stats: HP at
 * +8; item: quantity at +0x18, item name at +0x2C), 5 = render (+0x18: models.ctx model id).
 */
function parseObjects(data: Uint8Array, dv: DataView, itemNames: ReadonlySet<string>): CapObject[] {
  const out: CapObject[] = [];
  const starts: number[] = [];
  const at = (ptr: number, size: number) => {
    const o = ptr - CAP_BASE;
    return o >= 0 && o + size <= data.length ? o : -1;
  };
  for (let a = 0; a + 0x80 < data.length; a++) {
    const kind = OBJECT_CLASSES[data[a]!];
    if (!kind || data[a + 1] !== 0 || dv.getUint32(a + 4, true) !== 0xcdcdcdcd || dv.getUint32(a + 8, true) !== 0x3f || dv.getUint32(a + 12, true) !== 2) continue;
    const slots = [0, 1, 2, 3, 4, 5].map((i) => dv.getUint32(a + 0x28 + 4 * i, true));
    const tf = at(slots[0]!, 0x34);
    const render = at(slots[5]!, 0x1c);
    if (tf < 0 || render < 0) continue;
    const rotation: number[] = [];
    for (let i = 0; i < 9; i++) rotation.push(Math.round(dv.getFloat32(tf + 4 + 4 * i, true) * 1e5) / 1e5);
    const position: [number, number, number] = [dv.getFloat32(tf + 0x28, true), dv.getFloat32(tf + 0x2c, true), dv.getFloat32(tf + 0x30, true)];
    if (!position.every(Number.isFinite) || !rotation.every(Number.isFinite)) continue;
    const obj: CapObject = { kind, name: ascii(data, a + 0x40), modelId: dv.getUint32(render + 0x18, true), position, rotation, hp: 0 };
    const comp = at(slots[4]!, 0x40);
    if (kind === 'prop' && comp >= 0) {
      const hp = dv.getFloat32(comp + 8, true);
      if (Number.isFinite(hp) && hp > 0 && hp < 100000) obj.hp = hp;
    } else if (kind === 'item' && comp >= 0) {
      obj.item = { name: ascii(data, comp + 0x2c).trim(), quantity: dv.getUint32(comp + 0x18, true) };
    }
    out.push(obj);
    starts.push(a);
  }
  // Chest contents and sprite effects live inside the record: scan its bytes up to the next
  // object record. Contained items use the item component layout (quantity at name - 0x14).
  out.forEach((obj, i) => {
    if (obj.kind !== 'chest' && obj.kind !== 'sprite') return;
    const end = Math.min(data.length, starts[i + 1] ?? data.length, starts[i]! + 0x2000);
    for (let o = starts[i]! + 0x80; o < end - 4; o++) {
      if (data[o - 1] !== 0 || data[o]! < 0x41 || data[o]! > 0x5a) continue; // string start
      const str = ascii(data, o);
      if (str.length < 4 || data[o + str.length] !== 0) continue;
      if (obj.kind === 'sprite' && /^[A-Z_]+$/.test(str)) {
        obj.effect = str;
        return;
      }
      if (obj.kind === 'chest' && itemNames.has(str.trim())) {
        const quantity = o >= 0x14 ? dv.getUint32(o - 0x14, true) : 1;
        (obj.contents ??= []).push({ name: str.trim(), quantity: quantity > 0 && quantity < 100000 ? quantity : 1 });
        o += str.length;
      }
    }
    if (obj.kind === 'chest') obj.contents ??= [];
  });
  return out;
}

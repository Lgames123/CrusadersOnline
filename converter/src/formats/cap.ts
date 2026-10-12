import { explode } from './dcl.ts';

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
}

/** One textured polygon of a brush: texture, indices into `points`, texel coordinates per vertex. */
export interface CapBrushFace {
  texture: string;
  indices: number[];
  /** U.(X - P), V.(X - P) per vertex, in the level mesh's texture units (×32 texels). */
  texels: number[];
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
    creatures.push({
      type,
      name,
      position,
      hp: f32(x - 0x1b8),
      xp: dv.getInt32(x + 4, true),
      disposition: dv.getInt32(x + 20, true),
      resist,
    });
    a = x;
  }
  return { mesh, creatures, objects, portals: parsePortals(data, dv), music: bytes[0x1c] ?? 0, brushes: parseBrushes(data, dv) };
}

/**
 * Portal record: [pointer to its own name at +0x20][0xFFFF0000 | exit][...][+0x10 position]
 * [+0x20 NUL-terminated destination act name].
 */
function parsePortals(data: Uint8Array, dv: DataView): CapPortal[] {
  const out: CapPortal[] = [];
  for (let o = 0; o + 0x30 < data.length; o++) {
    if (dv.getUint32(o, true) !== CAP_BASE + o + 0x20 || dv.getUint16(o + 6, true) !== 0xffff) continue;
    const target = ascii(data, o + 0x20, 24);
    if (!/^[A-Za-z]{2}[A-Za-z0-9_-]{1,20}$/.test(target) || data[o + 0x20 + target.length] !== 0) continue;
    const position: [number, number, number] = [dv.getFloat32(o + 0x10, true), dv.getFloat32(o + 0x14, true), dv.getFloat32(o + 0x18, true)];
    if (!position.every((v) => Number.isFinite(v) && Math.abs(v) < 1e5)) continue;
    const trigger = parseTrigger(data, dv, dv.getUint32(o - 0x30, true) - CAP_BASE);
    const use = (dv.getUint32(o - 0x2c, true) & 8) !== 0;
    out.push({ exit: dv.getUint16(o + 4, true), target, position, use, ...(trigger ? { trigger } : {}) });
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
      out.push({ name, points, faces: parseBrushFaces(data, dv, ptr - CAP_BASE, nf, points) });
      break;
    }
  }
  return out;
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

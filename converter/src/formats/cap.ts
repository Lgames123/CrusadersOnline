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

export interface CapLevel {
  /** Mesh file base name, e.g. "Ca_a". */
  mesh: string;
  creatures: CapCreature[];
  objects: CapObject[];
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
  return { mesh, creatures, objects };
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

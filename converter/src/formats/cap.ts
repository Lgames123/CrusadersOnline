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

export interface CapLevel {
  /** Mesh file base name, e.g. "Ca_a". */
  mesh: string;
  creatures: CapCreature[];
}

const HEADER_BYTES = 0x94;

export function parseCap(bytes: Uint8Array): CapLevel {
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
  return { mesh, creatures };
}

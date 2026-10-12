import { DclError, explode } from './dcl.ts';

/**
 * Level geometry (`Meshes/*.msh`), asset-format-discovery.md §6.3. A level file holds:
 *   header (0x112 bytes)          magic 0xFEED000A, SpaceMap header offset, lightmap byte size
 *                                 and count
 *   [u32 size][DCL] lightmaps     16-bit texels (RGB555), tiles listed in the directory
 *   directory                     12 bytes per lightmap: [?, ?, width, height][u32 byte offset][pad]
 *   SpaceMap DB header (0x20)     [u32 size]... then [u32 size][DCL]
 *   Mesh DB header (0x28)         [u32 size, u32 table bytes, 0xBABE0002, 8 types, ...] then [u32 size][DCL]
 * The two DBs are memory images placed back to back at game address 0x06000000; pointers inside
 * them are absolute addresses in that space. Each DB ends with a per-type object table
 * (count + pointers per type). Mesh type 0 = cells, type 1 = materials.
 *
 * Cell: +0x3C vertex pool (float32 xyz), +0x40 u16 vertex count, +0x42 u16 face count,
 *       +0x44 faces (0x68 bytes each).
 * Face: plane normal xyz + d (n.v + d = 0), +0x10 texture origin P, +0x1C texture axis U,
 *       +0x28 texture axis V (u = U.(X - P) in 32-texel units), +0x5C fragments, +0x60 u8 count.
 * Fragment (0x20, the engine's render polygon): +0x04 u16 vertex indices into the cell pool,
 *       +0x08 lightmap UVs (float32 pairs, 0..1 inside the tile), +0x0C material,
 *       +0x18 u16 lightmap index, +0x1A u8 vertex count.
 */
export class MshError extends Error {}

export const MESH_BASE = 0x06000000;

export interface MshPolygon {
  material: number;
  /** Face plane normal (original axes); front side faces this way. */
  normal: [number, number, number];
  /** xyz per vertex, original units, original (left-handed) axes. */
  positions: number[];
  /** Texture coordinates U.(X - P), V.(X - P): multiply by 32 texels, divide by the texture size. */
  texels: number[];
  /** Lightmap coordinates, 0..1 inside the lightmap tile. */
  lightUv: number[];
  lightmap: number;
}

export interface MshLightmap {
  width: number;
  height: number;
  /** Byte offset into `lightmapTexels`. */
  offset: number;
}

export interface MshLevel {
  materials: string[];
  polygons: MshPolygon[];
  lightmaps: MshLightmap[];
  /** RGB555 little-endian texels of all lightmap tiles. */
  lightmapTexels: Uint8Array;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Fragments skipped because of out-of-range references or off-plane vertices. */
  skipped: number;
}

const FLAG2_TABLE_BYTES = 0x2018;

export function parseMsh(bytes: Uint8Array): MshLevel {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (o: number) => {
    if (o < 0 || o + 4 > bytes.length) throw new MshError(`read past end at ${o}`);
    return view.getUint32(o, true);
  };
  if (u32(0) !== 0xfeed000a) throw new MshError('not a level mesh (bad magic)');
  const smOffset = u32(4);
  const lmBytes = u32(8);
  const lmCount = u32(12);
  const flags = u32(16);
  if (flags !== 0 && flags !== 2) throw new MshError(`unsupported level flags ${flags}`);

  // Flag 2 (Ws_a.msh only) inserts an 8216-byte table before the lightmaps (16-bit ramps, not
  // decoded: possibly a colour / fog table); skipped.
  const lmAt = 0x112 + (flags === 2 ? FLAG2_TABLE_BYTES : 0);
  const lmSize = u32(lmAt);
  const lm = explode(bytes, lmAt + 4, lmBytes);
  if (lm.end !== lmAt + 4 + lmSize || lm.data.length !== lmBytes) throw new MshError('lightmap block size mismatch');
  const lightmaps: MshLightmap[] = [];
  for (let i = 0; i < lmCount; i++) {
    const o = lm.end + 12 * i;
    lightmaps.push({ width: bytes[o + 2]!, height: bytes[o + 3]!, offset: u32(o + 4) });
  }
  if (lm.end + 12 * lmCount !== smOffset) throw new MshError('lightmap directory size mismatch');

  const smSize = u32(smOffset);
  const smStream = smOffset + 0x20;
  const sm = explode(bytes, smStream + 4, smSize);
  if (sm.end !== smStream + 4 + u32(smStream) || sm.data.length !== smSize) throw new MshError('SpaceMap block size mismatch');
  const meshHeader = sm.end;
  const meshSize = u32(meshHeader);
  const tableBytes = u32(meshHeader + 4);
  if (u32(meshHeader + 12) !== 8) throw new MshError('unexpected mesh object type count');
  const meshStream = meshHeader + 0x28;
  const mesh = explode(bytes, meshStream + 4, meshSize);
  if (mesh.end !== meshStream + 4 + u32(meshStream) || mesh.data.length !== meshSize) throw new MshError('mesh block size mismatch');

  // Game memory: SpaceMap DB then Mesh DB, based at MESH_BASE.
  const mem = new Uint8Array(sm.data.length + mesh.data.length);
  mem.set(sm.data, 0);
  mem.set(mesh.data, sm.data.length);
  const mv = new DataView(mem.buffer);
  const at = (ptr: number) => {
    const o = ptr - MESH_BASE;
    if (o < 0 || o >= mem.length) throw new MshError(`pointer 0x${ptr.toString(16)} outside the image`);
    return o;
  };
  const m32 = (o: number) => mv.getUint32(o, true);
  const f32 = (o: number) => mv.getFloat32(o, true);
  const cstr = (o: number) => {
    let e = o;
    while (e < mem.length && mem[e] !== 0 && e - o < 64) e++;
    return new TextDecoder('latin1').decode(mem.subarray(o, e));
  };

  // Per-type object table at the end of the Mesh DB.
  let t = sm.data.length + mesh.data.length - tableBytes;
  const types: number[][] = [];
  for (let i = 0; i < 8; i++) {
    const n = m32(t);
    t += 4;
    const list: number[] = [];
    for (let k = 0; k < n; k++) list.push(m32(t + 4 * k));
    t += 4 * n;
    types.push(list);
  }

  const materialIndex = new Map<number, number>();
  const materials: string[] = [];
  for (const ptr of types[1] ?? []) {
    materialIndex.set(ptr, materials.length);
    const namePtr = m32(at(ptr) + 8);
    materials.push(namePtr ? cstr(at(namePtr)) : `material_${materials.length}`);
  }

  const polygons: MshPolygon[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let skipped = 0;
  for (const cellPtr of types[0] ?? []) {
    const c = at(cellPtr);
    const poolPtr = m32(c + 0x3c);
    const nVerts = mv.getUint16(c + 0x40, true);
    const nFaces = mv.getUint16(c + 0x42, true);
    const facesPtr = m32(c + 0x44);
    if (!poolPtr || !facesPtr || !nVerts || !nFaces) continue; // cells without geometry
    const pool = at(poolPtr);
    for (let k = 0; k < nFaces; k++) {
      const f = at(facesPtr) + 0x68 * k;
      const n = [f32(f), f32(f + 4), f32(f + 8)] as const;
      const d = f32(f + 12);
      if (Math.abs(n[0] ** 2 + n[1] ** 2 + n[2] ** 2 - 1) > 1e-3) {
        skipped++;
        continue;
      }
      const P = [f32(f + 0x10), f32(f + 0x14), f32(f + 0x18)] as const;
      const U = [f32(f + 0x1c), f32(f + 0x20), f32(f + 0x24)] as const;
      const V = [f32(f + 0x28), f32(f + 0x2c), f32(f + 0x30)] as const;
      const fragPtr = m32(f + 0x5c);
      const nFrag = mem[f + 0x60]!;
      for (let j = 0; j < nFrag; j++) {
        try {
          const g = at(fragPtr) + 0x20 * j;
          const count = mem[g + 0x1a]!;
          const idxPtr = m32(g + 4);
          const uvPtr = m32(g + 8);
          const mat = materialIndex.get(m32(g + 0xc));
          if (count < 3 || !idxPtr || mat === undefined) {
            skipped++;
            continue;
          }
          const io = at(idxPtr);
          const uvo = uvPtr ? at(uvPtr) : -1;
          const poly: MshPolygon = { material: mat, normal: [n[0], n[1], n[2]], positions: [], texels: [], lightUv: [], lightmap: mv.getUint16(g + 0x18, true) };
          let ok = true;
          for (let v = 0; v < count && ok; v++) {
            const vi = mv.getUint16(io + 2 * v, true);
            if (vi >= nVerts) {
              ok = false;
              break;
            }
            const x = f32(pool + 12 * vi), y = f32(pool + 12 * vi + 4), z = f32(pool + 12 * vi + 8);
            if (Math.abs(n[0] * x + n[1] * y + n[2] * z + d) > 0.2) ok = false;
            const dx = x - P[0], dy = y - P[1], dz = z - P[2];
            poly.positions.push(x, y, z);
            poly.texels.push(U[0] * dx + U[1] * dy + U[2] * dz, V[0] * dx + V[1] * dy + V[2] * dz);
            poly.lightUv.push(uvo >= 0 ? f32(uvo + 8 * v) : 0, uvo >= 0 ? f32(uvo + 8 * v + 4) : 0);
          }
          if (!ok) {
            skipped++;
            continue;
          }
          for (let v = 0; v < poly.positions.length; v += 3) {
            for (let a = 0; a < 3; a++) {
              min[a] = Math.min(min[a]!, poly.positions[v + a]!);
              max[a] = Math.max(max[a]!, poly.positions[v + a]!);
            }
          }
          polygons.push(poly);
        } catch (err) {
          if (!(err instanceof MshError)) throw err;
          skipped++;
        }
      }
    }
  }
  return { materials, polygons, lightmaps, lightmapTexels: lm.data, bounds: { min, max }, skipped };
}

export { DclError };

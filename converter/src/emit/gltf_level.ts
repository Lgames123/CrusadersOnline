import type { DecodedImage } from '../formats/tga.ts';
import type { MshLevel } from '../formats/msh.ts';

/**
 * Level emission: render GLB (one primitive per material, TEXCOORD_0 = texture, TEXCOORD_1 =
 * lightmap atlas), the lightmap atlas image, and a collision triangle mesh. Coordinates stay in
 * original units; Z is mirrored like the models (left-handed source -> glTF right-handed).
 * The GLB references textures by relative URI (never embedded) and names the lightmap atlas in
 * `scenes[0].extras.lightmap`; glTF has no standard lightmap slot, so the client binds it.
 */
export interface LevelEmitOptions {
  name: string;
  /** Texture file (relative to the GLB) and pixel size per lower-case material name. */
  texture(material: string): { uri: string; width: number; height: number } | null;
  /** Lightmap atlas file name relative to the GLB. */
  lightmapUri: string;
  /** Materials excluded from collision (sky boxes etc.). */
  nonSolid?: (material: string) => boolean;
}

export interface LevelEmitResult {
  glb: Uint8Array;
  atlas: DecodedImage;
  collision: Uint8Array;
  triangles: number;
}

const ATLAS_WIDTH = 2048;
/**
 * Face texture axes give U.(X - P) in units of 32 texels: every level texture is 128 px and
 * the brick floors then come out at a realistic ~4 ft per repeat (asset-format-discovery.md §6.3).
 */
const TEXELS_PER_UNIT = 32;
const PAD = 1;

/** Shelf-packs the lightmap tiles (1-texel replicated border) and decodes RGB555 to RGBA8. */
export function buildLightmapAtlas(level: MshLevel): { image: DecodedImage; rects: { x: number; y: number; w: number; h: number }[] } {
  const order = level.lightmaps.map((_, i) => i).sort((a, b) => level.lightmaps[b]!.height - level.lightmaps[a]!.height);
  const rects = new Array<{ x: number; y: number; w: number; h: number }>(level.lightmaps.length);
  let x = 0, y = 0, shelf = 0;
  for (const i of order) {
    const { width: w, height: h } = level.lightmaps[i]!;
    if (x + w + 2 * PAD > ATLAS_WIDTH) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    rects[i] = { x: x + PAD, y: y + PAD, w, h };
    x += w + 2 * PAD;
    shelf = Math.max(shelf, h + 2 * PAD);
  }
  let height = 1;
  while (height < y + shelf) height *= 2;
  const data = new Uint8Array(ATLAS_WIDTH * height * 4);
  const src = level.lightmapTexels;
  level.lightmaps.forEach((lm, i) => {
    const r = rects[i]!;
    for (let ty = -PAD; ty < lm.height + PAD; ty++) {
      for (let tx = -PAD; tx < lm.width + PAD; tx++) {
        const sx = Math.min(lm.width - 1, Math.max(0, tx));
        const sy = Math.min(lm.height - 1, Math.max(0, ty));
        const so = lm.offset + 2 * (sy * lm.width + sx);
        const v = so + 1 < src.length ? src[so]! | (src[so + 1]! << 8) : 0;
        const o = 4 * ((r.y + ty) * ATLAS_WIDTH + (r.x + tx));
        data[o] = (((v >> 10) & 31) * 255) / 31;
        data[o + 1] = (((v >> 5) & 31) * 255) / 31;
        data[o + 2] = ((v & 31) * 255) / 31;
        data[o + 3] = 255;
      }
    }
  });
  return { image: { width: ATLAS_WIDTH, height, data, hasAlpha: false }, rects };
}

export function emitLevel(level: MshLevel, opts: LevelEmitOptions): LevelEmitResult {
  const { image: atlas, rects } = buildLightmapAtlas(level);
  type Group = { pos: number[]; nrm: number[]; uv0: number[]; uv1: number[]; idx: number[] };
  const groups = new Map<number, Group>();
  const colPos: number[] = [];
  const colIdx: number[] = [];
  const texInfo = level.materials.map((m) => opts.texture(m.toLowerCase()));

  for (const p of level.polygons) {
    let g = groups.get(p.material);
    if (!g) groups.set(p.material, (g = { pos: [], nrm: [], uv0: [], uv1: [], idx: [] }));
    const n = p.positions.length / 3;
    // Mirrored positions; vertex order is reversed when needed so the front face (counter-
    // clockwise in glTF) is on the side the original face normal points to.
    let v: number[] = [];
    let uvT: number[] = [];
    let uvL: number[] = [];
    for (let i = 0; i < n; i++) v.push(p.positions[3 * i]!, p.positions[3 * i + 1]!, -p.positions[3 * i + 2]!);
    uvT = p.texels.slice();
    uvL = p.lightUv.slice();
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      nx += (v[3 * i + 1]! - v[3 * j + 1]!) * (v[3 * i + 2]! + v[3 * j + 2]!);
      ny += (v[3 * i + 2]! - v[3 * j + 2]!) * (v[3 * i]! + v[3 * j]!);
      nz += (v[3 * i]! - v[3 * j]!) * (v[3 * i + 1]! + v[3 * j + 1]!);
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const fn = [p.normal[0], p.normal[1], -p.normal[2]];
    if (nx * fn[0]! + ny * fn[1]! + nz * fn[2]! < 0) {
      const rv: number[] = [], rt: number[] = [], rl: number[] = [];
      for (let i = n - 1; i >= 0; i--) {
        rv.push(v[3 * i]!, v[3 * i + 1]!, v[3 * i + 2]!);
        rt.push(uvT[2 * i]!, uvT[2 * i + 1]!);
        rl.push(uvL[2 * i]!, uvL[2 * i + 1]!);
      }
      v = rv; uvT = rt; uvL = rl;
      nx = -nx; ny = -ny; nz = -nz;
    }
    const tex = texInfo[p.material];
    const r = rects[p.lightmap];
    const base = g.pos.length / 3;
    for (let i = 0; i < n; i++) {
      g.pos.push(v[3 * i]!, v[3 * i + 1]!, v[3 * i + 2]!);
      g.nrm.push(nx, ny, nz);
      g.uv0.push(tex ? (uvT[2 * i]! * TEXELS_PER_UNIT) / tex.width : 0, tex ? (uvT[2 * i + 1]! * TEXELS_PER_UNIT) / tex.height : 0);
      if (r) g.uv1.push((r.x + uvL[2 * i]! * r.w) / atlas.width, (r.y + uvL[2 * i + 1]! * r.h) / atlas.height);
      else g.uv1.push(0, 0);
    }
    // Fan triangulation (fragments are convex).
    for (let i = 1; i + 1 < n; i++) g.idx.push(base, base + i, base + i + 1);
    if (!opts.nonSolid?.(level.materials[p.material]!.toLowerCase())) {
      const cb = colPos.length / 3;
      colPos.push(...v);
      for (let i = 1; i + 1 < n; i++) colIdx.push(cb, cb + i, cb + i + 1);
    }
  }

  // --- glTF JSON + binary chunk
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const addAccessor = (array: Float32Array | Uint32Array, type: 'VEC3' | 'VEC2' | 'SCALAR', withBounds = false): number => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    const comps = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1;
    const acc: Record<string, unknown> = {
      bufferView: bufferViews.length - 1,
      componentType: array instanceof Float32Array ? 5126 : 5125,
      count: array.length / comps,
      type,
    };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < array.length; i += 3) for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, array[i + a]!);
        max[a] = Math.max(max[a]!, array[i + a]!);
      }
      acc['min'] = min;
      acc['max'] = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const images: object[] = [];
  const textures: object[] = [];
  const materials: object[] = [];
  const primitives: object[] = [];
  const imageIndex = new Map<string, number>();
  for (const [mat, g] of [...groups].sort(([a], [b]) => a - b)) {
    const name = level.materials[mat]!;
    const tex = texInfo[mat];
    const material: Record<string, unknown> = {
      name,
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
    };
    if (tex) {
      let img = imageIndex.get(tex.uri);
      if (img === undefined) {
        img = images.length;
        images.push({ uri: tex.uri, mimeType: 'image/webp' });
        textures.push({ source: img, sampler: 0 });
        imageIndex.set(tex.uri, img);
      }
      (material['pbrMetallicRoughness'] as Record<string, unknown>)['baseColorTexture'] = { index: img };
    }
    materials.push(material);
    primitives.push({
      attributes: {
        POSITION: addAccessor(new Float32Array(g.pos), 'VEC3', true),
        NORMAL: addAccessor(new Float32Array(g.nrm), 'VEC3'),
        TEXCOORD_0: addAccessor(new Float32Array(g.uv0), 'VEC2'),
        TEXCOORD_1: addAccessor(new Float32Array(g.uv1), 'VEC2'),
      },
      indices: addAccessor(new Uint32Array(g.idx), 'SCALAR'),
      material: materials.length - 1,
    });
  }
  const json = {
    asset: { version: '2.0', generator: 'CrusadersOnline converter (from user-owned original files)' },
    scene: 0,
    scenes: [{ name: opts.name, nodes: [0], extras: { lightmap: opts.lightmapUri, units: 'original (feet)', bounds: level.bounds } }],
    nodes: [{ name: opts.name, mesh: 0 }],
    meshes: [{ name: opts.name, primitives }],
    materials,
    textures,
    images,
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  return { glb: packGlb(json, chunks, byteLength), atlas, collision: packCollision(colPos, colIdx), triangles: colIdx.length / 3 };
}

function packGlb(json: object, chunks: Uint8Array[], binLength: number): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = jsonBytes.byteLength + ((4 - (jsonBytes.byteLength % 4)) % 4);
  const total = 12 + 8 + jsonLen + 8 + binLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLen);
  let o = 20 + jsonLen;
  dv.setUint32(o, binLength, true);
  dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
  o += 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/**
 * Collision mesh: "COL1", u32 vertex count, u32 triangle count, float32 xyz (original units,
 * mirrored Z), u32 indices. Read by shared/src/arena/level_collision.ts.
 */
export function packCollision(pos: readonly number[], idx: readonly number[]): Uint8Array {
  const out = new Uint8Array(12 + pos.length * 4 + idx.length * 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x314c4f43, true); // 'COL1'
  dv.setUint32(4, pos.length / 3, true);
  dv.setUint32(8, idx.length / 3, true);
  let o = 12;
  for (const v of pos) (dv.setFloat32(o, v, true), (o += 4));
  for (const i of idx) (dv.setUint32(o, i, true), (o += 4));
  return out;
}

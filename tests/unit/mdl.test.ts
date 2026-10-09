import { describe, expect, it } from 'vitest';
import { MdlError, buildModelDocument, parseMdl, parseModelsCtx, worldTransforms, writeGlb } from '@crusaders/converter';

// Synthetic fixture following docs/reverse-engineering/asset-format-discovery.md §3.
// Two nodes (root + child rotated 90° about Y and offset +2 on X), 2 vertices each, 2 faces,
// one collision sphere. No original game data is used.
function buildFixture(): Uint8Array {
  const nodes = 2, verts = 4, faces = 2, spheres = 1;
  const names = 'root\0child\0DMY SPHERE A\0';
  const size = 0x74 + nodes * 56 + verts * 12 + faces * 50 + verts * 12 + names.length + spheres * 20;
  const b = new Uint8Array(size).fill(0xcd);
  const dv = new DataView(b.buffer);
  const u32 = (o: number, v: number) => dv.setUint32(o, v, true);
  const f32 = (o: number, v: number) => dv.setFloat32(o, v, true);
  b.fill(0, 0, 0x3c);
  u32(0x00, nodes); u32(0x08, faces); u32(0x10, 0x00801234); u32(0x14, verts); u32(0x18, 0xdead0000);
  u32(0x2c, names.length); u32(0x30, spheres);
  [-1, -1, -1, 3, 1, 1].forEach((v, i) => f32(0x4c + i * 4, v));

  const s = Math.SQRT1_2;
  const node = (o: number, subtree: number, q: number[], t: number[], count: number) => {
    dv.setUint16(o, 3, true);
    dv.setInt16(o + 2, subtree, true);
    q.forEach((v, i) => f32(o + 4 + i * 4, v));
    t.forEach((v, i) => f32(o + 20 + i * 4, v));
    u32(o + 32, count);
    u32(o + 36, 0x00805000); u32(o + 40, 0x00805018); // stale pointers
  };
  node(0x74, -1, [0, 0, 0, 1], [0, 0, 0], 2);
  node(0x74 + 56, -1, [0, s, 0, s], [2, 0, 0], 2);

  let o = 0x74 + nodes * 56;
  for (const v of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 0, 0]]) { v.forEach((x, i) => f32(o + i * 4, x)); o += 12; }
  for (const [a, c, d] of [[0, 1, 2], [1, 3, 2]]) {
    u32(o, 3); u32(o + 4, 0x00806000); u32(o + 8, 0); u32(o + 12, 0); u32(o + 16, 0x00806040);
    dv.setUint16(o + 20, a!, true); dv.setUint16(o + 22, c!, true); dv.setUint16(o + 24, d!, true);
    [0, 0, 1, 0, 0, 1].forEach((x, i) => f32(o + 26 + i * 4, x));
    o += 50;
  }
  for (let k = 0; k < verts; k++) { f32(o, 0); f32(o + 4, 1); f32(o + 8, 0); o += 12; }
  b.set(new TextEncoder().encode(names), o); o += names.length;
  u32(o, 1); f32(o + 4, 0.5); f32(o + 8, 0); f32(o + 12, 0); f32(o + 16, 0.25);
  return b;
}

describe('.mdl parser', () => {
  it('rebuilds nodes, hierarchy, geometry and dummies from counts (ignoring pointers)', () => {
    const m = parseMdl(buildFixture());
    expect(m.nodes.map((n) => [n.name, n.parent, n.firstVertex, n.vertexCount])).toEqual([
      ['root', -1, 0, 2],
      ['child', 0, 2, 2],
    ]);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 1, 3, 2]);
    expect(m.spheres).toEqual([{ name: 'DMY SPHERE A', node: 1, center: [0.5, 0, 0], radius: 0.25 }]);
  });

  it('composes world transforms as parent x local', () => {
    const w = worldTransforms(parseMdl(buildFixture()));
    expect(w[1]!.translation[0]).toBeCloseTo(2);
    // child rotated 90° about +Y: local +X maps to world -Z
    const [x, y, z, ww] = w[1]!.rotation;
    expect([x, z]).toEqual([0, 0]);
    expect(Math.abs(y)).toBeCloseTo(Math.SQRT1_2);
    expect(Math.abs(ww)).toBeCloseTo(Math.SQRT1_2);
  });

  it('rejects files whose size does not match the layout', () => {
    const b = buildFixture();
    expect(() => parseMdl(b.subarray(0, b.length - 1))).toThrow(MdlError);
    const bad = b.slice();
    new DataView(bad.buffer).setUint32(0x14, 99, true);
    expect(() => parseMdl(bad)).toThrow(MdlError);
  });

  it('emits a skinned GLB with one joint per node and an external texture URI', async () => {
    const doc = buildModelDocument(parseMdl(buildFixture()), { name: 'fixture', textureUri: '../textures/x.webp' });
    expect(doc.getRoot().listSkins()[0]!.listJoints()).toHaveLength(2);
    const glb = await writeGlb(doc);
    const dv = new DataView(glb.buffer, glb.byteOffset);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + dv.getUint32(12, true))));
    expect(json.images).toEqual([{ uri: '../textures/x.webp', mimeType: 'image/webp' }]);
    // Mirroring Z keeps the child's world X but reverses winding.
    expect(json.meshes[0].primitives[0].attributes.JOINTS_0).toBeDefined();
  });
});

describe('models.ctx bindings', () => {
  it('collects file, textures, animations and flags per model id', () => {
    const b = parseModelsCtx('# comment\nN 0 drake.mdl\nT drake\t\t# tex\nL PA01_ru_f.ani # run\n\nN 21 rock01.mdl\nT Dw_ER\nSHADOWLESS\n');
    expect(b).toEqual([
      { id: 0, file: 'drake.mdl', textures: ['drake'], animations: ['PA01_ru_f.ani'], labels: { 'PA01_ru_f.ani': 'run' }, flags: [] },
      { id: 21, file: 'rock01.mdl', textures: ['Dw_ER'], animations: [], labels: {}, flags: ['SHADOWLESS'] },
    ]);
  });
});

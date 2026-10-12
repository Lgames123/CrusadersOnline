/**
 * Parser for the original game's `.mdl` models. Specification:
 * docs/reverse-engineering/asset-format-discovery.md §3. Pure: no Node or DOM APIs.
 *
 * Files are in-memory structures dumped to disk; every pointer field is ignored and the
 * layout is rebuilt from the counts in the header.
 */
export class MdlError extends Error {}

export interface MdlNode {
  name: string;
  /** Index of the parent node, -1 for roots. */
  parent: number;
  flags: number;
  /** Local rotation quaternion (x, y, z, w) relative to the parent. */
  rotation: [number, number, number, number];
  /** Local translation relative to the parent. */
  translation: [number, number, number];
  /** Range of vertices (in node-local space) owned by this node — rigid skinning. */
  firstVertex: number;
  vertexCount: number;
}

export interface MdlSphere {
  name: string;
  node: number;
  center: [number, number, number];
  radius: number;
}

export interface MdlLine {
  name: string;
  node: number;
  rotation: [number, number, number, number];
  a: [number, number, number];
  b: [number, number, number];
}

export interface MdlTransformDummy {
  name: string;
  node: number;
  /** Rotation quaternion (x, y, z, w) then translation, relative to `node` (UNK-006). */
  values: number[];
}

export interface MdlModel {
  nodes: MdlNode[];
  /** Node-local positions, 3 floats per vertex. */
  positions: Float32Array;
  /** Node-local normals, 3 floats per vertex. */
  normals: Float32Array;
  /** 3 vertex indices per triangle. */
  indices: Uint16Array;
  /** Per-corner UVs, 6 floats per triangle. */
  uvs: Float32Array;
  spheres: MdlSphere[];
  lines: MdlLine[];
  transforms: MdlTransformDummy[];
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

const HEADER_SIZE = 0x74;
const NODE_SIZE = 56;
const VERT_SIZE = 12;
const FACE_SIZE = 50;
const SPHERE_SIZE = 20;
const LINE_SIZE = 44;
const XFRM_SIZE = 32;
const MAX_COUNT = 1 << 20;

export function parseMdl(bytes: Uint8Array): MdlModel {
  if (bytes.length < HEADER_SIZE) throw new MdlError('file shorter than header');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (o: number) => dv.getUint32(o, true);
  const f32 = (o: number) => dv.getFloat32(o, true);
  const vec3 = (o: number): [number, number, number] => [f32(o), f32(o + 4), f32(o + 8)];
  const quat = (o: number): [number, number, number, number] => [f32(o), f32(o + 4), f32(o + 8), f32(o + 12)];

  const nodeCount = u32(0x00);
  const faceCount = u32(0x08);
  const vertexCount = u32(0x14);
  const namesSize = u32(0x2c);
  const sphereCount = u32(0x30);
  const lineCount = u32(0x34);
  const xfrmCount = u32(0x38);
  for (const [what, n] of [['nodes', nodeCount], ['faces', faceCount], ['vertices', vertexCount], ['spheres', sphereCount], ['lines', lineCount], ['transforms', xfrmCount]] as const) {
    if (n > MAX_COUNT) throw new MdlError(`implausible ${what} count ${n}`);
  }

  const nodesAt = HEADER_SIZE;
  const vertsAt = nodesAt + nodeCount * NODE_SIZE;
  const facesAt = vertsAt + vertexCount * VERT_SIZE;
  const normalsAt = facesAt + faceCount * FACE_SIZE;
  const namesAt = normalsAt + vertexCount * VERT_SIZE;
  const spheresAt = namesAt + namesSize;
  const linesAt = spheresAt + sphereCount * SPHERE_SIZE;
  const xfrmAt = linesAt + lineCount * LINE_SIZE;
  const end = xfrmAt + xfrmCount * XFRM_SIZE;
  if (end !== bytes.length) throw new MdlError(`layout predicts ${end} bytes, file has ${bytes.length}`);

  const names = new TextDecoder('latin1').decode(bytes.subarray(namesAt, spheresAt)).split('\0').filter((s) => s.length > 0);
  const nameAt = (i: number) => names[i] ?? `node${i}`;

  // Nodes (depth-first; i16 at +2 is the subtree size, -1 = rest of parent's range).
  const subtree: number[] = [];
  const nodes: MdlNode[] = [];
  let firstVertex = 0;
  for (let i = 0; i < nodeCount; i++) {
    const o = nodesAt + i * NODE_SIZE;
    subtree.push(dv.getInt16(o + 2, true));
    const count = u32(o + 32);
    nodes.push({
      name: nameAt(i),
      parent: -1,
      flags: dv.getUint16(o, true),
      rotation: quat(o + 4),
      translation: vec3(o + 20),
      firstVertex,
      vertexCount: count,
    });
    firstVertex += count;
  }
  if (firstVertex !== vertexCount) throw new MdlError('node vertex counts do not sum to the header count');
  const assign = (start: number, stop: number, parent: number, depth: number) => {
    if (depth > nodeCount) throw new MdlError('node hierarchy does not terminate');
    let i = start;
    while (i < stop) {
      nodes[i]!.parent = parent;
      const size = subtree[i] === -1 ? stop - i : subtree[i]!;
      if (size < 1 || i + size > stop) throw new MdlError(`invalid subtree size at node ${i}`);
      assign(i + 1, i + size, i, depth + 1);
      i += size;
    }
  };
  assign(0, nodeCount, -1, 0);

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let k = 0; k < vertexCount * 3; k++) {
    positions[k] = f32(vertsAt + k * 4);
    normals[k] = f32(normalsAt + k * 4);
  }

  const indices = new Uint16Array(faceCount * 3);
  const uvs = new Float32Array(faceCount * 6);
  for (let i = 0; i < faceCount; i++) {
    const o = facesAt + i * FACE_SIZE;
    if (u32(o) !== 3) throw new MdlError(`face ${i} is not a triangle`);
    for (let c = 0; c < 3; c++) {
      const idx = dv.getUint16(o + 20 + c * 2, true);
      if (idx >= vertexCount) throw new MdlError(`face ${i} references vertex ${idx}`);
      indices[i * 3 + c] = idx;
    }
    for (let c = 0; c < 6; c++) uvs[i * 6 + c] = f32(o + 26 + c * 4);
  }

  let nameIndex = nodeCount;
  const spheres: MdlSphere[] = [];
  for (let i = 0; i < sphereCount; i++) {
    const o = spheresAt + i * SPHERE_SIZE;
    spheres.push({ name: nameAt(nameIndex++), node: u32(o), center: vec3(o + 4), radius: f32(o + 16) });
  }
  const lines: MdlLine[] = [];
  for (let i = 0; i < lineCount; i++) {
    const o = linesAt + i * LINE_SIZE;
    lines.push({ name: nameAt(nameIndex++), node: u32(o), rotation: quat(o + 4), a: vec3(o + 20), b: vec3(o + 32) });
  }
  const transforms: MdlTransformDummy[] = [];
  for (let i = 0; i < xfrmCount; i++) {
    const o = xfrmAt + i * XFRM_SIZE;
    transforms.push({ name: nameAt(nameIndex++), node: u32(o), values: Array.from({ length: 7 }, (_, k) => f32(o + 4 + k * 4)) });
  }

  return { nodes, positions, normals, indices, uvs, spheres, lines, transforms, bboxMin: vec3(0x4c), bboxMax: vec3(0x58) };
}

type Quat = [number, number, number, number];
type Vec3 = [number, number, number];

export function quatMultiply(a: Readonly<Quat>, b: Readonly<Quat>): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatRotate(q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/** Bind-pose world transform of every node: world = parentWorld x local. */
export function worldTransforms(model: MdlModel): { rotation: Quat; translation: Vec3 }[] {
  const out: { rotation: Quat; translation: Vec3 }[] = [];
  for (const n of model.nodes) {
    if (n.parent < 0) {
      out.push({ rotation: [...n.rotation], translation: [...n.translation] });
      continue;
    }
    const p = out[n.parent]!;
    const r = quatRotate(p.rotation, n.translation);
    out.push({
      rotation: quatMultiply(p.rotation, n.rotation),
      translation: [p.translation[0] + r[0], p.translation[1] + r[1], p.translation[2] + r[2]],
    });
  }
  return out;
}

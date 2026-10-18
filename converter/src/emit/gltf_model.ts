import { Document, Format, WebIO, type Node as GltfNode } from '@gltf-transform/core';
import { worldTransforms, type MdlModel } from '../formats/mdl.ts';
import { ANI_FPS, evaluateChannel, type AniClip } from '../formats/ani.ts';

export interface ModelEmitOptions {
  name: string;
  /** Texture URI relative to the .glb (e.g. "../textures/drake.webp"); untextured when omitted. */
  textureUri?: string;
  /**
   * Convert from the game's left-handed space (Direct3D convention) to glTF's right-handed
   * space by mirroring Z. Triangle winding is reversed accordingly.
   */
  mirrorZ?: boolean;
  /** Animation clips (already parsed for this model's skeleton). */
  animations?: { name: string; label?: string; clip: AniClip }[];
  /** Animation state (ASM_RUNNING...) -> clip name, kept in the root's `extras.asmStates`. */
  states?: Record<string, string>;
}

type Quat = [number, number, number, number];
type Vec3 = [number, number, number];

/** Column-major 4x4 inverse of a rigid transform (rotation q, translation t). */
function inverseRigidMatrix(q: Readonly<Quat>, t: Readonly<Vec3>): number[] {
  const [x, y, z, w] = q;
  // Rotation matrix R (row-major entries rRC)
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
  // Inverse: R^T and -R^T t. Column-major: m[col*4 + row].
  const itx = -(r00 * t[0] + r10 * t[1] + r20 * t[2]);
  const ity = -(r01 * t[0] + r11 * t[1] + r21 * t[2]);
  const itz = -(r02 * t[0] + r12 * t[1] + r22 * t[2]);
  return [r00, r01, r02, 0, r10, r11, r12, 0, r20, r21, r22, 0, itx, ity, itz, 1];
}

const finiteOr = (v: number, d: number) => (Number.isFinite(v) && Math.abs(v) < 1e6 ? v : d);

/**
 * Builds a glTF document for one model. Multi-node models become a skinned mesh whose joints
 * mirror the original hierarchy (rigid skinning: one joint per vertex, weight 1); single-node
 * props become a plain mesh. Collision spheres, weapon lines and attachment dummies are kept in
 * the root node's `extras` for the game to use.
 */
export function buildModelDocument(model: MdlModel, opts: ModelEmitOptions): Document {
  const mirror = opts.mirrorZ ?? true;
  const mz = mirror ? -1 : 1;
  const mq = (q: Readonly<Quat>): Quat => (mirror ? [-q[0], -q[1], q[2], q[3]] : [q[0], q[1], q[2], q[3]]);
  const mv = (v: Readonly<Vec3>): Vec3 => [v[0], v[1], v[2] * mz];

  const world = worldTransforms(model);
  const owner = new Uint16Array(model.positions.length / 3);
  for (let n = 0; n < model.nodes.length; n++) {
    const node = model.nodes[n]!;
    owner.fill(n, node.firstVertex, node.firstVertex + node.vertexCount);
  }

  // Split vertices on per-corner UVs.
  const key = new Map<string, number>();
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], joints: number[] = [];
  const idx: number[] = [];
  const faces = model.indices.length / 3;
  for (let f = 0; f < faces; f++) {
    const corner: number[] = [];
    for (let c = 0; c < 3; c++) {
      const v = model.indices[f * 3 + c]!;
      const u = finiteOr(model.uvs[f * 6 + c * 2]!, 0);
      const t = finiteOr(model.uvs[f * 6 + c * 2 + 1]!, 0);
      const k = `${v}|${u}|${t}`;
      let out = key.get(k);
      if (out === undefined) {
        out = pos.length / 3;
        key.set(k, out);
        const w = world[owner[v]!]!;
        const p = quatRotate3(w.rotation, [model.positions[v * 3]!, model.positions[v * 3 + 1]!, model.positions[v * 3 + 2]!]);
        const n = quatRotate3(w.rotation, [model.normals[v * 3]!, model.normals[v * 3 + 1]!, model.normals[v * 3 + 2]!]);
        const len = Math.hypot(n[0], n[1], n[2]);
        const nn: Vec3 = Number.isFinite(len) && len > 1e-6 && len < 1e3 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 1, 0];
        pos.push(p[0] + w.translation[0], p[1] + w.translation[1], (p[2] + w.translation[2]) * mz);
        nrm.push(nn[0], nn[1], nn[2] * mz);
        // The engine's texture origin is bottom-left (TGA rows bottom-up); glTF's is top-left.
        uv.push(u, 1 - t);
        joints.push(owner[v]!, 0, 0, 0);
      }
      corner.push(out);
    }
    if (mirror) idx.push(corner[0]!, corner[2]!, corner[1]!);
    else idx.push(corner[0]!, corner[1]!, corner[2]!);
  }

  const doc = new Document();
  doc.createBuffer();
  const buffer = doc.getRoot().listBuffers()[0]!;
  const acc = (type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR' | 'MAT4', array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(nrm)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv)))
    .setIndices(acc('SCALAR', pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)));

  const material = doc.createMaterial(opts.name).setRoughnessFactor(1).setMetallicFactor(0).setAlphaMode('MASK').setAlphaCutoff(0.5);
  if (opts.textureUri) {
    const tex = doc.createTexture(opts.textureUri).setURI(opts.textureUri).setMimeType('image/webp');
    material.setBaseColorTexture(tex);
    const info = material.getBaseColorTextureInfo()!;
    info.setWrapS(10497).setWrapT(10497); // REPEAT
  }
  prim.setMaterial(material);
  const mesh = doc.createMesh(opts.name).addPrimitive(prim);
  const scene = doc.createScene(opts.name);
  const extras = {
    source: 'CrusadersOnline converter (from user-owned original files)',
    spheres: model.spheres.map((s) => ({ ...s, center: mv(s.center) })),
    lines: model.lines.map((l) => ({ ...l, rotation: mq(l.rotation), a: mv(l.a), b: mv(l.b) })),
    transforms: model.transforms,
    ...(opts.states && Object.keys(opts.states).length ? { asmStates: opts.states } : {}),
  };

  if (model.nodes.length <= 1) {
    // The node's own transform is baked into the vertices; it is kept so a held item (weapon,
    // shield) can be mounted by its node frame, as the engine attaches it.
    const node = model.nodes[0];
    const nodeTransform = node ? { rotation: mq(node.rotation), translation: mv(node.translation) } : undefined;
    scene.addChild(doc.createNode(opts.name).setMesh(mesh).setExtras({ ...extras, ...(nodeTransform ? { nodeTransform } : {}) }));
    return doc;
  }

  prim.setAttribute('JOINTS_0', acc('VEC4', new Uint16Array(joints)));
  const weights = new Float32Array(joints.length);
  for (let i = 0; i < weights.length; i += 4) weights[i] = 1;
  prim.setAttribute('WEIGHTS_0', acc('VEC4', weights));

  const jointNodes: GltfNode[] = model.nodes.map((n) =>
    doc.createNode(n.name).setRotation(mq(n.rotation)).setTranslation(mv(n.translation)),
  );
  model.nodes.forEach((n, i) => {
    if (n.parent >= 0) jointNodes[n.parent]!.addChild(jointNodes[i]!);
  });
  const ibm: number[] = [];
  for (const w of world) ibm.push(...inverseRigidMatrix(mq(w.rotation), mv(w.translation)));
  const skin = doc.createSkin(opts.name).setInverseBindMatrices(acc('MAT4', new Float32Array(ibm)));
  for (const j of jointNodes) skin.addJoint(j);
  const root = doc.createNode(opts.name).setExtras(extras);
  for (let i = 0; i < model.nodes.length; i++) if (model.nodes[i]!.parent < 0) root.addChild(jointNodes[i]!);
  skin.setSkeleton(jointNodes[0]!);
  // Clips bound to the death and mount states keep their root motion (see addAnimation).
  const moving = new Set(Object.entries(opts.states ?? {}).filter(([k]) => k.startsWith('ASM_HIT_POINTS_DEPLETED') || MOUNT_STATES.has(k)).map(([, v]) => v.toLowerCase()));
  for (const a of opts.animations ?? []) addAnimation(doc, buffer, jointNodes, a, mq, mv, !moving.has(a.name.toLowerCase()));
  root.addChild(doc.createNode(`${opts.name}_mesh`).setMesh(mesh).setSkin(skin));
  scene.addChild(root);
  return doc;
}

function quatRotate3(q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/**
 * Serialises to GLB while keeping texture images as external URIs (the user's converted
 * textures live next to the models; embedding would duplicate them per model).
 * gltf-transform's own GLB writer drops URIs of images without data, so the container is
 * assembled here from writeJSON output.
 */
export async function writeGlb(doc: Document): Promise<Uint8Array> {
  const textures = doc.getRoot().listTextures();
  const { json, resources } = await new WebIO().writeJSON(doc, { format: Format.GLB });
  json.images = textures.map((t) => ({ uri: t.getURI(), mimeType: t.getMimeType() }));
  for (const tex of json.textures ?? []) {
    if (tex.source === undefined) tex.source = 0;
  }
  const bin = Object.values(resources)[0] ?? new Uint8Array(0);
  if (json.buffers?.[0]) {
    delete json.buffers[0].uri;
    json.buffers[0].byteLength = bin.byteLength;
  }
  const pad = (n: number) => (4 - (n % 4)) % 4;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = jsonBytes.byteLength + pad(jsonBytes.byteLength);
  const binLen = bin.byteLength + pad(bin.byteLength);
  const total = 12 + 8 + jsonLen + (binLen > 0 ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLen);
  if (binLen > 0) {
    const o = 20 + jsonLen;
    dv.setUint32(o, binLen, true);
    dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
    out.set(bin, o + 8);
  }
  return out;
}

/**
 * Mounts are authored about where they end (PF01: the root starts 2.15 ft back and 4.5 ft down);
 * the character stands there from their first frame, so the clip carries the body up to it.
 */
const MOUNT_STATES = new Set(['ASM_LOW_MOUNT', 'ASM_HIGH_MOUNT', 'ASM_HANG_MOUNT']);

/**
 * Samples a clip once per original frame (30 fps) into LINEAR glTF channels. Like the engine,
 * the root's X/Z translation is held at its frame-0 value (animations play in place); the
 * horizontal root displacement over the clip is kept as `extras.rootMotion` for gameplay.
 * Death clips (ASM_HIT_POINTS_DEPLETED*) keep their root motion: the body falls where the clip
 * takes it (e.g. PI03 ends 7.5 ft to the side) and nothing else moves the dead character; so do
 * the mounts (MOUNT_STATES).
 */
function addAnimation(
  doc: Document,
  buffer: ReturnType<Document['createBuffer']>,
  joints: GltfNode[],
  a: { name: string; label?: string; clip: AniClip },
  mq: (q: Readonly<Quat>) => Quat,
  mv: (v: Readonly<Vec3>) => Vec3,
  inPlace = true,
): void {
  const frames = Math.max(1, Math.round(a.clip.endFrame));
  const times = new Float32Array(frames + 1);
  for (let f = 0; f <= frames; f++) times[f] = f / ANI_FPS;
  const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
  const anim = doc.createAnimation(a.name);
  const tmp: number[] = [0, 0, 0, 0];
  let rootMotion: Vec3 = [0, 0, 0];

  a.clip.bones.forEach((bone, i) => {
    const node = joints[i];
    if (!bone || !node) return;
    if (bone.rotation) {
      const out = new Float32Array((frames + 1) * 4);
      let prev: Quat | null = null;
      for (let f = 0; f <= frames; f++) {
        evaluateChannel(bone.rotation, f, tmp);
        let q = mq([tmp[0]!, tmp[1]!, tmp[2]!, tmp[3]!]);
        const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        q = [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
        if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
        out.set(q, f * 4);
        prev = q;
      }
      const sampler = doc.createAnimationSampler().setInput(input).setInterpolation('LINEAR')
        .setOutput(doc.createAccessor().setType('VEC4').setArray(out).setBuffer(buffer));
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(sampler));
    }
    if (bone.translation) {
      const out = new Float32Array((frames + 1) * 3);
      const start: number[] = [0, 0, 0];
      evaluateChannel(bone.translation, 0, start);
      for (let f = 0; f <= frames; f++) {
        evaluateChannel(bone.translation, f, tmp);
        if (i === 0) {
          if (f === frames) rootMotion = mv([tmp[0]! - start[0]!, 0, tmp[2]! - start[2]!]);
          if (inPlace) {
            tmp[0] = start[0]!;
            tmp[2] = start[2]!;
          }
        }
        out.set(mv([tmp[0]!, tmp[1]!, tmp[2]!]), f * 3);
      }
      const sampler = doc.createAnimationSampler().setInput(input).setInterpolation('LINEAR')
        .setOutput(doc.createAccessor().setType('VEC3').setArray(out).setBuffer(buffer));
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));
    }
  });
  anim.setExtras({
    label: a.label ?? '',
    frames,
    fps: ANI_FPS,
    rootMotion,
    events: a.clip.events,
  });
}

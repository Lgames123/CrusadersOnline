import * as THREE from 'three';
import { armorCoverage } from './armor_glow_coverage.ts';

/**
 * A refined item's glow (MMO items, docs/game-design/mmo/04 §4): from +3 the held weapon or shield
 * wears an additive shell of its own meshes, a little larger, coloured and pulsing by tier. The
 * shell has its own materials, so the shared item materials are never touched.
 */
const TIERS: readonly { from: number; color: number; strength: number; hz: number }[] = [
  { from: 10, color: 0xffffff, strength: 2.8, hz: 0.6 },
  { from: 9, color: 0xffd700, strength: 2.0, hz: 0.5 },
  { from: 7, color: 0xd500f9, strength: 1.3, hz: 0.4 },
  { from: 5, color: 0x00e5ff, strength: 0.75, hz: 0.3 },
  { from: 3, color: 0xcfd8dc, strength: 0.35, hz: 0 },
];

/**
 * The shells' additive material. The polygon offset wins depth ties with the item: where a shell
 * cannot stand off the surface (a thin fin's front and back push its edge both ways, the push
 * cancels) it lies on it, and would otherwise flicker in and out behind it.
 */
function glowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}

/** The glow of the item held at one attachment dummy: 'WPN RIGHT' (weapon) or 'WPN LEFT' (shield). */
export class HeldGlow {
  private shell: THREE.Group | null = null;
  private held: THREE.Object3D | null = null;
  private plus = 0;
  private readonly material = glowMaterial();
  private t = 0;

  private readonly dummy: 'WPN RIGHT' | 'WPN LEFT';

  constructor(dummy: 'WPN RIGHT' | 'WPN LEFT') {
    this.dummy = dummy;
  }

  /** 0-1 of the glow's full strength (the itemGlow / itemGlowIntensity settings); 0 = none. */
  intensity = 1;

  /** Each frame: the avatar's model and the held item's refinement (0 = none). */
  update(model: THREE.Object3D, plus: number, dt: number): void {
    this.t += dt;
    if (this.intensity <= 0) return this.clear();
    let mount: THREE.Object3D | undefined;
    model.traverse((o) => {
      if (!mount && o.name.trim().endsWith(this.dummy)) mount = o;
    });
    const held = mount?.children.find((c) => c !== this.shell) ?? null;
    if (!TIERS.some((x) => plus >= x.from) || !held) return this.clear();
    if (held !== this.held || plus !== this.plus || !this.shell) this.build(held, plus);
    paint(this.material, plus, this.t, this.intensity);
  }

  private build(held: THREE.Object3D, plus: number): void {
    this.clear();
    const shell = new THREE.Group();
    shell.name = 'held-glow';
    held.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(held.matrixWorld).invert();
    // Each mesh baked into the held item's frame, then pushed out along its normals by a fixed
    // thickness. Scaling about the mesh origin instead drifts parts whose pivot is far from them
    // (a mace head pivoting at the grip slides off the head).
    const parts: THREE.BufferGeometry[] = [];
    held.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || o === shell) return;
      const g = mesh.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
      parts.push(g);
    });
    const box = new THREE.Box3();
    for (const g of parts) {
      g.computeBoundingBox();
      box.union(g.boundingBox!);
    }
    const thickness = box.getSize(new THREE.Vector3()).length() * 0.012;
    for (const g of parts) {
      inflate(g, thickness);
      shell.add(glowMesh(new THREE.Mesh(g, this.material)));
    }
    held.add(shell);
    this.shell = shell;
    this.held = held;
    this.plus = plus;
  }

  clear(): void {
    this.shell?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.shell?.removeFromParent();
    this.shell = null;
    this.held = null;
    this.plus = 0;
  }
}

/**
 * Marks a shell mesh as not the character's own: ModelLighting keeps its material (its unlit swap
 * would drop the glow's shader hooks) and leaves it out of the silhouette shadow.
 */
function glowMesh<T extends THREE.Mesh>(mesh: T): T {
  mesh.userData['keepMaterial'] = true;
  mesh.userData['silhouette'] = true;
  mesh.castShadow = false;
  return mesh;
}

/** The tier's colour and pulse on a glow material; `scale` dims it (a whole body is a big shell). */
function paint(material: THREE.MeshBasicMaterial, plus: number, t: number, scale: number): void {
  const tier = TIERS.find((x) => plus >= x.from);
  if (!tier) return;
  const pulse = tier.hz ? 0.75 + 0.25 * Math.sin(t * Math.PI * 2 * tier.hz) : 1;
  material.opacity = Math.min(0.6, tier.strength * 0.21) * pulse * scale;
  if (plus >= 10) material.color.setHSL((t * 0.06) % 1, 0.8, 0.7);
  else material.color.setHex(tier.color);
}

/** World-space thickness of the armour shell (metres). */
const ARMOR_SHELL = 0.012;

/**
 * A refined armour's glow, same tiers as the weapon. Armour is not a held model: it swaps Drake's
 * whole skinned body (item_models.ts outfitFor), so the shell is a skinned copy of the body on the
 * same skeleton, pushed out along the skinned normals in the vertex shader. Inflating the geometry
 * up front is not safe here: some models keep their vertices bone-local. Only the parts painted as
 * armour glow: the shell keeps just the triangles the body texture's coverage marks as armour
 * (armor_glow_coverage.ts).
 */
export class ArmorGlow {
  private shells: THREE.SkinnedMesh[] = [];
  private body: THREE.SkinnedMesh | null = null;
  private plus = 0;
  private t = 0;
  private readonly thickness = { value: 0 };
  private readonly material = glowMaterial();

  constructor() {
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms['glowThickness'] = this.thickness;
      shader.vertexShader = `uniform float glowThickness;\nattribute float glowLift;\n${shader.vertexShader}`.replace(
        '#include <skinning_vertex>',
        '#include <skinning_vertex>\n#ifdef USE_SKINNING\n\ttransformed += normalize( objectNormal ) * glowThickness * glowLift;\n#endif',
      );
    };
    this.material.customProgramCacheKey = () => 'armor-glow';
  }

  /** 0-1 of the glow's full strength (the itemGlow / itemGlowIntensity settings); 0 = none. */
  intensity = 1;

  /** Each frame: the avatar's model and its armour's refinement (0 = none). */
  update(model: THREE.Object3D, plus: number, dt: number): void {
    this.t += dt;
    if (this.intensity <= 0) return this.clear();
    const bodies: THREE.SkinnedMesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && !this.shells.includes(m)) bodies.push(m);
    });
    if (!TIERS.some((x) => plus >= x.from) || !bodies.length) return this.clear();
    if (bodies[0] !== this.body || plus !== this.plus) this.build(bodies, plus);
    if (this.shells.length) paint(this.material, plus, this.t, 0.6 * this.intensity);
  }

  private build(bodies: THREE.SkinnedMesh[], plus: number): void {
    this.clear();
    this.body = bodies[0]!;
    this.plus = plus;
    // No coverage entry (an armour not authored yet, or no armour body): no glow.
    const covers = armorCoverage(((this.body.material as THREE.MeshBasicMaterial).map?.name) ?? '');
    if (!covers) return;
    this.thickness.value = ARMOR_SHELL / (this.body.getWorldScale(new THREE.Vector3()).x || 1);
    for (const body of bodies) {
      const geometry = armourOnly(body.geometry, covers);
      if (!geometry) continue;
      // A child with no transform of its own: in the default 'attached' bind mode the skinning
      // follows the body's skeleton and lands exactly on the body.
      const shell = new THREE.SkinnedMesh(geometry, this.material);
      shell.name = 'armor-glow';
      shell.bind(body.skeleton, body.bindMatrix);
      shell.frustumCulled = false;
      glowMesh(shell);
      body.add(shell);
      this.shells.push(shell);
    }
  }

  clear(): void {
    for (const s of this.shells) {
      s.geometry.dispose();
      s.removeFromParent();
    }
    this.shells = [];
    this.body = null;
    this.plus = 0;
  }
}

/**
 * A copy of the body keeping only the triangles whose UV centre is armour; null when none are.
 */
function armourOnly(body: THREE.BufferGeometry, covers: (u: number, v: number) => boolean): THREE.BufferGeometry | null {
  const uv = body.getAttribute('uv');
  if (!uv) return null;
  // A copy, not shared attributes: disposing the shell would free the body's GPU buffers too.
  const g = body.clone();
  const index = g.getIndex();
  const tri = index ? index.count / 3 : uv.count / 3;
  const at = (i: number) => (index ? index.getX(i) : i);
  const kept: number[] = [];
  for (let t = 0; t < tri; t++) {
    const [a, b, c] = [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)];
    if (covers((uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3, (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3)) kept.push(a, b, c);
  }
  if (!kept.length) return null;
  g.setIndex(kept);
  // The shell is pushed out along these (skinned like any normal), by glowLift thicknesses.
  const { dir, lift } = windingNormals(g);
  g.setAttribute('normal', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('glowLift', new THREE.BufferAttribute(lift, 1));
  return g;
}

/**
 * Moves every vertex out by `d` along the normal averaged over all vertices at that position, so
 * flat-shaded faces (split normals) stay joined instead of the shell cracking at the edges.
 */
function inflate(g: THREE.BufferGeometry, d: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const { dir, lift } = windingNormals(g);
  const moved = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    moved[i * 3] = pos.getX(i) + dir[i * 3]! * d * lift[i]!;
    moved[i * 3 + 1] = pos.getY(i) + dir[i * 3 + 1]! * d * lift[i]!;
    moved[i * 3 + 2] = pos.getZ(i) + dir[i * 3 + 2]! * d * lift[i]!;
  }
  g.setAttribute('position', new THREE.BufferAttribute(moved, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

/**
 * Per vertex, the outward direction from the triangles' winding, averaged over all vertices at
 * that position, and how far (0-1) the shell may go along it. The models' own normals cannot be
 * trusted for this: about a fifth of the armour bodies' vertices carry normals facing away from
 * the triangles drawn with them. Both are per position, so the shell never opens along an edge.
 */
function windingNormals(g: THREE.BufferGeometry): { dir: Float32Array; lift: Float32Array } {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const index = g.getIndex();
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  // Per position, each distinct face direction once: a box corner split into uneven triangles
  // still points out along its true diagonal.
  const dirs = new Map<string, Map<string, THREE.Vector3>>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const tri = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < tri; t++) {
    const [i, j, k] = index ? [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)] : [t * 3, t * 3 + 1, t * 3 + 2];
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, j);
    c.fromBufferAttribute(pos, k);
    const n = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
    if (n.lengthSq() === 0) continue;
    n.normalize();
    const nk = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`;
    for (const v of [i, j, k]) {
      let set = dirs.get(key(v));
      if (!set) dirs.set(key(v), (set = new Map()));
      set.set(nk, n);
    }
  }
  const at = new Map<string, { n: THREE.Vector3; lift: number }>();
  for (const [k, set] of dirs) {
    const n = new THREE.Vector3();
    for (const f of set.values()) n.add(f);
    n.normalize();
    // Full where every face here looks along n, none where one would end up behind the shell
    // (a thin fin's front and back, a fold): there the shell lies on the surface and the
    // material's polygon offset keeps it in front.
    let least = 1;
    for (const f of set.values()) least = Math.min(least, f.dot(n));
    at.set(k, { n, lift: THREE.MathUtils.clamp(least * 5, 0, 1) });
  }
  const dir = new Float32Array(pos.count * 3);
  const lift = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const here = at.get(key(i));
    if (!here) continue;
    here.n.toArray(dir, i * 3);
    lift[i] = here.lift;
  }
  return { dir, lift };
}

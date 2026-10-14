import * as THREE from 'three';
import type { LevelLight } from './level_light.ts';
import { dynamicLights } from './dynamic_lights.ts';

/**
 * Characters, props and items lit like the level: unlit texture times the light of the floor
 * under them (LevelLight), eased as they move; and a soft blob shadow on that floor. The player
 * and the characters nearest to them can instead cast a silhouette shadow: their meshes drawn
 * again, flattened onto the floor along a slightly slanted light (a stencil darkens each pixel
 * once), animated with them.
 */

/** Seconds between light samples of a moving thing, and how fast its light follows. */
const SAMPLE_EVERY = 0.15;
const FOLLOW = 6;
/** Light used before the first sample / off the level. */
const DEFAULT_LIGHT = new THREE.Color(0.8, 0.8, 0.8);
const SHADOW_OPACITY = 0.45;
/** Silhouette shadows: how many characters besides the player, within what distance (m). */
const SILHOUETTE_MAX = 6;
const SILHOUETTE_RANGE = 14;
const SILHOUETTE_OPACITY = 0.4;
/** Direction the light travels (down and a little aside), for the flattened silhouettes. */
const LIGHT_DIR = new THREE.Vector3(0.35, -1, 0.25).normalize();

type SilhouetteMaterial = THREE.MeshBasicMaterial & { floor: { value: number } };

/** A material that flattens a mesh onto the floor height `floor` along LIGHT_DIR. */
function silhouetteMaterial(): SilhouetteMaterial {
  const floor = { value: 0 };
  const m = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: SILHOUETTE_OPACITY,
    depthWrite: false,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  }) as SilhouetteMaterial;
  m.floor = floor;
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uFloor'] = floor;
    shader.uniforms['uLight'] = { value: LIGHT_DIR };
    shader.vertexShader = 'uniform float uFloor;\nuniform vec3 uLight;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      [
        'vec4 wp = modelMatrix * vec4(transformed, 1.0);',
        'wp.xyz += uLight * ((uFloor - wp.y) / uLight.y);',
        'wp.y = uFloor + 0.03;',
        'vec4 mvPosition = viewMatrix * wp;',
        'gl_Position = projectionMatrix * mvPosition;',
      ].join('\n'),
    );
  };
  m.customProgramCacheKey = () => 'silhouette-shadow';
  return m;
}

/** Copies of a character's meshes on the same skeleton / mounts, with the flattening material. */
function buildSilhouette(object: THREE.Object3D): { meshes: THREE.Mesh[]; material: SilhouetteMaterial } {
  const material = silhouetteMaterial();
  const sources: THREE.Mesh[] = [];
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData['silhouette']) sources.push(o as THREE.Mesh);
  });
  const meshes = sources.map((src) => {
    let s: THREE.Mesh;
    if ((src as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = src as THREE.SkinnedMesh;
      const copy = new THREE.SkinnedMesh(skinned.geometry, material);
      copy.bind(skinned.skeleton, skinned.bindMatrix);
      s = copy;
    } else s = new THREE.Mesh(src.geometry, material);
    s.position.copy(src.position);
    s.quaternion.copy(src.quaternion);
    s.scale.copy(src.scale);
    s.frustumCulled = false;
    s.renderOrder = 2;
    s.userData['silhouette'] = true;
    src.parent?.add(s);
    return s;
  });
  return { meshes, material };
}

interface Unlit {
  materials: THREE.MeshBasicMaterial[];
  /** The ambient cube the enhanced lighting lights them by (shared by the object's materials). */
  ambient: { value: THREE.Color[] };
}

/** Swaps an object's materials for unlit copies (once); returns them. */
function unlitMaterials(object: THREE.Object3D): Unlit {
  const cached = object.userData['unlit'] as Unlit | undefined;
  if (cached) return cached;
  const list: THREE.MeshBasicMaterial[] = [];
  const ambient = { value: Array.from({ length: 6 }, () => DEFAULT_LIGHT.clone()) };
  const copies = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material): THREE.Material => {
      if (o.userData['keepMaterial']) return m;
      let c = copies.get(m);
      if (!c) {
        const src = m as THREE.MeshStandardMaterial;
        c = new THREE.MeshBasicMaterial({
          map: src.map ?? null,
          transparent: src.transparent,
          opacity: src.opacity,
          alphaTest: src.alphaTest,
          side: src.side,
          depthWrite: src.depthWrite,
          name: src.name,
        });
        c.color.copy(DEFAULT_LIGHT);
        dynamicLights.enhance(c, ambient);
        copies.set(m, c);
        list.push(c);
      }
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  const unlit = { materials: list, ambient };
  object.userData['unlit'] = unlit;
  return unlit;
}

/** A soft round shadow texture (shared). */
let shadowTexture: THREE.Texture | null = null;
function blobTexture(): THREE.Texture {
  if (shadowTexture) return shadowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  shadowTexture = new THREE.CanvasTexture(c);
  return shadowTexture;
}

interface Tracked {
  object: THREE.Object3D;
  materials: THREE.MeshBasicMaterial[];
  light: THREE.Color;
  target: THREE.Color;
  /** Enhanced lighting: the ambient cube (eased like `light`) and the one sampled last. */
  ambient: THREE.Color[];
  ambientTarget: THREE.Color[];
  shadow: THREE.Mesh | null;
  floor: number | null;
  next: number;
  /** Static things (props, items) are sampled once. */
  still: boolean;
  /** Characters can cast a silhouette (built when first needed). */
  character: boolean;
  silhouette: { meshes: THREE.Mesh[]; material: SilhouetteMaterial } | null;
}

export class ModelLighting {
  private readonly tracked = new Map<unknown, Tracked>();
  private readonly scene: THREE.Scene;
  private level: LevelLight | null = null;
  private readonly at = new THREE.Vector3();
  private readonly shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly shadowMat: THREE.MeshBasicMaterial;
  /** Silhouette shadows on (the setting). */
  silhouettes = true;
  /** The player's key: always given a silhouette when they are on. */
  playerKey: unknown = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, opacity: SHADOW_OPACITY, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }

  /** The level whose light things take (null: plain grey light, no shadows). */
  setLevel(level: LevelLight | null): void {
    this.level = level;
    this.resample();
  }

  /** Samples everything again (a new level, the enhanced lighting turned on or off). */
  resample(): void {
    for (const t of this.tracked.values()) {
      t.next = 0;
      if (t.still) t.floor = null;
    }
  }

  /**
   * Lights `object` by the place it stands in, with a blob shadow of `radius` metres (0: none).
   * `still`: it does not move (sampled once).
   */
  track(key: unknown, object: THREE.Object3D, radius: number, still = false, character = false): void {
    if (this.tracked.has(key)) return;
    let shadow: THREE.Mesh | null = null;
    if (radius > 0) {
      shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      shadow.scale.set(radius * 2, 1, radius * 2);
      shadow.renderOrder = 1;
      shadow.visible = false;
      this.scene.add(shadow);
    }
    const light = DEFAULT_LIGHT.clone();
    const unlit = unlitMaterials(object);
    const ambientTarget = unlit.ambient.value.map((c) => c.clone());
    this.tracked.set(key, { object, materials: unlit.materials, light, target: light.clone(), ambient: unlit.ambient.value, ambientTarget, shadow, floor: null, next: 0, still, character, silhouette: null });
  }

  /** The keys casting silhouettes this frame: the player and up to SILHOUETTE_MAX characters near them. */
  private chooseSilhouettes(): Set<unknown> {
    const out = new Set<unknown>();
    if (!this.silhouettes || this.playerKey === null) return out;
    const me = this.tracked.get(this.playerKey);
    if (!me) return out;
    out.add(this.playerKey);
    const centre = me.object.getWorldPosition(new THREE.Vector3());
    const near: { key: unknown; d: number }[] = [];
    const p = new THREE.Vector3();
    for (const [key, t] of this.tracked) {
      if (!t.character || key === this.playerKey || !isShown(t.object)) continue;
      const d = t.object.getWorldPosition(p).distanceTo(centre);
      if (d <= SILHOUETTE_RANGE) near.push({ key, d });
    }
    near.sort((a, b) => a.d - b.d);
    for (const n of near.slice(0, SILHOUETTE_MAX)) out.add(n.key);
    return out;
  }

  forget(key: unknown): void {
    const t = this.tracked.get(key);
    if (!t) return;
    if (t.shadow) this.scene.remove(t.shadow);
    if (t.silhouette) {
      for (const s of t.silhouette.meshes) s.removeFromParent();
      t.silhouette.material.dispose();
    }
    this.tracked.delete(key);
  }

  clear(): void {
    for (const k of [...this.tracked.keys()]) this.forget(k);
  }

  update(dt: number, now: number): void {
    const cast = this.chooseSilhouettes();
    for (const [key, t] of this.tracked) {
      const visible = isShown(t.object);
      if (t.shadow) t.shadow.visible = false;
      if (!visible) continue;
      t.object.getWorldPosition(this.at);
      if (now >= t.next && (!t.still || t.floor === null)) {
        t.next = now + SAMPLE_EVERY;
        t.floor = this.level ? this.level.sample(this.at, t.target) : null;
        if (t.floor === null) t.target.copy(DEFAULT_LIGHT);
        if (!dynamicLights.enabled || t.floor === null || !this.level!.ambientCube(this.at, t.ambientTarget)) for (const c of t.ambientTarget) c.copy(t.target);
        if (t.still) {
          t.light.copy(t.target);
          t.ambient.forEach((c, i) => c.copy(t.ambientTarget[i]!));
        }
      }
      if (!t.still) {
        const k = Math.min(1, dt * FOLLOW);
        t.light.lerp(t.target, k);
        if (dynamicLights.enabled) t.ambient.forEach((c, i) => c.lerp(t.ambientTarget[i]!, k));
      }
      for (const m of t.materials) m.color.copy(t.light);
      const grounded = t.floor !== null && this.at.y - t.floor < 3;
      const silhouette = grounded && cast.has(key);
      if (silhouette) {
        const s = (t.silhouette ??= buildSilhouette(t.object));
        s.material.floor.value = t.floor!;
      }
      if (t.silhouette) for (const s of t.silhouette.meshes) s.visible = silhouette;
      if (t.shadow && grounded && !silhouette) {
        t.shadow.visible = true;
        t.shadow.position.set(this.at.x, t.floor! + 0.02, this.at.z);
      }
    }
  }
}

function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

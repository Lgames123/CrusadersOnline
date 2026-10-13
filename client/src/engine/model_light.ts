import * as THREE from 'three';
import type { LevelLight } from './level_light.ts';

/**
 * Characters, props and items lit like the level: unlit texture times the light of the floor
 * under them (LevelLight), eased as they move; and a soft blob shadow on that floor.
 */

/** Seconds between light samples of a moving thing, and how fast its light follows. */
const SAMPLE_EVERY = 0.15;
const FOLLOW = 6;
/** Light used before the first sample / off the level. */
const DEFAULT_LIGHT = new THREE.Color(0.8, 0.8, 0.8);
const SHADOW_OPACITY = 0.45;

/** Swaps an object's materials for unlit copies (once); returns them. */
function unlitMaterials(object: THREE.Object3D): THREE.MeshBasicMaterial[] {
  const cached = object.userData['unlit'] as THREE.MeshBasicMaterial[] | undefined;
  if (cached) return cached;
  const list: THREE.MeshBasicMaterial[] = [];
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
        copies.set(m, c);
        list.push(c);
      }
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  object.userData['unlit'] = list;
  return list;
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
  shadow: THREE.Mesh | null;
  floor: number | null;
  next: number;
  /** Static things (props, items) are sampled once. */
  still: boolean;
}

export class ModelLighting {
  private readonly tracked = new Map<unknown, Tracked>();
  private readonly scene: THREE.Scene;
  private level: LevelLight | null = null;
  private readonly at = new THREE.Vector3();
  private readonly shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly shadowMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, opacity: SHADOW_OPACITY, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }

  /** The level whose light things take (null: plain grey light, no shadows). */
  setLevel(level: LevelLight | null): void {
    this.level = level;
    for (const t of this.tracked.values()) t.next = 0;
  }

  /**
   * Lights `object` by the place it stands in, with a blob shadow of `radius` metres (0: none).
   * `still`: it does not move (sampled once).
   */
  track(key: unknown, object: THREE.Object3D, radius: number, still = false): void {
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
    this.tracked.set(key, { object, materials: unlitMaterials(object), light, target: light.clone(), shadow, floor: null, next: 0, still });
  }

  forget(key: unknown): void {
    const t = this.tracked.get(key);
    if (!t) return;
    if (t.shadow) this.scene.remove(t.shadow);
    this.tracked.delete(key);
  }

  clear(): void {
    for (const k of [...this.tracked.keys()]) this.forget(k);
  }

  update(dt: number, now: number): void {
    for (const t of this.tracked.values()) {
      const visible = isShown(t.object);
      if (t.shadow) t.shadow.visible = false;
      if (!visible) continue;
      t.object.getWorldPosition(this.at);
      if (now >= t.next && (!t.still || t.floor === null)) {
        t.next = now + SAMPLE_EVERY;
        t.floor = this.level ? this.level.sample(this.at, t.target) : null;
        if (t.floor === null) t.target.copy(DEFAULT_LIGHT);
        if (t.still) t.light.copy(t.target);
      }
      if (!t.still) t.light.lerp(t.target, Math.min(1, dt * FOLLOW));
      for (const m of t.materials) m.color.copy(t.light);
      if (t.shadow && t.floor !== null && this.at.y - t.floor < 3) {
        t.shadow.visible = true;
        t.shadow.position.set(this.at.x, t.floor + 0.02, this.at.z);
      }
    }
  }
}

function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

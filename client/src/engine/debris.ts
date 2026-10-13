import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LEVEL_UNIT_METRES } from '@crusaders/shared';

/**
 * Debris of struck and broken props, as the original throws it (spawner 0x43E310, logged on
 * barrels): physical chunks drawn from a table of 16 debris models (0x4EE1B8: models.ctx ids
 * 58 59 188 222 189 222 226 223 188 58 176 113 188 189 176 113) wearing the struck object's own
 * texture, placed at random in a box (half extents) about a centre and sent off with velocity
 * (place - centre) x speed. Each hit throws 5 chips (±1.2 ft, speed 40); breaking throws 3-12
 * pieces through the object's volume (speed 1). Landed blows on creatures throw 5 chips too, in
 * the victim's texture (0x0044D0xx).
 *
 * Each piece (setup 0x4108B0) is shrunk to fit (0.4 / count)^(1/3) x the half extents per axis
 * (never enlarged), spins at 60-150 / 50-150 / 40-150 degrees a second about its axes and lives
 * 5-10 s, or 1.5 s when that box is under 2 cubic feet (the chips of a blow).
 */
const TABLE = ['debriswood01', 'debriswood02', 'wddbs1', 'wd1lrg', 'wddbs2', 'wd1lrg', 'wdpcs1', 'wd1sml', 'wddbs1', 'debriswood01', 'stndbs', 'debrisstone01', 'wddbs1', 'wddbs2', 'stndbs', 'debrisstone01'];
const GRAVITY = 9.8;
/** Kept share of the vertical speed at a bounce, and of the horizontal one. */
const BOUNCE = 0.3;
const FRICTION = 0.5;
/** Life of a piece (5-10 s; 1.5 s for small ones) and the fade at its end. */
const LIFE_MIN = 5;
const LIFE_SPREAD = 5;
const SMALL_LIFE = 1.5;
/** Pieces whose box is under this many cubic feet are small. */
const SMALL_VOLUME = 2;
const FADE = 0.5;
const DEG = Math.PI / 180;
const MAX_PIECES = 160;

interface Piece {
  object: THREE.Object3D;
  materials: THREE.MeshBasicMaterial[];
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  floor: number;
  age: number;
  life: number;
}

export class Debris {
  private readonly pieces: Piece[] = [];
  private readonly scene: THREE.Scene;
  private readonly models: (THREE.Object3D | null)[];

  private constructor(scene: THREE.Scene, models: (THREE.Object3D | null)[]) {
    this.scene = scene;
    this.models = models;
  }

  static async load(scene: THREE.Scene): Promise<Debris | null> {
    try {
      const manifest = (await (await fetch('/generated/manifest.json')).json()) as { models?: Record<string, string> };
      const loader = new GLTFLoader();
      const byName = new Map<string, Promise<THREE.Object3D | null>>();
      const models = await Promise.all(TABLE.map((name) => {
        const url = manifest.models?.[name];
        if (!url) return null;
        let p = byName.get(name);
        if (!p) byName.set(name, (p = loader.loadAsync(`/generated/${url}`).then((g) => g.scene as THREE.Object3D, () => null)));
        return p;
      }));
      return models.some(Boolean) ? new Debris(scene, models) : null;
    } catch {
      return null;
    }
  }

  /**
   * Throws `count` pieces wearing `source`'s texture, placed in the box of half extents `half`
   * (metres) about `centre` (only above `floor`), at (place - centre) x `speed` per second.
   */
  spawn(source: THREE.Object3D, count: number, half: THREE.Vector3, centre: THREE.Vector3, speed: number, floor: number, light?: THREE.Color): void {
    const map = textureOf(source);
    // Piece box, feet: (0.4 / count)^(1/3) x the half extents.
    const fit = Math.cbrt(0.4 / Math.max(1, count)) / LEVEL_UNIT_METRES;
    const box = new THREE.Vector3(half.x * fit, half.y * fit, half.z * fit);
    const life = box.x * box.y * box.z < SMALL_VOLUME ? SMALL_LIFE : -1;
    for (let i = 0; i < count; i++) {
      const model = this.models[Math.floor(Math.random() * this.models.length)];
      if (!model) continue;
      const object = model.clone(true);
      const materials: THREE.MeshBasicMaterial[] = [];
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Unlit, in the light of the floor they fall on (like the props themselves).
        const m = new THREE.MeshBasicMaterial({ map: map ?? (mesh.material as THREE.MeshStandardMaterial).map ?? null, transparent: true });
        if (light) m.color.copy(light);
        mesh.material = m;
        materials.push(m);
      });
      // Shrunk to the piece box per axis (never enlarged).
      const ext = extentOf(model);
      object.scale.set(
        LEVEL_UNIT_METRES * (ext.x > 0 ? Math.min(ext.x, box.x) / ext.x : 1),
        LEVEL_UNIT_METRES * (ext.y > 0 ? Math.min(ext.y, box.y) / ext.y : 1),
        LEVEL_UNIT_METRES * (ext.z > 0 ? Math.min(ext.z, box.z) / ext.z : 1),
      );
      const place = new THREE.Vector3(
        centre.x + (Math.random() * 2 - 1) * half.x,
        Math.max(floor + 0.05, centre.y + (Math.random() * 2 - 1) * half.y),
        centre.z + (Math.random() * 2 - 1) * half.z,
      );
      object.position.copy(place);
      object.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
      this.scene.add(object);
      this.pieces.push({
        object,
        materials,
        velocity: place.clone().sub(centre).multiplyScalar(speed),
        spin: new THREE.Vector3((60 + Math.random() * 90) * DEG, (50 + Math.random() * 100) * DEG, (40 + Math.random() * 110) * DEG),
        floor,
        age: 0,
        life: life > 0 ? life : LIFE_MIN + Math.random() * LIFE_SPREAD,
      });
    }
    while (this.pieces.length > MAX_PIECES) this.remove(0);
  }

  update(dt: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        this.remove(i);
        continue;
      }
      if (p.age > p.life - FADE) for (const m of p.materials) m.opacity = (p.life - p.age) / FADE;
      const o = p.object;
      if (p.velocity.lengthSq() > 1e-4 || o.position.y > p.floor + 1e-3) {
        p.velocity.y -= GRAVITY * dt;
        o.position.addScaledVector(p.velocity, dt);
        o.rotation.x += p.spin.x * dt;
        o.rotation.y += p.spin.y * dt;
        o.rotation.z += p.spin.z * dt;
        if (o.position.y <= p.floor) {
          // A small bounce, then it settles.
          o.position.y = p.floor;
          p.velocity.y = Math.abs(p.velocity.y) > 0.6 ? -p.velocity.y * BOUNCE : 0;
          p.velocity.x *= FRICTION;
          p.velocity.z *= FRICTION;
          p.spin.multiplyScalar(FRICTION);
          if (p.velocity.y === 0 && Math.hypot(p.velocity.x, p.velocity.z) < 0.1) p.velocity.set(0, 0, 0), p.spin.set(0, 0, 0);
        }
      }
    }
  }

  private remove(i: number): void {
    const p = this.pieces[i]!;
    this.scene.remove(p.object);
    for (const m of p.materials) m.dispose();
    this.pieces.splice(i, 1);
  }
}

const extents = new WeakMap<THREE.Object3D, THREE.Vector3>();
/** A debris model's size in its own units (feet). */
function extentOf(model: THREE.Object3D): THREE.Vector3 {
  let e = extents.get(model);
  if (!e) {
    e = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    extents.set(model, e);
  }
  return e;
}

/** The first texture of an object's meshes. */
function textureOf(source: THREE.Object3D): THREE.Texture | null {
  let map: THREE.Texture | null = null;
  source.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (map || !mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) map ??= (m as THREE.MeshStandardMaterial).map ?? null;
  });
  return map;
}

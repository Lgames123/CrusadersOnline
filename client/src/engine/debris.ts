import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LEVEL_UNIT_METRES } from '@crusaders/shared';

/**
 * Debris of struck and broken props, as the original throws it (spawner 0x43E310, logged on
 * barrels): physical chunks drawn from a table of 16 debris models (0x4EE1B8: models.ctx ids
 * 58 59 188 222 189 222 226 223 188 58 176 113 188 189 176 113) wearing the struck object's own
 * texture, placed at random in a box (half extents) about a centre and sent off with velocity
 * (place - centre) x speed. Each hit throws 5 chips (±1.2 ft, speed 40); breaking throws 3-12
 * pieces through the object's volume (speed 1). They bounce a little, lie still and vanish after
 * ten-odd seconds (playtest).
 */
const TABLE = ['debriswood01', 'debriswood02', 'wddbs1', 'wd1lrg', 'wddbs2', 'wd1lrg', 'wdpcs1', 'wd1sml', 'wddbs1', 'debriswood01', 'stndbs', 'debrisstone01', 'wddbs1', 'wddbs2', 'stndbs', 'debrisstone01'];
const GRAVITY = 9.8;
/** Kept share of the vertical speed at a bounce, and of the horizontal one. */
const BOUNCE = 0.3;
const FRICTION = 0.5;
/** Seconds on the ground before a piece goes, and the fade at the end. */
const LIFE = 12;
const FADE = 1;
const MAX_PIECES = 160;

interface Piece {
  object: THREE.Object3D;
  materials: THREE.Material[];
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  floor: number;
  age: number;
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
  spawn(source: THREE.Object3D, count: number, half: THREE.Vector3, centre: THREE.Vector3, speed: number, floor: number): void {
    const map = textureOf(source);
    for (let i = 0; i < count; i++) {
      const model = this.models[Math.floor(Math.random() * this.models.length)];
      if (!model) continue;
      const object = model.clone(true);
      const materials: THREE.Material[] = [];
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        if (map) m.map = map;
        m.transparent = true;
        mesh.material = m;
        materials.push(m);
      });
      object.scale.setScalar(LEVEL_UNIT_METRES);
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
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8),
        floor,
        age: 0,
      });
    }
    while (this.pieces.length > MAX_PIECES) this.remove(0);
  }

  update(dt: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i]!;
      p.age += dt;
      if (p.age >= LIFE) {
        this.remove(i);
        continue;
      }
      if (p.age > LIFE - FADE) for (const m of p.materials) m.opacity = (LIFE - p.age) / FADE;
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

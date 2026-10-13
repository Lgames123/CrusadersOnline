import * as THREE from 'three';

/**
 * The original's special effects (script/effects.stg, converted to rules/effects.json): named
 * effects (SWORD_DAMAGE, SWORD_METAL, BONE, BLOOD...) made of sprite "flashes" that grow or
 * shrink, spin, fade in / hold / fade out and fly with gravity. The engine spawns them on hits
 * and blocks (executable-analysis §8.6); here the client spawns them from combat events.
 *
 * Units are not stated in the file; the sizes read as tenths of a foot (85 %, by eye against the
 * original), MOVE as units per 30 Hz engine tick and GRAVITY as units per tick per second (a
 * spark flies ~7 m/s and arcs gently; per tick squared pulled everything straight down).
 */

interface Shape {
  texture: string | null;
  center: [number, number, number, number];
}
interface Flash {
  shape: string;
  rotating: boolean;
  startHeight: number;
  deltaHeight: number;
  heightAcceleration: number;
  startWidth: number;
  deltaWidth: number;
  widthAcceleration: number;
  rotationSpeed: number;
  attack: number;
  sustain: number;
  decay: number;
  move: [number, number, number];
  gravity: [number, number, number];
  randomizeSize: number;
  randomizeMove: [number, number, number];
  position: [number, number, number];
  spawnMulti?: { name: string; interval: number; level: number };
}
interface Table {
  shapes: Record<string, Shape>;
  flashes: Record<string, Flash>;
  multis: Record<string, Record<string, [string, number][]>>;
}

/** One original unit, metres (a tenth of a foot). */
const UNIT = 0.03048;
/** Sprite sizes against the original, by eye (playtest: 15 % smaller). */
const SIZE_SCALE = 0.85;
/** Setting smallEffects (not original): half that again. */
export const SMALL_EFFECTS_SCALE = SIZE_SCALE * 0.5;
export const EFFECTS_SCALE = SIZE_SCALE;
/** The engine's tick rate for MOVE / GRAVITY (per tick). */
const ENGINE_HZ = 30;
const MAX_LIVE = 600;
/** Textures drawn with alpha (blood, chips, dust); the rest glow additively. */
const OPAQUE = /blood|bone|rock|dust|blacksmk|icecube|snow/;

interface Live {
  sprite: THREE.Sprite;
  flash: Flash;
  delay: number;
  age: number;
  life: number;
  alpha: number;
  h: number;
  w: number;
  vh: number;
  vw: number;
  vel: THREE.Vector3;
  grav: THREE.Vector3;
  spin: number;
  nextSpawn: number;
}

export class Effects {
  private readonly scene: THREE.Scene;
  private readonly table: Table;
  private readonly textureUrl: (name: string) => string | null;
  private readonly textures = new Map<string, THREE.Texture | null>();
  private readonly loader = new THREE.TextureLoader();
  private readonly live: Live[] = [];
  /** Size factor: SIZE_SCALE, or half of it with the smallEffects setting. */
  scale = SIZE_SCALE;

  private constructor(scene: THREE.Scene, table: Table, textureUrl: (name: string) => string | null) {
    this.scene = scene;
    this.table = table;
    this.textureUrl = textureUrl;
  }

  /** Loads the converted effects (null without an imported installation). */
  static async load(scene: THREE.Scene): Promise<Effects | null> {
    try {
      const res = await fetch('/generated/manifest.json');
      if (!res.ok) return null;
      const manifest = (await res.json()) as { rules?: Record<string, string>; textures: Record<string, string> };
      const file = manifest.rules?.['effects'];
      if (!file) return null;
      const table = (await (await fetch(`/generated/${file}`)).json()) as Table;
      return new Effects(scene, table, (name) => (manifest.textures[name] ? `/generated/${manifest.textures[name]}` : null));
    } catch {
      return null;
    }
  }

  private texture(name: string | null): THREE.Texture | null {
    if (!name) return null;
    if (!this.textures.has(name)) {
      const url = this.textureUrl(name);
      const tex = url ? this.loader.load(url) : null;
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(name, tex);
    }
    return this.textures.get(name) ?? null;
  }

  /**
   * Spawns a named effect (variant = spell level for spell effects) at `pos`. `dir` orients the
   * flashes' MOVE (+Z along it); without one they scatter around a random heading.
   */
  spawn(name: string, pos: THREE.Vector3, dir?: THREE.Vector3 | null, variant = 0): void {
    const variants = this.table.multis[name];
    const list = variants?.[variant] ?? variants?.[0];
    if (!list) return;
    const basis = new THREE.Matrix4();
    if (dir && dir.lengthSq() > 1e-6) {
      const z = dir.clone().normalize();
      const up = Math.abs(z.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const x = new THREE.Vector3().crossVectors(up, z).normalize();
      const y = new THREE.Vector3().crossVectors(z, x);
      basis.makeBasis(x, y, z);
    } else {
      basis.makeRotationY(Math.random() * Math.PI * 2);
    }
    for (const [flashName, delay] of list) {
      const flash = this.table.flashes[flashName];
      if (flash) this.add(flash, pos, basis, delay);
    }
  }

  private add(flash: Flash, pos: THREE.Vector3, basis: THREE.Matrix4, delay: number): void {
    if (this.live.length >= MAX_LIVE) return;
    const shape = this.table.shapes[flash.shape];
    const texName = shape?.texture ?? null;
    const c = shape?.center ?? [255, 255, 255, 255];
    const material = new THREE.SpriteMaterial({
      map: this.texture(texName),
      color: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255),
      transparent: true,
      depthWrite: false,
      // Some sprites (spark00) keep a faint alpha over the whole quad: drop it.
      alphaTest: 0.05,
      blending: texName && OPAQUE.test(texName) ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);
    const r = () => Math.random() * 2 - 1;
    const local = (v: [number, number, number], rand?: [number, number, number]) =>
      new THREE.Vector3(v[0] + (rand ? rand[0] * r() : 0), v[1] + (rand ? rand[1] * r() : 0), v[2] + (rand ? rand[2] * r() : 0)).applyMatrix4(basis);
    const offset = local(flash.position).multiplyScalar(UNIT);
    sprite.position.copy(pos).add(offset);
    const size = flash.randomizeSize * Math.random();
    const life = flash.attack + flash.sustain + flash.decay;
    this.live.push({
      sprite,
      flash,
      delay,
      age: 0,
      life: life > 0 ? life : 0.1,
      alpha: c[3] / 255,
      h: (flash.startHeight + size) * UNIT * this.scale,
      w: (flash.startWidth + size) * UNIT * this.scale,
      vh: flash.deltaHeight * UNIT * this.scale,
      vw: flash.deltaWidth * UNIT * this.scale,
      vel: local(flash.move, flash.randomizeMove).multiplyScalar(UNIT * ENGINE_HZ),
      grav: new THREE.Vector3(...flash.gravity).multiplyScalar(UNIT * ENGINE_HZ),
      spin: flash.rotating ? (flash.rotationSpeed * Math.PI) / 180 : 0,
      nextSpawn: flash.spawnMulti?.interval ?? 0,
    });
    sprite.visible = delay <= 0;
    sprite.scale.set(0.001, 0.001, 1);
    this.scene.add(sprite);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay > 0) continue;
        p.sprite.visible = true;
      }
      p.age += dt;
      const f = p.flash;
      if (p.age >= p.life) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.live.splice(i, 1);
        continue;
      }
      // Alpha envelope: attack (fade in), sustain, decay (fade out).
      const a = p.age < f.attack ? p.age / f.attack : p.age < f.attack + f.sustain ? 1 : f.decay > 0 ? 1 - (p.age - f.attack - f.sustain) / f.decay : 1;
      p.sprite.material.opacity = Math.max(0, Math.min(1, a)) * p.alpha;
      p.vh += f.heightAcceleration * UNIT * this.scale * dt;
      p.vw += f.widthAcceleration * UNIT * this.scale * dt;
      p.h = Math.max(0.001, p.h + p.vh * dt);
      p.w = Math.max(0.001, p.w + p.vw * dt);
      p.sprite.scale.set(p.w, p.h, 1);
      p.vel.addScaledVector(p.grav, dt);
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.material.rotation += p.spin * dt;
      // Trails: spawn another effect every interval while alive.
      if (f.spawnMulti && f.spawnMulti.interval > 0 && (p.nextSpawn -= dt) <= 0) {
        p.nextSpawn = f.spawnMulti.interval;
        this.spawn(f.spawnMulti.name, p.sprite.position, null, f.spawnMulti.level);
      }
    }
  }
}

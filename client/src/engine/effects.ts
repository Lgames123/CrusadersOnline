import * as THREE from 'three';

/**
 * The original's special effects (script/effects.stg, converted to rules/effects.json): named
 * effects (SWORD_DAMAGE, SWORD_METAL, BONE, BLOOD...) made of sprite "flashes" that grow or
 * shrink, spin, fade in / hold / fade out and fly with gravity. The engine spawns them on hits
 * and blocks (executable-analysis §8.6); here the client spawns them from combat events.
 *
 * Units, from the engine: the effects parser (0x4C45C0 / property setter 0x4C5170) keeps MOVE,
 * RANDOMIZE_MOVE and size speeds x 0.001 and GRAVITY and size accelerations x 10^-6 (per ms and
 * ms^2 of its integer-millisecond clock): feet per second and per second squared. A flash moves
 * (0x4C5B50) by its velocity, which gains GRAVITY turned by the flash's heading (about the
 * vertical only); POSITION is an offset in feet; ROTATIONSPEED is turns per second (x 2 pi). The
 * sprite (0x4A9990) draws a quad 0.05 ft per size unit: half-width size x 0.05 x 27.3 px-scale
 * over a view depth stored x 54.6.
 */

interface Shape {
  texture: string | null;
  center: [number, number, number, number];
  /** `SPHERE` shapes (`numpolys` 18) are drawn as a textured ball, not a camera-facing quad. */
  sphere?: boolean;
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

/** One foot (the world unit), metres. */
const FOOT = 0.3048;
/** Sprite size per size unit, metres (0.05 ft). */
const UNIT = 0.05 * FOOT;
const SIZE_SCALE = 1;
/** Setting smallEffects (not original): half that again. */
export const SMALL_EFFECTS_SCALE = SIZE_SCALE * 0.5;
export const EFFECTS_SCALE = SIZE_SCALE;
const MAX_LIVE = 600;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const zAxis = new THREE.Vector3();
/** A SPHERE shape's ball: 18 polygons (6 around, 3 bands), unit diameter. */
const SPHERE_GEOMETRY = new THREE.SphereGeometry(0.5, 6, 3);
/** Heading (about the vertical) of a basis' +Z: the original turns GRAVITY by the flash's heading only. */
function headingOf(basis: THREE.Matrix4): number {
  basis.extractBasis(new THREE.Vector3(), new THREE.Vector3(), zAxis);
  return Math.atan2(zAxis.x, zAxis.z);
}
/** Textures drawn with alpha (blood, chips, dust); the rest glow additively. */
const OPAQUE = /blood|bone|rock|dust|blacksmk|icecube|snow/;

/** An effect carried by something (a projectile): its flashes follow `pos` and end with stop(). */
export interface EffectHandle {
  readonly pos: THREE.Vector3;
  stop(): void;
}

interface Anchor {
  pos: THREE.Vector3;
  stopped: boolean;
}

interface Live {
  /** The flash: a sprite, or a ball for SPHERE shapes (its width across, height up). */
  sprite: THREE.Sprite | THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Attached flashes: positioned at the anchor plus `local`. */
  anchor?: Anchor;
  local?: THREE.Vector3;
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
  spawn(name: string, pos: THREE.Vector3, dir?: THREE.Vector3 | null, variant = 0, anchor?: Anchor): void {
    const variants = this.table.multis[name];
    // A level without its own variant takes the nearest lower one (0x00482150 steps down by level).
    let v = Math.min(variant, 3);
    while (v > 0 && !variants?.[v]) v--;
    const list = variants?.[v];
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
      if (flash) this.add(flash, pos, basis, delay, anchor);
    }
  }

  /**
   * An effect attached to something that moves (a spell projectile, 0x00482150 on its object):
   * its flashes follow the handle's position (their own motion relative to it) and end with
   * stop(); their trails (SPAWN_MULTI) are left in the world as usual.
   */
  attach(name: string, pos: THREE.Vector3, dir?: THREE.Vector3 | null, variant = 0): EffectHandle {
    const anchor: Anchor = { pos: pos.clone(), stopped: false };
    this.spawn(name, anchor.pos, dir, variant, anchor);
    return { pos: anchor.pos, stop: () => (anchor.stopped = true) };
  }

  private add(flash: Flash, pos: THREE.Vector3, basis: THREE.Matrix4, delay: number, anchor?: Anchor): void {
    if (this.live.length >= MAX_LIVE) return;
    const shape = this.table.shapes[flash.shape];
    const texName = shape?.texture ?? null;
    const c = shape?.center ?? [255, 255, 255, 255];
    const look = {
      map: this.texture(texName),
      color: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255),
      transparent: true,
      depthWrite: false,
      // Some sprites (spark00) keep a faint alpha over the whole quad: drop it.
      alphaTest: 0.05,
      blending: texName && OPAQUE.test(texName) ? THREE.NormalBlending : THREE.AdditiveBlending,
    };
    const sprite = shape?.sphere
      ? new THREE.Mesh(SPHERE_GEOMETRY, new THREE.MeshBasicMaterial({ ...look, alphaTest: 0, side: THREE.DoubleSide }))
      : new THREE.Sprite(new THREE.SpriteMaterial(look));
    const r = () => Math.random() * 2 - 1;
    const local = (v: [number, number, number], rand?: [number, number, number]) =>
      new THREE.Vector3(v[0] + (rand ? rand[0] * r() : 0), v[1] + (rand ? rand[1] * r() : 0), v[2] + (rand ? rand[2] * r() : 0)).applyMatrix4(basis);
    const offset = local(flash.position).multiplyScalar(FOOT);
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
      vel: local(flash.move, flash.randomizeMove).multiplyScalar(FOOT),
      grav: new THREE.Vector3(...flash.gravity).applyAxisAngle(Y_AXIS, headingOf(basis)).multiplyScalar(FOOT),
      spin: flash.rotating ? flash.rotationSpeed * Math.PI * 2 : 0,
      nextSpawn: flash.spawnMulti?.interval ?? 0,
      ...(anchor ? { anchor, local: offset.clone() } : {}),
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
      if (p.age >= p.life || p.anchor?.stopped) {
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
      if (p.sprite instanceof THREE.Mesh) p.sprite.scale.set(p.w, p.h, p.w);
      else p.sprite.scale.set(p.w, p.h, 1);
      p.vel.addScaledVector(p.grav, dt);
      if (p.anchor) p.sprite.position.copy(p.anchor.pos).add(p.local!.addScaledVector(p.vel, dt));
      else p.sprite.position.addScaledVector(p.vel, dt);
      if (p.sprite instanceof THREE.Mesh) p.sprite.rotation.y += p.spin * dt;
      else p.sprite.material.rotation += p.spin * dt;
      // Trails: spawn another effect every interval while alive.
      if (f.spawnMulti && f.spawnMulti.interval > 0 && (p.nextSpawn -= dt) <= 0) {
        p.nextSpawn = f.spawnMulti.interval;
        this.spawn(f.spawnMulti.name, p.sprite.position, null, f.spawnMulti.level);
      }
    }
  }
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER_HEIGHT, SPELL_INFO, type SpellEventMsg, type SpellId, type StatusTag } from '@crusaders/shared';
import type { EffectHandle, Effects } from './effects.ts';
import type { SoundBank } from '../audio/sound_bank.ts';
import { dynamicLights } from './dynamic_lights.ts';
import type { Avatar } from '../entities/avatar.ts';
import { BoomerVisuals } from './boomer_visuals.ts';

/**
 * What the spells look and sound like (SC.SPELL_EVENT): the original's effects.stg effects at
 * the hand, on the projectiles and where they land (names from 0x004F35F8, variant = level - 1),
 * the wind-ups hung on the hand dummies, Sound.ctx sounds, short lights, the lightning bolt's
 * texture strip, soul drinker's flow, holy wrath's and revelation's ring (ring.mdl) and the look
 * of timed effects on characters. Explosions, slow bursts and ice storms have no model in the
 * original (their objects carry none): only their effects show.
 *
 * Stand-ins (not decoded): soul drinker's line, snap freeze's flying glow, and the timed effects
 * as a tinted shell round the body (the original swaps the model's look: frozen flag 4 + model
 * +0x54, stone skin texture variants 6 / 8 / 10).
 */

type V3 = [number, number, number];

export interface SpellVisualHost {
  effects(): Effects | null;
  sounds(): SoundBank | null;
  /** A character's scene object and avatar (null when unknown here). */
  entity(id: number): { object: THREE.Object3D; avatar: Avatar } | null;
  /** The local player's entity id. */
  self(): number | null;
  /** A character's animation rate (slowed, frozen): 1 = normal. */
  setRate(id: number, rate: number): void;
}

interface ProjectileView {
  spell: SpellId;
  level: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** A glow for the projectiles whose look is not decoded (snap freeze). */
  sprite: THREE.Sprite | null;
  /** The projectile's own effect (effects.stg *_PROJ), carried along. */
  carried: EffectHandle | null;
  key: string;
}

interface Timed {
  object: THREE.Object3D;
  age: number;
  life: number;
  tick?(t: number, dt: number): void;
}

/**
 * Projectile looks: the effect it carries (effects.stg, table 0x004E2D38 for the fire ball; its
 * flashes last as long as the projectile and leave trails), a core glow and its light colour.
 */
const PROJECTILE_LOOK: Partial<Record<SpellId, { carried: string | null; core: number | null; light: number }>> = {
  // The fire ball and slow objects draw nothing of their own: their carried effect is the look.
  fireball: { carried: 'FIREBALL_PROJ', core: null, light: 0xff8a30 },
  slow: { carried: 'SLOW_PROJ', core: null, light: 0x9060ff },
  // Stand-in: snap freeze's flying look is not decoded (its object has component 0x004C1000).
  freeze: { carried: null, core: 0xa8e0ff, light: 0x80c8ff },
};

/**
 * The rings (classes 8 HolyWrath and 14, factories 0x0043FA90 / 0x00440AE0): models.ctx model 4,
 * ring.mdl, textures ringfire4 (holy wrath), unholyfire (a creature's unholy wrath; 0x0043FD30
 * picks texture holy == 0) and revelation (0x00440D70 picks 2).
 */
const RING_TEXTURE: Partial<Record<SpellId, string>> = { holy_wrath: 'ringfire4', revelation: 'revelation' };
const UNHOLY_RING_TEXTURE = 'unholyfire';

/**
 * The lightning bolt (render class 0x004E3340): a camera-facing strip through seven jittered
 * control points (0x004BFBB0; per point: side, height, along, and their random ranges; side is a
 * fraction of the bolt's horizontal length, height x 20 ft, along a fraction of the length), 15
 * nodes, texture lightning (lightningcap at the ends), alpha 255 falling 0.34 a millisecond
 * (0x004BF700): gone in 0.75 s. Width 40 per node (0x004C8FC0), read as effect size units
 * (0.05 ft) like the sprites: 2 ft.
 */
const BOLT_PROFILE: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 0, 0, 0, 0],
  [0, 0, 1 / 6, 0, 0, 0],
  [0.08, 0, 1 / 3, 0.08, 0.05, 0],
  [0, 0, 0.5, 0.08, 0.1, 0],
  [-0.06, 0, 2 / 3, 0.08, 0.05, 0],
  [0, 0, 5 / 6, 0, 0.05, 0],
  [0, 0, 1, 0, 0.05, 0],
];
const BOLT_NODES = 15;
const BOLT_LIFE = 255 / 0.34 / 1000;
const BOLT_WIDTH = 40 * 0.05 * 0.3048;
const FOOT = 0.3048;

/**
 * Heroism's look (status HERO, descriptor 1, step 0x0047E8E0): HEROISM_EFFECT (variant = level)
 * every 200 ms (0x004E2120), 6 ft above the character's feet, while it lasts.
 */
const HEROISM_PERIOD = 0.2;
const HEROISM_HEIGHT = 6 * 0.3048;

/**
 * Necros's Force Globe (class 15, factory 0x00440E70; update 0x004C1E20): models.ctx model 5
 * (model5.mdl, a unit sphere) wearing texture 1, `eglobe`, round its owner and turning about the
 * vertical while it lasts, blinking in its last moments. Sized here to enclose the owner (the
 * original scales it by the owner's bounding radius, +0x40); turn and blink rates approximate.
 */
const GLOBE_TURN = Math.PI / 2;
const GLOBE_BLINK_FROM = 2;

const glowTexture = (() => {
  let tex: THREE.Texture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

export class SpellVisuals {
  private readonly scene: THREE.Scene;
  private readonly host: SpellVisualHost;
  private readonly projectiles = new Map<number, ProjectileView>();
  private readonly timed: Timed[] = [];
  private readonly drains = new Map<number, { from: number; to: number; level: number; left: number; spawnIn: number; line: THREE.Line }>();
  private readonly statusOf = new Map<number, Set<StatusTag>>();
  /** Status levels as last sent (a status seen only by its tag counts as level 1). */
  private readonly statusLevel = new Map<string, number>();
  /** Heroism's periodic effect by character: seconds to the next. */
  private readonly heroism = new Map<number, { level: number; next: number }>();
  /** Force Globes by character: the sphere (a child of the character) and the seconds left. */
  private readonly globes = new Map<number, { mesh: THREE.Mesh | null; left: number }>();
  private globeGeometry: Promise<THREE.BufferGeometry | null> | null = null;
  private upperCasts = 0;
  private readonly tmp = new THREE.Vector3();
  /** Wind-ups following a character's dummies (+0x24 hangs them on the node, 0x00482150). */
  private readonly windups: { entity: number; node: number; handle: EffectHandle; left: number }[] = [];
  /** Converted textures and models by name (manifest), loaded once. */
  private manifest: Promise<{ textures: Record<string, string>; models: Record<string, string> } | null> | null = null;
  private readonly textures = new Map<string, Promise<THREE.Texture | null>>();
  private ringGeometry: Promise<THREE.BufferGeometry | null> | null = null;

  /** Boomer Axes in flight (not a spell, but sent with them). */
  private readonly boomer: BoomerVisuals;

  constructor(scene: THREE.Scene, host: SpellVisualHost) {
    this.scene = scene;
    this.host = host;
    this.boomer = new BoomerVisuals(scene, host);
  }

  /** One SC.SPELL_EVENT. */
  handle(d: SpellEventMsg['d']): void {
    const fx = this.host.effects();
    const sounds = this.host.sounds();
    if (d.cast) {
      const c = d.cast;
      // Another character casting on the move plays the spell on its upper body (the local player starts its own).
      if (c.phase === 'begin' && c.upper && c.caster !== this.host.self()) this.host.entity(c.caster)?.avatar.setUpperClip?.(SPELL_INFO[c.spell].asm, ++this.upperCasts);
    }
    for (const f of d.fx ?? []) {
      if (f.entity !== undefined && this.windup(f.name, f.entity, Math.max(0, f.level - 1))) continue;
      const pos = this.at(f.at, f.entity);
      if (!pos) continue;
      const dir = f.dir ? new THREE.Vector3(...f.dir) : null;
      fx?.spawn(f.name, pos, dir, Math.max(0, f.level - 1));
    }
    // Spell sounds carry to their Sound.ctx priority's distance (0x004B0FC0), some at a random rate.
    for (const s of d.sounds ?? []) sounds?.play(s.id, new THREE.Vector3(...s.at), { maxDistance: sounds.reach(s.id), ...(s.rate ? { rate: s.rate } : {}) });
    if (d.light) dynamicLights.flash(new THREE.Vector3(...d.light.at), new THREE.Color(d.light.color[0] / 255, d.light.color[1] / 255, d.light.color[2] / 255), 2.2, d.light.radius, d.light.seconds);
    for (const b of d.bolts ?? []) this.bolt(new THREE.Vector3(...b.from), new THREE.Vector3(...b.to));
    if (d.projectile) this.projectile(d.projectile);
    if (d.axe) this.boomer.handle(d.axe);
    if (d.burst) this.burst(d.burst);
    if (d.drain) this.drain(d.drain);
    for (const s of d.status ?? []) this.setStatus(s.target, s.tag, s.on, s.level, s.seconds);
  }

  /** The statuses an entity has as it comes into view (ENTITY_SPAWN), or the local player's (PLAYER_STATS). */
  syncStatuses(id: number, tags: readonly StatusTag[]): void {
    const have = this.statusOf.get(id) ?? new Set<StatusTag>();
    for (const t of [...have]) if (!tags.includes(t)) this.setStatus(id, t, false);
    for (const t of tags) if (!have.has(t)) this.setStatus(id, t, true);
  }

  /** A character left view: its looks go. */
  forget(id: number): void {
    for (const t of [...(this.statusOf.get(id) ?? [])]) this.setStatus(id, t, false);
  }

  /** Everything goes (zone change). */
  clear(): void {
    for (const id of [...this.statusOf.keys()]) this.forget(id);
    for (const w of this.windups) w.handle.stop();
    this.windups.length = 0;
    this.boomer.clear();
    for (const [id, p] of this.projectiles) {
      if (p.sprite) this.scene.remove(p.sprite);
      p.carried?.stop();
      dynamicLights.remove(p.key);
      this.projectiles.delete(id);
    }
    for (const t of this.timed) this.dispose(t.object);
    this.timed.length = 0;
    for (const [id, d] of this.drains) {
      this.dispose(d.line);
      this.drains.delete(id);
    }
  }

  update(dt: number): void {
    const fx = this.host.effects();
    this.boomer.update(dt);
    for (const p of this.projectiles.values()) {
      p.pos.addScaledVector(p.vel, dt);
      p.sprite?.position.copy(p.pos);
      p.carried?.pos.copy(p.pos);
      dynamicLights.set(p.key, p.pos, PROJECTILE_LOOK[p.spell]?.light ?? 0xffffff, 1.6, 5, 0.1);
    }
    for (let i = this.windups.length - 1; i >= 0; i--) {
      const w = this.windups[i]!;
      const e = this.host.entity(w.entity);
      if ((w.left -= dt) <= 0 || !e) {
        this.windups.splice(i, 1);
        continue;
      }
      e.avatar.attachPoint?.(w.node, w.handle.pos);
    }
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i]!;
      t.age += dt;
      if (t.age >= t.life) {
        this.dispose(t.object);
        this.timed.splice(i, 1);
        continue;
      }
      t.tick?.(t.age / t.life, dt);
    }
    for (const [id, d] of this.drains) {
      const a = this.mid(d.from);
      const b = this.mid(d.to);
      d.left -= dt;
      if (!a || !b || d.left <= 0) {
        this.dispose(d.line);
        this.drains.delete(id);
        continue;
      }
      const pos = d.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, a.x, a.y, a.z);
      pos.setXYZ(1, b.x, b.y, b.z);
      pos.needsUpdate = true;
      // Energy flowing from the drained to the drinker (SOULDRINKER_ENERGY along the line).
      if ((d.spawnIn -= dt) <= 0) {
        d.spawnIn = 0.1;
        const k = Math.random();
        fx?.spawn('SOULDRINKER_ENERGY', this.tmp.copy(a).lerp(b, k), b.clone().sub(a).normalize(), d.level - 1);
      }
    }
    for (const [id, h] of this.heroism) {
      if ((h.next -= dt) > 0) continue;
      h.next += HEROISM_PERIOD;
      const e = this.host.entity(id);
      if (e) fx?.spawn('HEROISM_EFFECT', this.tmp.copy(e.object.position).setY(e.object.position.y + HEROISM_HEIGHT), null, h.level - 1);
    }
    for (const g of this.globes.values()) {
      g.left -= dt;
      if (!g.mesh) continue;
      g.mesh.rotation.y += GLOBE_TURN * dt;
      g.mesh.visible = g.left > GLOBE_BLINK_FROM || Math.floor(g.left * 8) % 2 === 0;
    }
  }

  /** model5.mdl's mesh (models.ctx model 5), a unit sphere. */
  private globeMesh(): Promise<THREE.BufferGeometry | null> {
    return (this.globeGeometry ??= this.loadManifest().then(async (m) => {
      const file = m?.models['model5'];
      if (!file) return null;
      const gltf = await new GLTFLoader().loadAsync(`/generated/${file}`).catch(() => null);
      let geo: THREE.BufferGeometry | null = null;
      gltf?.scene.updateMatrixWorld(true);
      gltf?.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!geo && mesh.isMesh) geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      });
      return geo;
    }));
  }

  private globe(id: number, on: boolean, seconds: number | undefined): void {
    const have = this.globes.get(id);
    if (!on) {
      if (have?.mesh) this.dispose(have.mesh);
      this.globes.delete(id);
      return;
    }
    if (have) {
      if (seconds !== undefined) have.left = seconds;
      return;
    }
    const g = { mesh: null as THREE.Mesh | null, left: seconds ?? 10 };
    this.globes.set(id, g);
    void Promise.all([this.globeMesh(), this.texture('eglobe')]).then(([geo, tex]) => {
      const e = this.host.entity(id);
      if (!geo || !tex || !e || this.globes.get(id) !== g) return;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      // In the character's own (scaled) frame: round its body, centred at half its height.
      const k = e.object.scale.x || 1;
      const r = (e.avatar.headHeight * 0.62) / k;
      mesh.scale.setScalar(r);
      mesh.position.y = r * 0.85;
      e.object.add(mesh);
      g.mesh = mesh;
    });
  }

  // ---- parts ----

  private projectile(p: NonNullable<SpellEventMsg['d']['projectile']>): void {
    let v = this.projectiles.get(p.id);
    if (p.end) {
      if (v) {
        if (v.sprite) {
          this.scene.remove(v.sprite);
          v.sprite.material.dispose();
        }
        v.carried?.stop();
        dynamicLights.remove(v.key);
        this.projectiles.delete(p.id);
      }
      return;
    }
    if (!v) {
      const look = PROJECTILE_LOOK[p.spell];
      let sprite: THREE.Sprite | null = null;
      if (look?.core != null) {
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: look.core, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        sprite.scale.setScalar(0.55);
        this.scene.add(sprite);
      }
      const at = new THREE.Vector3(...p.pos);
      const carriedName = p.look ?? look?.carried;
      const carried = carriedName ? this.host.effects()?.attach(carriedName, at, new THREE.Vector3(...p.vel).normalize(), p.level - 1) ?? null : null;
      v = { spell: p.spell, level: p.level, pos: new THREE.Vector3(), vel: new THREE.Vector3(), sprite, carried, key: `spell-proj:${p.id}` };
      this.projectiles.set(p.id, v);
    }
    v.pos.set(...p.pos);
    v.vel.set(...p.vel);
    v.sprite?.position.copy(v.pos);
  }

  /**
   * A spell's wind-up (fx with an entity): hung on the caster's dummies (SpellInfo.windupNodes)
   * and following them while it lasts. False when `name` is no wind-up or the model has no
   * dummies (then it shows at the sent point).
   */
  private windup(name: string, entity: number, variant: number): boolean {
    const info = Object.values(SPELL_INFO).find((i) => i.windup === name);
    const e = info && this.host.entity(entity);
    const fx = this.host.effects();
    if (!info || !e || !fx || !e.avatar.attachPoint) return false;
    let any = false;
    for (const node of info.windupNodes) {
      const at = new THREE.Vector3();
      if (!e.avatar.attachPoint(node, at)) continue;
      // The flashes follow the node; their trails stay in the world as usual.
      this.windups.push({ entity, node, handle: fx.attach(name, at, null, variant), left: 3 });
      any = true;
    }
    return any;
  }

  private loadManifest(): Promise<{ textures: Record<string, string>; models: Record<string, string> } | null> {
    return (this.manifest ??= fetch('/generated/manifest.json')
      .then((r) => (r.ok ? (r.json() as Promise<{ textures: Record<string, string>; models: Record<string, string> }>) : null))
      .catch(() => null));
  }

  /** A converted texture, D3D v (flipY false, as the models' glTF UVs). */
  private texture(name: string): Promise<THREE.Texture | null> {
    let t = this.textures.get(name);
    if (!t) {
      t = this.loadManifest().then((m) => {
        const file = m?.textures[name];
        if (!file) return null;
        return new THREE.TextureLoader()
          .loadAsync(`/generated/${file}`)
          .then((tex) => {
            tex.flipY = false;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            return tex;
          })
          .catch(() => null);
      });
      this.textures.set(name, t);
    }
    return t;
  }

  /** ring.mdl's mesh (models.ctx model 4), in feet. */
  private ring(): Promise<THREE.BufferGeometry | null> {
    return (this.ringGeometry ??= this.loadManifest().then(async (m) => {
      const file = m?.models['ring'];
      if (!file) return null;
      const gltf = await new GLTFLoader().loadAsync(`/generated/${file}`).catch(() => null);
      let geo: THREE.BufferGeometry | null = null;
      gltf?.scene.updateMatrixWorld(true);
      gltf?.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!geo && mesh.isMesh) geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      });
      return geo;
    }));
  }

  /**
   * Holy wrath's and revelation's ring (0x004C1A80 / 0x004C1B60): ring.mdl scaled by the growing
   * radius r (ft) across and min(r, 10) up, turned 30 x r about the vertical (read as degrees),
   * gone when the object ends. The explosions' and slow bursts' objects have no model: nothing
   * is drawn for them.
   */
  private burst(b: NonNullable<SpellEventMsg['d']['burst']>): void {
    const texName = b.dark ? UNHOLY_RING_TEXTURE : RING_TEXTURE[b.spell];
    if (!texName) return;
    const at = new THREE.Vector3(...b.at);
    if (b.spell === 'holy_wrath') dynamicLights.flash(at, 0xfff0c0, 2.5, b.radius, b.seconds + 0.3);
    void Promise.all([this.ring(), this.texture(texName)]).then(([geo, tex]) => {
      if (!geo || !tex) return;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(at);
      mesh.scale.setScalar(0.0001);
      this.scene.add(mesh);
      const radiusFt = b.radius / FOOT;
      this.timed.push({
        object: mesh,
        age: 0,
        life: Math.max(0.05, b.seconds),
        tick: (k) => {
          const r = Math.max(0.01, radiusFt * k);
          mesh.scale.set(r * FOOT, Math.min(r, 10) * FOOT, r * FOOT);
          mesh.rotation.y = THREE.MathUtils.degToRad(30 * r);
        },
      });
    });
  }

  /** The lightning bolt's strip (see BOLT_PROFILE), fixed once drawn, fading out. */
  private bolt(from: THREE.Vector3, to: THREE.Vector3): void {
    const d = to.clone().sub(from);
    // Control points: along x d, side x (-dz, dx) (horizontal, the length's own size), height x 20 ft.
    const jitter = (base: number, range: number) => base + (Math.random() * 2 - 1) * range;
    const ctrl = BOLT_PROFILE.map(([x, y, z, rx, ry, rz]) => {
      const along = jitter(z, rz);
      const side = jitter(x, rx);
      const up = jitter(y, ry) * 20 * FOOT;
      return new THREE.Vector3(from.x + along * d.x - side * d.z, from.y + along * d.y + up, from.z + along * d.z + side * d.x);
    });
    const nodes = new THREE.CatmullRomCurve3(ctrl).getPoints(BOLT_NODES - 1);
    const n = nodes.length;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = i / (n - 1);
      uv.set([0, v, 1, v], i * 4);
      if (i < n - 1) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const strip = new THREE.Mesh(geo, mat);
    strip.frustumCulled = false;
    // Faces the camera: each node's edge across the strip and the view.
    const side = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const view = new THREE.Vector3();
    strip.onBeforeRender = (_r, _s, camera) => {
      for (let i = 0; i < n; i++) {
        const p = nodes[i]!;
        tangent.copy(nodes[Math.min(n - 1, i + 1)]!).sub(nodes[Math.max(0, i - 1)]!);
        view.copy(camera.position).sub(p);
        side.crossVectors(tangent, view).normalize().multiplyScalar(BOLT_WIDTH / 2);
        pos.set([p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z], i * 6);
      }
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    };
    const group = new THREE.Group();
    group.add(strip);
    const caps: THREE.SpriteMaterial[] = [];
    for (const p of [nodes[0]!, nodes[n - 1]!]) {
      const cm = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
      const cap = new THREE.Sprite(cm);
      cap.position.copy(p);
      cap.scale.setScalar(BOLT_WIDTH);
      caps.push(cm);
      group.add(cap);
    }
    void this.texture('lightning').then((t) => {
      mat.map = t;
      mat.needsUpdate = true;
    });
    void this.texture('lightningcap').then((t) => {
      for (const cm of caps) {
        cm.map = t;
        cm.needsUpdate = true;
      }
    });
    this.scene.add(group);
    this.timed.push({
      object: group,
      age: 0,
      life: BOLT_LIFE,
      tick: (k) => {
        mat.opacity = 1 - k;
        for (const cm of caps) cm.opacity = 1 - k;
      },
    });
  }

  private drain(d: NonNullable<SpellEventMsg['d']['drain']>): void {
    const old = this.drains.get(d.id);
    if (d.seconds <= 0) {
      if (old) {
        this.dispose(old.line);
        this.drains.delete(d.id);
      }
      return;
    }
    if (old) return;
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xd04060, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(line);
    this.drains.set(d.id, { from: d.from, to: d.to, level: d.level, left: d.seconds, spawnIn: 0, line });
  }

  /**
   * A timed effect's look. The original draws no shell: freeze only stops the animation (flag 4
   * on the controller, 0x0047E6F0) with SNAPFREEZE_TARGET where it struck, slow shows its
   * SLOW_TARGET on landing, heroism its periodic effect, stone skin the body's stone blend.
   */
  private setStatus(id: number, tag: StatusTag, on: boolean, level?: number, seconds?: number): void {
    let set = this.statusOf.get(id);
    if (!set) this.statusOf.set(id, (set = new Set()));
    if (on) set.add(tag);
    else set.delete(tag);
    if (!set.size) this.statusOf.delete(id);
    const key = `${id}:${tag}`;
    if (on && level) this.statusLevel.set(key, level);
    const lv = this.statusLevel.get(key) ?? 1;
    if (!on) this.statusLevel.delete(key);
    if (tag === 'HERO') {
      if (on && !this.heroism.has(id)) this.heroism.set(id, { level: lv, next: 0 });
      else if (on) this.heroism.get(id)!.level = lv;
      else this.heroism.delete(id);
    }
    if (tag === 'STON') this.host.entity(id)?.avatar.setStoneSkin?.(on ? lv : 0);
    if (tag === 'GLOB') this.globe(id, on, seconds);
    // Pace: frozen / stunned stop, slowed play slower.
    const tags = this.statusOf.get(id);
    const rate = !tags ? 1 : tags.has('FRZE') || tags.has('THAW') ? 0 : tags.has('SLOW') ? 0.3 : 1;
    this.host.setRate(id, rate);
  }

  private at(at: V3, entity?: number): THREE.Vector3 | null {
    if (entity === undefined) return new THREE.Vector3(...at);
    const e = this.host.entity(entity);
    if (!e) return null;
    return e.object.position.clone().add(new THREE.Vector3(...at));
  }

  private mid(id: number): THREE.Vector3 | null {
    const e = this.host.entity(id);
    return e ? e.object.position.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT * 0.55, 0)) : null;
  }

  private dispose(o: THREE.Object3D): void {
    o.parent?.remove(o);
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((y) => y.dispose());
      else mat?.dispose();
    });
  }
}

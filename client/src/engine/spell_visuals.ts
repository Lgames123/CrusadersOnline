import * as THREE from 'three';
import { PLAYER_HEIGHT, SPELL_INFO, type SpellEventMsg, type SpellId, type StatusTag } from '@crusaders/shared';
import type { EffectHandle, Effects } from './effects.ts';
import type { SoundBank } from '../audio/sound_bank.ts';
import { dynamicLights } from './dynamic_lights.ts';
import type { Avatar } from '../entities/avatar.ts';

/**
 * What the spells look and sound like (SC.SPELL_EVENT): the original's effects.stg effects at
 * the hand, on the projectiles and where they land (names from 0x004F35F8, variant = level - 1),
 * Sound.ctx sounds, short lights, lightning bolts, soul drinker's flow, growing bursts and the
 * look of timed effects on characters.
 *
 * Stand-ins (not decoded): the bolts are drawn as jagged lines (the original's lightning
 * texture strips, 0x004BF680), bursts as fading shells, and the timed effects as a tinted shell
 * round the body (the original swaps the model's look: frozen flag 4 + model +0x54, stone skin
 * texture variants 6 / 8 / 10).
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
  sprite: THREE.Sprite;
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
const PROJECTILE_LOOK: Partial<Record<SpellId, { carried: string | null; core: number; light: number }>> = {
  fireball: { carried: 'FIREBALL_PROJ', core: 0xffa040, light: 0xff8a30 },
  slow: { carried: 'SLOW_PROJ', core: 0xb080ff, light: 0x9060ff },
  freeze: { carried: null, core: 0xa8e0ff, light: 0x80c8ff },
};

/** Burst shells (holy wrath, revelation, the explosions): colour and blending. */
const BURST_LOOK: Partial<Record<SpellId, { color: number; opacity: number }>> = {
  holy_wrath: { color: 0xfff0b0, opacity: 0.35 },
  revelation: { color: 0xe8f0ff, opacity: 0.3 },
  fireball: { color: 0xff9040, opacity: 0.25 },
  slow: { color: 0xa070ff, opacity: 0.25 },
};

/** Timed-effect shells: colour, opacity, additive. */
const STATUS_LOOK: Partial<Record<StatusTag, { color: number; opacity: number; additive: boolean }>> = {
  FRZE: { color: 0xaee4ff, opacity: 0.5, additive: false },
  STON: { color: 0x8c8678, opacity: 0.4, additive: false },
  HERO: { color: 0xffc860, opacity: 0.16, additive: true },
  SLOW: { color: 0x9a70ff, opacity: 0.14, additive: true },
};

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
  /** Status shells by character, by tag. */
  private readonly shells = new Map<number, Map<StatusTag, THREE.Mesh>>();
  private readonly statusOf = new Map<number, Set<StatusTag>>();
  private upperCasts = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, host: SpellVisualHost) {
    this.scene = scene;
    this.host = host;
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
      const pos = this.at(f.at, f.entity);
      if (!pos) continue;
      const dir = f.dir ? new THREE.Vector3(...f.dir) : null;
      fx?.spawn(f.name, pos, dir, Math.max(0, f.level - 1));
    }
    for (const s of d.sounds ?? []) sounds?.play(s.id, new THREE.Vector3(...s.at));
    if (d.light) dynamicLights.flash(new THREE.Vector3(...d.light.at), new THREE.Color(d.light.color[0] / 255, d.light.color[1] / 255, d.light.color[2] / 255), 2.2, d.light.radius, d.light.seconds);
    for (const b of d.bolts ?? []) this.bolt(new THREE.Vector3(...b.from), new THREE.Vector3(...b.to));
    if (d.projectile) this.projectile(d.projectile);
    if (d.burst) this.burst(d.burst);
    if (d.drain) this.drain(d.drain);
    for (const s of d.status ?? []) this.setStatus(s.target, s.tag, s.on);
  }

  /** The statuses an entity has as it comes into view (ENTITY_SPAWN), or the local player's (PLAYER_STATS). */
  syncStatuses(id: number, tags: readonly StatusTag[]): void {
    const have = this.statusOf.get(id) ?? new Set<StatusTag>();
    for (const t of [...have]) if (!tags.includes(t)) this.setStatus(id, t, false);
    for (const t of tags) if (!have.has(t)) this.setStatus(id, t, true);
  }

  /** A character left view: its shells go. */
  forget(id: number): void {
    for (const t of [...(this.statusOf.get(id) ?? [])]) this.setStatus(id, t, false);
  }

  /** Everything goes (zone change). */
  clear(): void {
    for (const id of [...this.statusOf.keys()]) this.forget(id);
    for (const [id, p] of this.projectiles) {
      this.scene.remove(p.sprite);
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
    for (const p of this.projectiles.values()) {
      p.pos.addScaledVector(p.vel, dt);
      p.sprite.position.copy(p.pos);
      p.carried?.pos.copy(p.pos);
      dynamicLights.set(p.key, p.pos, PROJECTILE_LOOK[p.spell]?.light ?? 0xffffff, 1.6, 5, 0.1);
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
    // Shells pulse a little and follow their character.
    const now = performance.now() / 1000;
    for (const [id, shells] of this.shells) {
      const e = this.host.entity(id);
      for (const [tag, mesh] of shells) {
        if (e && mesh.parent !== e.object) e.object.add(mesh);
        const look = STATUS_LOOK[tag];
        if (look && look.additive) (mesh.material as THREE.MeshBasicMaterial).opacity = look.opacity * (0.75 + 0.25 * Math.sin(now * 4));
      }
    }
  }

  // ---- parts ----

  private projectile(p: NonNullable<SpellEventMsg['d']['projectile']>): void {
    let v = this.projectiles.get(p.id);
    if (p.end) {
      if (v) {
        this.scene.remove(v.sprite);
        (v.sprite.material as THREE.Material).dispose();
        v.carried?.stop();
        dynamicLights.remove(v.key);
        this.projectiles.delete(p.id);
      }
      return;
    }
    if (!v) {
      const look = PROJECTILE_LOOK[p.spell];
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: look?.core ?? 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sprite.scale.setScalar(p.spell === 'fireball' ? 0.7 + 0.15 * p.level : 0.55);
      this.scene.add(sprite);
      const at = new THREE.Vector3(...p.pos);
      const carried = look?.carried ? this.host.effects()?.attach(look.carried, at, new THREE.Vector3(...p.vel).normalize(), p.level - 1) ?? null : null;
      v = { spell: p.spell, level: p.level, pos: new THREE.Vector3(), vel: new THREE.Vector3(), sprite, carried, key: `spell-proj:${p.id}` };
      this.projectiles.set(p.id, v);
    }
    v.pos.set(...p.pos);
    v.vel.set(...p.vel);
    v.sprite.position.copy(v.pos);
  }

  private burst(b: NonNullable<SpellEventMsg['d']['burst']>): void {
    const look = BURST_LOOK[b.spell];
    if (!look) return;
    const mat = new THREE.MeshBasicMaterial({ color: look.color, transparent: true, opacity: look.opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), mat);
    mesh.position.set(...b.at);
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);
    const grow = Math.max(0.05, b.seconds);
    this.timed.push({
      object: mesh,
      age: 0,
      life: grow + 0.35,
      tick: (k) => {
        const age = k * (grow + 0.35);
        mesh.scale.setScalar(Math.max(0.01, b.radius * Math.min(1, age / grow)));
        mat.opacity = look.opacity * (age <= grow ? 1 : Math.max(0, 1 - (age - grow) / 0.35));
      },
    });
    if (b.spell === 'holy_wrath') dynamicLights.flash(new THREE.Vector3(...b.at), 0xfff0c0, 2.5, b.radius, grow + 0.3);
  }

  /** A jagged bolt, re-jagged a few times over its 0.25 s. */
  private bolt(from: THREE.Vector3, to: THREE.Vector3): void {
    const group = new THREE.Group();
    const lines: THREE.Line[] = [];
    for (let k = 0; k < 3; k++) {
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 14), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: k === 0 ? 0xffffff : 0x9cc4ff, transparent: true, opacity: k === 0 ? 1 : 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      lines.push(line);
      group.add(line);
    }
    const jag = () => {
      const dir = to.clone().sub(from);
      const length = dir.length();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      for (const line of lines) {
        const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
        const n = pos.count;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const wobble = i === 0 || i === n - 1 ? 0 : (Math.random() - 0.5) * Math.min(1.2, length * 0.08);
          const p = from.clone().lerp(to, t).addScaledVector(side, wobble).addScaledVector(up, (Math.random() - 0.5) * Math.min(0.8, length * 0.05));
          pos.setXYZ(i, p.x, p.y, p.z);
        }
        pos.needsUpdate = true;
      }
    };
    jag();
    this.scene.add(group);
    let next = 0.06;
    this.timed.push({
      object: group,
      age: 0,
      life: 0.28,
      tick: (k, dt) => {
        if ((next -= dt) <= 0) {
          next = 0.06;
          jag();
        }
        for (const l of lines) (l.material as THREE.LineBasicMaterial).opacity = (1 - k) * (l === lines[0] ? 1 : 0.6);
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

  private setStatus(id: number, tag: StatusTag, on: boolean): void {
    let set = this.statusOf.get(id);
    if (!set) this.statusOf.set(id, (set = new Set()));
    if (on) set.add(tag);
    else set.delete(tag);
    if (!set.size) this.statusOf.delete(id);
    // Look: a shell round the body.
    let shells = this.shells.get(id);
    const look = STATUS_LOOK[tag];
    if (on && look && !shells?.has(tag)) {
      if (!shells) this.shells.set(id, (shells = new Map()));
      const mat = new THREE.MeshBasicMaterial({ color: look.color, transparent: true, opacity: look.opacity, depthWrite: false, blending: look.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, PLAYER_HEIGHT - 0.8, 6, 14), mat);
      mesh.position.y = PLAYER_HEIGHT / 2;
      mesh.renderOrder = 2;
      this.host.entity(id)?.object.add(mesh);
      shells.set(tag, mesh);
    } else if (!on && shells?.has(tag)) {
      this.dispose(shells.get(tag)!);
      shells.delete(tag);
      if (!shells.size) this.shells.delete(id);
    }
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

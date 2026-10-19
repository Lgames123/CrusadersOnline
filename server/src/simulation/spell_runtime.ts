import {
  DAMAGE_TYPES,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SPELLS,
  SPELL_INFO,
  SPELL_RULES,
  TICK_DT,
  TICK_RATE,
  UNHOLY_TYPES,
  dequantizeAngle,
  lineOfSight,
  rayDistance,
  type Character,
  type MovementWorld,
  type SpellEventMsg,
  type SpellId,
  type SpellLevel,
  type StatusTag,
  type Attributes,
  type DecalKind,
} from '@crusaders/shared';

/**
 * The original's spell objects, server side: what a spell does once it takes effect (each spell's
 * vtable +0x28, 0x004BAD30-0x004BC4A0), the objects it leaves in the world (projectiles,
 * explosions, ice storms, lightning, soul drinker; classes 0x0043D5E0-0x00440E70) and the timed
 * effects on characters (status objects, kinds by 0x004F326C). Decoded in
 * executable-analysis §20. WorldZone owns the characters; this module reaches them through
 * SpellHost.
 */

type V3 = { x: number; y: number; z: number };
type T3 = [number, number, number];

const FT = 0.3048;
/** Height of a character's middle above its feet (hit tests, targets). */
const BODY_MID = PLAYER_HEIGHT * 0.55;
/** A projectile meets a character within this distance of its axis. */
const PROJECTILE_RADIUS = PLAYER_RADIUS + 0.25;
const AIR = DAMAGE_TYPES.indexOf('AIR');
const FIRE = DAMAGE_TYPES.indexOf('FIRE');
const LIGHT = DAMAGE_TYPES.indexOf('LIGHT');
const DARK = DAMAGE_TYPES.indexOf('DARK');
const WATER = DAMAGE_TYPES.indexOf('WATER');

/** A character as the spells see it. */
export interface SpellTarget {
  entityId: number;
  kind: 'player' | 'mob';
  character: Character;
  /** uint16 quantized heading. */
  yaw: number;
  hp: number;
  maxHp: number;
  statuses: Map<StatusTag, ActiveStatus>;
}

/** A timed effect on a character (one per tag; a recast replaces it). */
export interface ActiveStatus {
  tag: StatusTag;
  until: number;
  level: number;
  /** Speed / rate multiplier (SPED, SLOW, FRZE 0, THAW 0). */
  rate?: number;
  /** Per damage type: outgoing (HERO) or incoming (STON, resistance potions) multipliers. */
  outgoing?: number[];
  incoming?: number[];
  /** Added to the attributes (kinds 9-12: the attribute potions). */
  attributes?: Partial<Attributes>;
}

export interface SpellHost {
  readonly mw: MovementWorld;
  tick(): number;
  random(): number;
  characters(): Iterable<SpellTarget>;
  alive(a: SpellTarget): boolean;
  /** Whether `a`'s spells harm `b`. */
  hostile(a: SpellTarget, b: SpellTarget): boolean;
  /** The creature type id (players 0x96), for holy wrath and soul drinker. */
  creatureType(a: SpellTarget): number;
  /** Its damage-taken multiplier for one type (freeze reads WATER). */
  resist(a: SpellTarget, type: number): number;
  /** A spell's damage (vector by DAMAGE_TYPES), with its knock-back along `push` (metres). */
  damage(attacker: SpellTarget, target: SpellTarget, vector: number[], push?: { x: number; z: number; d: number }): void;
  /** Soul drinker: HP drawn out (no flinch); returns what was taken. */
  drain(attacker: SpellTarget, victim: SpellTarget, amount: number): number;
  heal(a: SpellTarget, amount: number): void;
  /** Sends to every player near `at`. */
  emit(at: V3, d: SpellEventMsg['d']): void;
  /** A status began or ended on a character (its speed, the owner's stats). */
  statusChanged(a: SpellTarget): void;
  /** Spectral ally: summons one for `owner` (null when there is no room), or dismisses it. */
  summonAlly(owner: SpellTarget, level: number, at: V3, yaw: number, until: number): SpellTarget | null;
  dismissAlly(ally: SpellTarget): void;
}

interface Projectile {
  id: number;
  spell: 'fireball' | 'slow' | 'freeze';
  level: number;
  owner: SpellTarget;
  values: SpellLevel;
  pos: V3;
  vel: V3;
  life: number;
  homing: boolean;
  target: SpellTarget | null;
  /** Ticks until the next state sent (homing ones turn). */
  sendIn: number;
  /** The effect it carries when not its spell's own (creatures' fire balls: FIREBALL_PROJ_EVIL). */
  look?: string;
}

interface Burst {
  spell: SpellId;
  level: number;
  owner: SpellTarget;
  values: SpellLevel;
  at: V3;
  radius: number;
  rate: number;
  life: number;
  hit: Set<number>;
  /** A creature's holy wrath (unholy wrath): DARK, on all but the unholy. */
  unholy?: boolean;
}

/**
 * How a creature casts (0x004BD7C0): at its brain's target rather than along a camera aim, from
 * its own spell instances. Their fire balls carry FIREBALL_PROJ_EVIL (instance +0x40 = 1) and
 * sound 316 (the sound loaded with the instance at level 1); lightning strikes the target
 * itself with sound 522 (+0x3C loaded at index 2); holy wrath is unholy (+0x50 = 1).
 */
export interface CreatureCast {
  target: SpellTarget;
}

/** Creatures' fire-ball projectile effect (table 0x004E2D38, index 1). */
const CREATURE_FIREBALL_LOOK = 'FIREBALL_PROJ_EVIL';

interface Chain {
  owner: SpellTarget;
  level: number;
  values: SpellLevel;
  left: number;
  next: number;
  last: SpellTarget | null;
  hit: Set<number>;
}

interface Drain {
  id: number;
  owner: SpellTarget;
  victim: SpellTarget;
  receiver: SpellTarget;
  perSecond: number;
  left: number;
}

const tuple = (v: V3): T3 => [round(v.x), round(v.y), round(v.z)];
const round = (n: number) => Math.round(n * 1000) / 1000;
const add = (a: V3, b: V3, k = 1): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const len = (v: V3) => Math.hypot(v.x, v.y, v.z);
const norm = (v: V3): V3 => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const mid = (a: SpellTarget): V3 => ({ x: a.character.position.x, y: a.character.position.y + BODY_MID, z: a.character.position.z });
/** Distance from point p to segment a-b. */
function segmentDistance(p: V3, a: V3, b: V3): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / l2)) : 0;
  return Math.hypot(a.x + ab.x * t - p.x, a.y + ab.y * t - p.y, a.z + ab.z * t - p.z);
}
const ticks = (seconds: number) => Math.round(seconds * TICK_RATE);
/** The bolt's, the explosion's and the thaw's sounds play at a random rate (0x004BF480, 0x004BE980, 0x0047E9B0: 0.8 + 0.4 x rand). */
const randomRate = () => round(0.8 + 0.4 * Math.random());

export class SpellRuntime {
  private readonly projectiles: Projectile[] = [];
  private readonly bursts: Burst[] = [];
  private readonly storms: Burst[] = [];
  private readonly chains: Chain[] = [];
  private readonly drains: Drain[] = [];
  /** Slow time (Slow level 3): creatures hostile to `owner` run at a quarter speed until `until`. */
  private readonly timeSlows: { owner: SpellTarget; until: number }[] = [];
  /** Spectral allies by owner. */
  private readonly allies = new Map<number, { ally: SpellTarget; until: number }>();
  private nextId = 1;

  private readonly host: SpellHost;

  constructor(host: SpellHost) {
    this.host = host;
  }

  /**
   * The spell takes effect at `hand` with aim `aim` (unit): vtable +0x28 of its slot. Mana is
   * the caller's (spent before, as +0x58 does at the start of each).
   */
  release(caster: SpellTarget, spell: SpellId, level: number, values: SpellLevel, hand: V3, aim: V3, creature?: CreatureCast): void {
    const info = SPELL_INFO[spell];
    // Torch Light's LIGHT_CAST shows 6 ft above the caster's feet (0x004BADE0), the others' at the hand.
    const castAt = spell === 'torch_light' ? { x: caster.character.position.x, y: caster.character.position.y + 6 * FT, z: caster.character.position.z } : hand;
    if (info.cast && spell !== 'fireball' && spell !== 'slow' && spell !== 'holy_wrath') this.fx(castAt, [{ name: info.cast, level, at: tuple(castAt) }]);
    switch (spell) {
      case 'fireball':
        return this.fireball(caster, level, values, hand, aim, !!creature);
      case 'slow':
        return this.slow(caster, level, values, hand, aim);
      case 'freeze':
        return this.freeze(caster, level, values, hand, aim);
      case 'stoneskin':
        // STON (kind 6): incoming SLASH..WATER x value1; STO2 (kind 13): the stone look.
        this.setStatus(caster, { tag: 'STON', level, until: this.host.tick() + ticks(values.duration), incoming: DAMAGE_TYPES.map((_, t) => (t <= WATER ? values.value1 : 1)) });
        return;
      case 'lightning':
        return this.lightning(caster, level, values, hand, aim, creature?.target);
      case 'heroism': {
        const until = this.host.tick() + ticks(values.duration);
        // SPED (kind 0): speed x value2; HERO (kind 4): SLASH and BASH dealt x value1.
        if (values.value2 > 0) this.setStatus(caster, { tag: 'SPED', level, until, rate: values.value2 });
        this.setStatus(caster, { tag: 'HERO', level, until, outgoing: DAMAGE_TYPES.map((_, t) => (t <= 1 ? values.value1 : 1)) });
        return;
      }
      case 'spectral_ally':
        return this.ally(caster, level, values);
      case 'revelation':
        return this.revelation(caster, level, values);
      case 'holy_wrath':
        return this.holyWrath(caster, level, values, !!creature);
      case 'soul_drinker':
        return this.soulDrinker(caster, level, values, hand, aim);
      case 'torch_light':
        return; // the zone keeps the light (replicated in the entity flags)
    }
  }

  // ---- Fire ball (0x004BAF80, 0x004BB130; projectile 0x004BE530, explosion 0x004BE790 / 0x004BEA70) ----

  private fireball(caster: SpellTarget, level: number, values: SpellLevel, hand: V3, aim: V3, creature = false): void {
    const R = SPELL_RULES;
    const dirs: V3[] = [aim];
    if (level === 3) {
      // Three balls: the aim and the aim turned by ±0.2 of its horizontal side.
      const side = { x: aim.z * R.fireballSpread, y: 0, z: -aim.x * R.fireballSpread };
      dirs.push(norm(add(aim, side)), norm(add(aim, side, -1)));
    }
    const speed = level === 3 ? R.fireballTripleSpeed : R.fireballSpeed;
    for (const d of dirs) this.launch(caster, 'fireball', level, values, hand, d, speed, R.projectileLife, level >= 2, creature ? CREATURE_FIREBALL_LOOK : undefined);
    const sound = SPELL_INFO.fireball.sounds[creature ? 0 : level - 1]!;
    this.fx(hand, [{ name: 'FIREBALL_CAST', level, at: tuple(hand), dir: tuple(aim) }], [{ id: sound, at: tuple(hand) }]);
  }

  private launch(owner: SpellTarget, spell: Projectile['spell'], level: number, values: SpellLevel, from: V3, dir: V3, speed: number, life: number, homing: boolean, look?: string): void {
    const p: Projectile = { id: this.nextId++, spell, level, owner, values, pos: { ...from }, vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, life, homing, target: null, sendIn: 4, ...(look ? { look } : {}) };
    this.projectiles.push(p);
    this.sendProjectile(p);
  }

  private sendProjectile(p: Projectile, end = false): void {
    this.host.emit(p.pos, { projectile: { id: p.id, spell: p.spell, level: p.level, pos: tuple(p.pos), vel: tuple(p.vel), ...(p.look ? { look: p.look } : {}), ...(end ? { end } : {}) } });
  }

  /** Homing (levels 2-3, 0x004BE010 / 0x004BE220): the target nearest the flight line within 80°, turned towards at 180°/s. */
  private steer(p: Projectile): void {
    const R = SPELL_RULES;
    const v = norm(p.vel);
    if (p.target && !this.host.alive(p.target)) p.target = null;
    if (!p.target) {
      let best = Math.cos(R.homingCone);
      for (const c of this.host.characters()) {
        if (!this.host.alive(c) || !this.host.hostile(p.owner, c) || this.globed(c)) continue;
        const to = norm({ x: c.character.position.x - p.pos.x, y: c.character.position.y + BODY_MID - p.pos.y, z: c.character.position.z - p.pos.z });
        const dot = to.x * v.x + to.y * v.y + to.z * v.z;
        if (dot > best) {
          best = dot;
          p.target = c;
        }
      }
      if (!p.target) return;
    }
    const want = norm({ x: p.target.character.position.x - p.pos.x, y: p.target.character.position.y + BODY_MID - p.pos.y, z: p.target.character.position.z - p.pos.z });
    const cos = want.x * v.x + want.y * v.y + want.z * v.z;
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (angle > R.homingCone) {
      p.target = null;
      return;
    }
    const step = R.homingTurn * TICK_DT;
    const k = angle <= step ? 1 : step / angle;
    const d = norm({ x: v.x + (want.x - v.x) * k, y: v.y + (want.y - v.y) * k, z: v.z + (want.z - v.z) * k });
    const speed = len(p.vel);
    p.vel = { x: d.x * speed, y: d.y * speed, z: d.z * speed };
  }

  private stepProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (p.homing) this.steer(p);
      const travel = len(p.vel) * TICK_DT;
      const dir = norm(p.vel);
      const wall = rayDistance(this.host.mw, p.pos, dir, travel);
      const reach = wall ?? travel;
      const to = add(p.pos, dir, reach);
      // The first character the step passes through.
      let hit: SpellTarget | null = null;
      let hitAt = Infinity;
      for (const c of this.host.characters()) {
        if (c === p.owner || !this.host.alive(c) || !this.host.hostile(p.owner, c)) continue;
        const cp = c.character.position;
        const feet = { x: cp.x, y: cp.y + PROJECTILE_RADIUS, z: cp.z };
        const head = { x: cp.x, y: cp.y + PLAYER_HEIGHT - PROJECTILE_RADIUS, z: cp.z };
        // Closest approach of the step to the character's axis.
        const d = Math.min(segmentDistance(mid(c), p.pos, to), segmentDistance(feet, p.pos, to), segmentDistance(head, p.pos, to));
        if (d > PROJECTILE_RADIUS) continue;
        const along = (cp.x - p.pos.x) * dir.x + (cp.z - p.pos.z) * dir.z;
        if (along < hitAt) {
          hitAt = along;
          hit = c;
        }
      }
      p.life -= TICK_DT;
      if (hit) {
        p.pos = add(p.pos, dir, Math.max(0, Math.min(reach, hitAt)));
        this.projectiles.splice(i, 1);
        this.sendProjectile(p, true);
        this.impact(p, hit);
        continue;
      }
      p.pos = to;
      if (wall !== null) {
        this.projectiles.splice(i, 1);
        this.sendProjectile(p, true);
        this.impact(p, null);
        continue;
      }
      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        this.sendProjectile(p, true);
        // A snap freeze that found nothing ends in its burst of ice (0x004C10D0); the others just vanish.
        if (p.spell === 'freeze') this.fx(p.pos, [{ name: 'SNAPFREEZE_TARGET', level: p.level, at: tuple(p.pos) }]);
        continue;
      }
      if (p.homing && --p.sendIn <= 0) {
        p.sendIn = 4;
        this.sendProjectile(p);
      }
    }
  }

  /** A projectile meets a character (or the level, `target` null). */
  private impact(p: Projectile, target: SpellTarget | null): void {
    const at = p.pos;
    if (p.spell === 'fireball') {
      // FIREBALL_TARGET on a character, FIREBALL_EXPLODE on the level (tables 0x004E31EC / 0x004E31FC); then the explosion.
      this.fx(at, [{ name: target ? 'FIREBALL_TARGET' : 'FIREBALL_EXPLODE', level: p.level, at: tuple(at) }], [{ id: SPELL_RULES.explosionSound, at: tuple(at), rate: randomRate() }], { at: tuple(at), color: [150, 150, 50], radius: 6, seconds: 0.3 });
      // Its impact (0x004BE790) scorches the faces round the point, on a character or the level.
      this.decal('SCORCH', at);
      this.explode(p.owner, 'fireball', p.level, p.values, at);
      return;
    }
    if (p.spell === 'slow') {
      if (p.level === 1) {
        if (target) this.applySlow(target, p.level, p.values);
        else this.fx(at, [{ name: 'SLOW_FIZZLE', level: p.level, at: tuple(at) }]);
        return;
      }
      // Level 2 bursts (Slow Explosion, 0x004C16D0) wherever it lands.
      this.fx(at, [{ name: 'SLOW_EXPLODE', level: p.level, at: tuple(at) }]);
      this.explode(p.owner, 'slow', p.level, p.values, at);
      return;
    }
    // Snap freeze: the ice storm at the creature it met; on the level it fizzles.
    if (target) this.iceStorm(p.owner, p.level, p.values, mid(target));
    else {
      // 0x004C12E0: SNAPFREEZE_FIZZLE and frost on the faces it met.
      this.fx(at, [{ name: 'SNAPFREEZE_FIZZLE', level: p.level, at: tuple(at) }]);
      this.decal('FROST', at);
    }
  }

  /** The explosion object (class 1 / 6): a sphere growing 30 / 50 / 80 ft/s for 0.25 s, each character once. */
  private explode(owner: SpellTarget, spell: SpellId, level: number, values: SpellLevel, at: V3): void {
    const R = SPELL_RULES;
    const rate = R.explosionRate[level - 1] ?? R.explosionRate[0]!;
    const b: Burst = { spell, level, owner, values, at: { ...at }, radius: 0, rate, life: R.explosionLife, hit: new Set() };
    this.bursts.push(b);
    this.host.emit(at, { burst: { spell, level, at: tuple(at), radius: rate * R.explosionLife, seconds: R.explosionLife } });
  }

  private stepBursts(): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      const dt = Math.min(TICK_DT, b.life);
      b.radius += b.rate * dt;
      b.life -= TICK_DT;
      for (const c of this.host.characters()) {
        if (b.hit.has(c.entityId) || c === b.owner || !this.host.alive(c) || !this.host.hostile(b.owner, c)) continue;
        // A Force Globe keeps the explosion off (0x004BEA10); holy wrath and slow bursts still reach it.
        if (b.spell === 'fireball' && this.globed(c)) continue;
        const m = mid(c);
        const dist = Math.hypot(m.x - b.at.x, m.y - b.at.y, m.z - b.at.z);
        if (dist > b.radius + PLAYER_RADIUS) continue;
        // Holy wrath strikes only the unholy; a creature's unholy wrath everyone else (0x004C1BE0).
        if (b.spell === 'holy_wrath' && UNHOLY_TYPES.has(this.host.creatureType(c)) === !!b.unholy) continue;
        if (!lineOfSight(this.host.mw, b.at, m, 0)) continue;
        b.hit.add(c.entityId);
        this.burstHit(b, c, dist);
      }
      if (b.life <= 0) this.bursts.splice(i, 1);
    }
  }

  private burstHit(b: Burst, c: SpellTarget, dist: number): void {
    const p = c.character.position;
    const h = Math.hypot(p.x - b.at.x, p.z - b.at.z) || 1;
    const away = { x: (p.x - b.at.x) / h, z: (p.z - b.at.z) / h };
    void dist;
    if (b.spell === 'fireball') {
      // FIRE value1 (0x004BE790: the spell's +0x48), knocked back 15 (0x004BEBC0).
      const v = new Array<number>(DAMAGE_TYPES.length).fill(0);
      v[FIRE] = b.values.value1;
      this.host.damage(b.owner, c, v, { ...away, d: SPELL_RULES.explosionKnock });
    } else if (b.spell === 'slow') {
      this.applySlow(c, b.level, b.values);
    } else if (b.spell === 'holy_wrath') {
      const v = new Array<number>(DAMAGE_TYPES.length).fill(0);
      v[b.unholy ? DARK : LIGHT] = b.values.value1;
      this.fx(mid(c), [{ name: 'HOLY_WRATH_TARGET', level: b.level, at: [0, BODY_MID, 0], entity: c.entityId }]);
      this.host.damage(b.owner, c, v, { ...away, d: SPELL_RULES.holyWrathKnock });
    }
  }

  // ---- Slow (0x004BB3F0; projectile 0x004C1570, burst 0x004C1760, the effect 0x004C20F0) ----

  private slow(caster: SpellTarget, level: number, values: SpellLevel, hand: V3, aim: V3): void {
    if (level === 3) {
      // SLTI (kind 8): the world slows round the caster for value duration.
      const until = this.host.tick() + ticks(values.duration);
      this.timeSlows.push({ owner: caster, until });
      this.setStatus(caster, { tag: 'SLTI', level, until });
      this.fx(hand, [{ name: 'SLOW_CAST', level, at: tuple(hand) }]);
      return;
    }
    this.fx(hand, [{ name: 'SLOW_CAST', level, at: tuple(hand), dir: tuple(aim) }]);
    this.launch(caster, 'slow', level, values, hand, aim, SPELL_RULES.slowSpeed, SPELL_RULES.projectileLife, false);
  }

  /** SLOW (kind 1): rate x value1 for the level's duration; SLOW_TARGET on it. */
  private applySlow(target: SpellTarget, level: number, values: SpellLevel): void {
    this.fx(mid(target), [{ name: 'SLOW_TARGET', level, at: [0, 4 * FT, 0], entity: target.entityId }]);
    this.setStatus(target, { tag: 'SLOW', level, until: this.host.tick() + ticks(values.duration), rate: values.value1 });
  }

  // ---- Freeze (0x004BB5A0 -> 0x0043EEC0; snap freeze 0x004C1070, ice storm 0x004C1370, frozen 0x004C1FF0) ----

  private freeze(caster: SpellTarget, level: number, values: SpellLevel, hand: V3, aim: V3): void {
    const R = SPELL_RULES;
    const target = this.aimed(caster, hand, aim, R.freezeCone, R.freezeRange);
    if (target) {
      this.iceStorm(caster, level, values, mid(target));
      return;
    }
    this.launch(caster, 'freeze', level, values, hand, aim, R.fireballSpeed, R.freezeBoltLife, false);
  }

  private iceStorm(owner: SpellTarget, level: number, values: SpellLevel, at: V3): void {
    const R = SPELL_RULES;
    this.fx(at, [{ name: 'SNAPFREEZE_TARGET', level, at: tuple(at) }]);
    this.storms.push({ spell: 'freeze', level, owner, values, at: { ...at }, radius: R.iceStormRadius, rate: 0, life: R.iceStormLife, hit: new Set() });
  }

  private stepStorms(): void {
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const s = this.storms[i]!;
      s.life -= TICK_DT;
      for (const c of this.host.characters()) {
        if (s.hit.has(c.entityId) || c === s.owner || !this.host.alive(c) || !this.host.hostile(s.owner, c) || this.globed(c)) continue;
        const m = mid(c);
        if (Math.hypot(m.x - s.at.x, m.y - s.at.y, m.z - s.at.z) > s.radius + PLAYER_RADIUS) continue;
        s.hit.add(c.entityId);
        // Frost on the floor under each one caught (0x004C1490), immune or not.
        this.decal('FROST', c.character.position);
        // Frozen for duration x its WATER resist; immune at 0.25 or less.
        const water = this.host.resist(c, WATER);
        if (water <= R_FREEZE_IMMUNE) continue;
        this.setStatus(c, { tag: 'FRZE', level: s.level, until: this.host.tick() + ticks(s.values.duration * water), rate: 0 });
      }
      if (s.life <= 0) this.storms.splice(i, 1);
    }
  }

  // ---- Lightning (0x004BB910 / 0x004BB9F0; bolt 0x004BEE90 / 0x004BF1E0) ----

  private lightning(caster: SpellTarget, level: number, values: SpellLevel, hand: V3, aim: V3, target?: SpellTarget): void {
    const R = SPELL_RULES;
    this.fx(hand, [], [{ id: target ? R.lightningSound : SPELL_INFO.lightning.sounds[level - 1]!, at: tuple(hand) }]);
    const chain: Chain = { owner: caster, level, values, left: R.lightningStrikes[level - 1] ?? 1, next: 0, last: null, hit: new Set() };
    // A creature's bolt goes to its brain's target (0x004BD7C0: controller +0x40), wherever it is.
    if (target && this.host.alive(target) && !this.globed(target)) {
      this.strike(chain, target);
      if (chain.left > 0) this.chains.push(chain);
      return;
    }
    // The first strike: the creature nearest the aim within cos 0.8 and 64 ft (0x004BD320).
    let first: SpellTarget | null = null;
    let best = Infinity;
    for (const c of this.host.characters()) {
      if (!this.host.alive(c) || !this.host.hostile(caster, c) || this.globed(c)) continue;
      const m = mid(c);
      const to = { x: m.x - hand.x, y: m.y - hand.y, z: m.z - hand.z };
      const d = len(to);
      if (d > R.lightningRange || d >= best) continue;
      const n = norm(to);
      if (n.x * aim.x + n.y * aim.y + n.z * aim.z <= R.lightningCos) continue;
      if (!lineOfSight(this.host.mw, hand, m, 0)) continue;
      best = d;
      first = c;
    }
    if (!first) {
      // No target: the bolt strikes 50 ft ahead (or the wall in between).
      const wall = rayDistance(this.host.mw, hand, aim, R.lightningMiss);
      const to = add(hand, aim, wall ?? R.lightningMiss);
      this.fx(to, [{ name: 'LIGHTNING_TARGET', level, at: tuple(to) }], [{ id: R.lightningSound, at: tuple(to), rate: randomRate() }], { at: tuple(to), color: [180, 200, 255], radius: 8, seconds: 0.3 }, [{ from: tuple(hand), to: tuple(to) }]);
      // A bolt that meets the level burns its mark there (0x004BEE90).
      if (wall !== null) this.decal('LIGHTNING', to);
      return;
    }
    this.strike(chain, first);
    if (chain.left > 0) this.chains.push(chain);
  }

  private strike(chain: Chain, target: SpellTarget): void {
    const R = SPELL_RULES;
    chain.left--;
    chain.last = target;
    chain.hit.add(target.entityId);
    chain.next = this.host.tick() + ticks(R.lightningChainDelay);
    const from = this.hand(chain.owner);
    const to = mid(target);
    this.fx(to, [{ name: 'LIGHTNING_TARGET', level: chain.level, at: [0, BODY_MID, 0], entity: target.entityId }], [{ id: R.lightningSound, at: tuple(to), rate: randomRate() }], { at: tuple(to), color: [180, 200, 255], radius: 8, seconds: 0.3 }, [{ from: tuple(from), to: tuple(to) }]);
    // AIR value1 (the bolt's +0x24, the spell's value1 by level).
    const v = new Array<number>(DAMAGE_TYPES.length).fill(0);
    v[AIR] = chain.values.value1;
    this.host.damage(chain.owner, target, v);
  }

  private stepChains(): void {
    const R = SPELL_RULES;
    for (let i = this.chains.length - 1; i >= 0; i--) {
      const c = this.chains[i]!;
      if (this.host.tick() < c.next) continue;
      if (c.left <= 0 || !c.last || !this.host.alive(c.owner)) {
        this.chains.splice(i, 1);
        continue;
      }
      // The next creature within 64 ft of the last one struck (0x004BD470), not struck yet.
      const from = mid(c.last);
      let next: SpellTarget | null = null;
      let best = R.lightningRange;
      for (const t of this.host.characters()) {
        if (c.hit.has(t.entityId) || !this.host.alive(t) || !this.host.hostile(c.owner, t) || this.globed(t)) continue;
        const d = len({ x: mid(t).x - from.x, y: mid(t).y - from.y, z: mid(t).z - from.z });
        if (d < best && lineOfSight(this.host.mw, from, mid(t), 0)) {
          best = d;
          next = t;
        }
      }
      if (!next) {
        this.chains.splice(i, 1);
        continue;
      }
      this.strike(c, next);
    }
  }

  // ---- Spectral ally (0x004BBF10 / 0x004BC080, the creature 0x00440230) ----

  private ally(caster: SpellTarget, level: number, values: SpellLevel): void {
    const R = SPELL_RULES;
    const old = this.allies.get(caster.entityId);
    if (old) this.dismiss(caster.entityId);
    const p = caster.character.position;
    const yaw = dequantizeAngle(caster.yaw);
    const f = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
    const from = { x: p.x, y: p.y + 3 * FT, z: p.z };
    const clear = rayDistance(this.host.mw, from, f, R.allyAhead);
    if (clear !== null && clear < R.allyClear) return;
    const at = add(from, f, clear !== null ? clear - PLAYER_RADIUS : R.allyAhead);
    const until = this.host.tick() + ticks(values.duration);
    const ally = this.host.summonAlly(caster, level, { x: at.x, y: p.y, z: at.z }, caster.yaw, until);
    if (!ally) return;
    this.allies.set(caster.entityId, { ally, until });
    this.fx(at, [{ name: 'ALLY_APPEAR', level, at: tuple({ x: at.x, y: p.y, z: at.z }) }]);
  }

  private dismiss(owner: number): void {
    const a = this.allies.get(owner);
    if (!a) return;
    this.allies.delete(owner);
    const p = a.ally.character.position;
    this.fx(p, [{ name: 'ALLY_APPEAR', level: 1, at: [p.x, p.y + 3 * FT, p.z] }]);
    this.host.dismissAlly(a.ally);
  }

  /** The caster left or died: its ally goes with it (the original's ends with its owner's level). */
  dropOwner(owner: SpellTarget): void {
    this.dismiss(owner.entityId);
    for (let i = this.drains.length - 1; i >= 0; i--) if (this.drains[i]!.owner === owner) this.stopDrain(i);
    for (let i = this.chains.length - 1; i >= 0; i--) if (this.chains[i]!.owner === owner) this.chains.splice(i, 1);
    for (let i = this.timeSlows.length - 1; i >= 0; i--) if (this.timeSlows[i]!.owner === owner) this.timeSlows.splice(i, 1);
  }

  /** A character is gone (despawned): nothing refers to it any more. */
  forget(c: SpellTarget): void {
    for (const p of this.projectiles) if (p.target === c) p.target = null;
    for (let i = this.drains.length - 1; i >= 0; i--) if (this.drains[i]!.victim === c || this.drains[i]!.receiver === c) this.stopDrain(i);
    for (const ch of this.chains) if (ch.last === c) ch.last = null;
    for (const [owner, a] of this.allies) if (a.ally === c) this.allies.delete(owner);
  }

  // ---- Revelation (0x004BC1F0 -> 0x00440D70) ----

  private revelation(caster: SpellTarget, level: number, values: SpellLevel): void {
    // A pulse to value2 ft (50) over 0.1 s that shows the hidden (class 0xCB objects, ALLY_APPEAR level 3 on each); its ring stands at the caster's feet.
    const at = caster.character.position;
    this.host.emit(at, { burst: { spell: 'revelation', level, at: tuple(at), radius: values.value2 * FT, seconds: SPELL_RULES.revelationLife } });
  }

  // ---- Holy wrath (0x004BC2F0 -> 0x0043FD30; hits 0x004C1BE0) ----

  private holyWrath(caster: SpellTarget, level: number, values: SpellLevel, unholy = false): void {
    const R = SPELL_RULES;
    const p = caster.character.position;
    const at = { x: p.x, y: p.y + BODY_MID, z: p.z };
    // The cast effect by the instance's +0x50 (table 0x004E2D4C): HOLY_WRATH_CAST or UNHOLY_WRATH_CAST (one variant).
    this.fx(at, [{ name: unholy ? 'UNHOLY_WRATH_CAST' : 'HOLY_WRATH_CAST', level: unholy ? 1 : level, at: tuple(p) }]);
    const radius = values.value2 * FT;
    this.bursts.push({ spell: 'holy_wrath', level, owner: caster, values, at, radius: 0, rate: radius / R.holyWrathLife, life: R.holyWrathLife, hit: new Set(), ...(unholy ? { unholy } : {}) });
    // The ring (ring.mdl) stands at the caster's feet (0x0043FD30 places the object at the caster).
    this.host.emit(at, { burst: { spell: 'holy_wrath', level, at: tuple(p), radius, seconds: R.holyWrathLife, ...(unholy ? { dark: true } : {}) } });
  }

  // ---- Soul drinker (0x004BC4A0 -> 0x0043F950; 0x004C17D0 / 0x004C18B0 / 0x004C19B0) ----

  private soulDrinker(caster: SpellTarget, level: number, values: SpellLevel, hand: V3, aim: V3): void {
    const R = SPELL_RULES;
    const target = this.aimed(caster, hand, aim, R.soulCone, R.soulRange);
    // A Force Globe turns it away (0x004C17D0).
    if (!target || this.globed(target)) return;
    // Against the unholy the flow turns: they drink the caster (SOULDRINKER_*_UNDEAD).
    const unholy = UNHOLY_TYPES.has(this.host.creatureType(target));
    const victim = unholy ? caster : target;
    const receiver = unholy ? target : caster;
    this.fx(mid(target), [
      { name: unholy ? 'SOULDRINKER_TARGET_UNDEAD' : 'SOULDRINKER_TARGET_LIVING', level, at: [0, BODY_MID, 0], entity: target.entityId },
      { name: unholy ? 'SOULDRINKER_CASTER_UNDEAD' : 'SOULDRINKER_CASTER_LIVING', level, at: [0, BODY_MID, 0], entity: caster.entityId },
    ]);
    const d: Drain = { id: this.nextId++, owner: caster, victim, receiver, perSecond: values.value1 / R.soulDrainTime, left: R.soulDrainTime };
    this.drains.push(d);
    this.host.emit(mid(caster), { drain: { id: d.id, from: victim.entityId, to: receiver.entityId, seconds: R.soulDrainTime, level } });
  }

  private stepDrains(): void {
    for (let i = this.drains.length - 1; i >= 0; i--) {
      const d = this.drains[i]!;
      if (!this.host.alive(d.victim) || !this.host.alive(d.receiver) || this.globed(d.victim === d.owner ? d.receiver : d.victim)) {
        this.stopDrain(i);
        continue;
      }
      const taken = this.host.drain(d.owner === d.victim ? d.receiver : d.owner, d.victim, d.perSecond * TICK_DT);
      if (taken > 0) this.host.heal(d.receiver, taken);
      d.left -= TICK_DT;
      if (d.left <= 0 || !this.host.alive(d.victim)) this.stopDrain(i);
    }
  }

  private stopDrain(i: number): void {
    const d = this.drains[i]!;
    this.drains.splice(i, 1);
    this.host.emit(mid(d.owner), { drain: { id: d.id, from: d.victim.entityId, to: d.receiver.entityId, seconds: 0, level: 1 } });
  }

  // ---- Statuses ----

  /**
   * Behind a Force Globe (GLOB, stats +0x1F4 bit 8): explosions, fire balls, the lightning chain,
   * the ice storm and soul drinker pass it by (0x004BEA10, 0x004BEE90, 0x004BF380, 0x004C1370,
   * 0x004C17D0).
   */
  globed(c: SpellTarget): boolean {
    return c.statuses.has('GLOB');
  }

  /** Starts (or replaces) a timed effect on a character. */
  setStatus(c: SpellTarget, s: ActiveStatus): void {
    c.statuses.set(s.tag, s);
    this.host.statusChanged(c);
    const p = mid(c);
    this.host.emit(p, { status: [{ target: c.entityId, tag: s.tag, on: true, seconds: Math.max(0, (s.until - this.host.tick()) / TICK_RATE), level: s.level }] });
  }

  private endStatus(c: SpellTarget, tag: StatusTag): void {
    if (!c.statuses.delete(tag)) return;
    this.host.statusChanged(c);
    this.host.emit(mid(c), { status: [{ target: c.entityId, tag, on: false }] });
    if (tag === 'FRZE' && this.host.alive(c)) {
      // The thaw (0x0047E9B0): SNAPFREEZE_THAW, the glass sound, ice shards and a 0.8 s stun.
      const p = c.character.position;
      this.fx(p, [{ name: 'SNAPFREEZE_THAW', level: 1, at: [p.x, p.y + 3 * FT, p.z] }], [{ id: SPELL_RULES.thawSound, at: [p.x, p.y, p.z], rate: randomRate() }]);
      this.setStatus(c, { tag: 'THAW', level: 1, until: this.host.tick() + ticks(SPELL_RULES.thawStun), rate: 0 });
    }
  }

  /** All of a character's effects end (death, leaving). */
  clearStatuses(c: SpellTarget): void {
    if (!c.statuses.size) return;
    const tags = [...c.statuses.keys()];
    c.statuses.clear();
    this.host.statusChanged(c);
    this.host.emit(mid(c), { status: tags.map((tag) => ({ target: c.entityId, tag, on: false })) });
  }

  /** The rate a character acts at: slows, freezes, slow time and haste (kinds 0, 1, 2, 8). */
  rate(c: SpellTarget): number {
    let r = 1;
    for (const s of c.statuses.values()) if (s.rate !== undefined) r *= s.rate;
    if (c.kind === 'mob') for (const t of this.timeSlows) if (this.host.hostile(t.owner, c)) r *= SPELL_RULES.slowTimeRate;
    return r;
  }

  /** Damage dealt x per type (HERO). */
  outgoing(c: SpellTarget, vector: number[]): number[] {
    const h = c.statuses.get('HERO');
    return h?.outgoing ? vector.map((v, t) => v * (h.outgoing![t] ?? 1)) : vector;
  }

  /** Damage taken x per type: every kind 6 status (STON, resistance potions) multiplies the resist (+0x17C). */
  incoming(c: SpellTarget, vector: number[]): number[] {
    let out = vector;
    for (const s of c.statuses.values()) if (s.incoming) out = out.map((v, t) => v * (s.incoming![t] ?? 1));
    return out;
  }

  /** The +0x17C multiplier of one damage type (the resist getter 0x0044CB60 includes it: freeze reads it). */
  incomingMultiplier(c: SpellTarget, type: number): number {
    let m = 1;
    for (const s of c.statuses.values()) if (s.incoming) m *= s.incoming[type] ?? 1;
    return m;
  }

  /** The attribute bonus of a character's statuses (kinds 9-12, +0xD4..+0xE0). */
  attributeBonus(c: SpellTarget): Partial<Attributes> {
    const out: Partial<Attributes> = {};
    for (const s of c.statuses.values()) {
      if (!s.attributes) continue;
      for (const [k, v] of Object.entries(s.attributes) as [keyof Attributes, number][]) out[k] = (out[k] ?? 0) + v;
    }
    return out;
  }

  /** One tick of every spell object and effect. */
  step(): void {
    const now = this.host.tick();
    this.stepProjectiles();
    this.stepBursts();
    this.stepStorms();
    this.stepChains();
    this.stepDrains();
    for (let i = this.timeSlows.length - 1; i >= 0; i--) if (now >= this.timeSlows[i]!.until) this.timeSlows.splice(i, 1);
    for (const [owner, a] of this.allies) if (now >= a.until || !this.host.alive(a.ally)) this.dismiss(owner);
    for (const c of this.host.characters()) {
      if (!c.statuses.size) continue;
      for (const s of [...c.statuses.values()]) if (now >= s.until) this.endStatus(c, s.tag);
    }
  }

  // ---- helpers ----

  /** The caster's hand: the original casts from the hand node (+0xC8 0x14); here 4.3 ft up, a little ahead. */
  hand(c: SpellTarget): V3 {
    const p = c.character.position;
    const yaw = dequantizeAngle(c.yaw);
    return { x: p.x - Math.sin(yaw) * 0.45, y: p.y + 4.3 * FT, z: p.z - Math.cos(yaw) * 0.45 };
  }

  /** The hostile creature nearest the aim within a cone and range, in sight (0x00439A60). */
  private aimed(caster: SpellTarget, from: V3, aim: V3, cone: number, range: number): SpellTarget | null {
    let best: SpellTarget | null = null;
    let bestDot = Math.cos(cone);
    for (const c of this.host.characters()) {
      if (!this.host.alive(c) || !this.host.hostile(caster, c)) continue;
      const m = mid(c);
      const to = { x: m.x - from.x, y: m.y - from.y, z: m.z - from.z };
      const d = len(to);
      if (d > range) continue;
      const n = norm(to);
      // Aim from the camera: the horizontal angle counts, pitch is forgiven (the target's height).
      const h = Math.hypot(n.x, n.z) || 1;
      const ah = Math.hypot(aim.x, aim.z) || 1;
      const dot = (n.x * aim.x + n.z * aim.z) / (h * ah);
      if (dot <= bestDot || !lineOfSight(this.host.mw, from, m, 0)) continue;
      bestDot = dot;
      best = c;
    }
    return best;
  }

  private fx(at: V3, fx: NonNullable<SpellEventMsg['d']['fx']>, sounds?: NonNullable<SpellEventMsg['d']['sounds']>, light?: SpellEventMsg['d']['light'], bolts?: SpellEventMsg['d']['bolts']): void {
    this.host.emit(at, { ...(fx.length ? { fx } : {}), ...(sounds?.length ? { sounds } : {}), ...(light ? { light } : {}), ...(bolts?.length ? { bolts } : {}) });
  }

  private decal(kind: DecalKind, at: V3): void {
    this.host.emit(at, { decals: [{ kind, at: tuple(at) }] });
  }
}

const R_FREEZE_IMMUNE = SPELL_RULES.freezeImmuneResist;

/** Spell index (SPELLS order) of an id: the ANIM.SPELL_CAST offset. */
export const spellIndex = (s: SpellId): number => SPELLS.indexOf(s);

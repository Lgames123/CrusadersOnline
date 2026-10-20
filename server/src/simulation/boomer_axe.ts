import { DAMAGE_TYPES, PLAYER_HEIGHT, PLAYER_RADIUS, TICK_DT, dequantizeAngle, rayDistance, type MovementWorld, type SpellEventMsg } from '@crusaders/shared';
import { BODY_MID, type SpellTarget } from './spell_runtime.ts';

/**
 * The Boomer Axe's magic axe, server side (executable-analysis §23.1). Its `Use BOOMER`
 * (0x00401000) runs on each landed blow and throws the weapon itself (0x0043EAE0): the item leaves
 * the wielder's hand for a pooled type-3 object ("Axe", factory 0x0043E850, behaviour 0x004C0420,
 * vtable 0x4E3468 over the arrow's 0x4E3400) launched from the hand node at 60 ft/s along the
 * wielder's facing (the player: the camera's). It flies out for 1000 ms or until it meets something,
 * then curves back along a natural cubic spline to the wielder's hand, where it is caught and
 * wielded again.
 */

type V3 = { x: number; y: number; z: number };
type T3 = [number, number, number];

const FT = 0.3048;
const SLASH = DAMAGE_TYPES.indexOf('SLASH');
const AIR = DAMAGE_TYPES.indexOf('AIR');

export const BOOMER_RULES = {
  /** Pooled objects of type 3 (counts 0x4E2344): no throw when all eight fly. */
  pool: 8,
  /** Launch speed (0x4DFB74). */
  speed: 60 * FT,
  /** Out time before it turns back (+0x48 = 1000.0, less the frame's milliseconds: 0x004C07A3). */
  outSeconds: 1,
  /** Its damage vector (+8, 0x004C0420): SLASH 5 and AIR 5, taken through the victim's resists (stats +0x48). */
  damage: { [SLASH]: 5, [AIR]: 5 } as Record<number, number>,
  /** Its physics radius (+0x48 of the 0x4E00D0 component = 1.5). */
  radius: 1.5 * FT,
  /** The victim's push along the axe's flight (0x004C02C0: physics +0x60, magnitude 3.0). */
  knock: 3 * FT,
  /** Return pace: t (0 -> 3 over the four keys) advances by 80 / distance per second (0x004DE66C). */
  returnPace: 80 * FT,
  /** Caught at t >= 3 - 0.05 x pace (0x004E34D8); the wielder's catch flag at 3 - 0.15 x pace (0x004E34E0). */
  catchAt: 0.05,
  catchFlagAt: 0.15,
  /** Keys 1 and 2: 0.25 / 0.5 of the way home, pushed sideways by rand x 0.3 x the horizontal span, alternate sides. */
  keyStep: 0.25,
  wobble: 0.3,
  /** Key 3, the hand, in the wielder's frame (ft): empty hand (3, 6, 0), else (0, 5, 0) (0x004C07F5). */
  hand: { side: 3 * FT, up: 6 * FT },
  /** Sounds: the spin loop (0x14E, 0x004C0670), a character hit 306 + round(rand), the level 328 or 206. */
  loopSound: 334,
  hitSound: 306,
  wallSounds: [328, 206] as readonly number[],
  /** Ticks between the states sent on the curve home. */
  sendEvery: 4,
} as const;

/** A natural cubic spline through (ts[i], ys[i]) (0x004C2BF0): per segment a + b x + c x² + d x³ (0x004C28F0). */
export function naturalSpline(ts: readonly number[], ys: readonly number[]): (t: number) => number {
  const n = ts.length - 1;
  const h = ts.slice(0, n).map((t, i) => ts[i + 1]! - t);
  const alpha = new Array<number>(n + 1).fill(0);
  for (let i = 1; i < n; i++) alpha[i] = (3 / h[i]!) * (ys[i + 1]! - ys[i]!) - (3 / h[i - 1]!) * (ys[i]! - ys[i - 1]!);
  const l = new Array<number>(n + 1).fill(1);
  const mu = new Array<number>(n + 1).fill(0);
  const z = new Array<number>(n + 1).fill(0);
  for (let i = 1; i < n; i++) {
    l[i] = 2 * (ts[i + 1]! - ts[i - 1]!) - h[i - 1]! * mu[i - 1]!;
    mu[i] = h[i]! / l[i]!;
    z[i] = (alpha[i]! - h[i - 1]! * z[i - 1]!) / l[i]!;
  }
  const c = new Array<number>(n + 1).fill(0);
  const b = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);
  for (let j = n - 1; j >= 0; j--) {
    c[j] = z[j]! - mu[j]! * c[j + 1]!;
    b[j] = (ys[j + 1]! - ys[j]!) / h[j]! - (h[j]! * (c[j + 1]! + 2 * c[j]!)) / 3;
    d[j] = (c[j + 1]! - c[j]!) / (3 * h[j]!);
  }
  return (t) => {
    // Clamped to the keys' range, as 0x004C28F0.
    const x = Math.max(ts[0]!, Math.min(ts[n]!, t));
    let i = 0;
    while (i < n - 1 && x > ts[i + 1]!) i++;
    const u = x - ts[i]!;
    return ys[i]! + b[i]! * u + c[i]! * u * u + d[i]! * u * u * u;
  };
}

/** What the axes may do to the zone's characters. */
export interface BoomerHost {
  readonly mw: MovementWorld;
  random(): number;
  characters(): Iterable<SpellTarget>;
  alive(a: SpellTarget): boolean;
  /** Still in the zone (a wielder who left takes his axe with him: it vanishes). */
  present(a: SpellTarget): boolean;
  hostile(a: SpellTarget, b: SpellTarget): boolean;
  /** A raised shield facing `from` whose use mask has MELEE (the "Axe" object is no bolt or explosion: 0x00401F20). */
  shieldStops(a: SpellTarget, from: V3): boolean;
  damage(attacker: SpellTarget, target: SpellTarget, vector: number[], push?: { x: number; z: number; d: number }): void;
  emit(at: V3, d: SpellEventMsg['d']): void;
  /** The axe is back in its wielder's hand (0x0046B000). */
  caught(owner: SpellTarget): void;
  /** It is about to be caught: the wielder plays the catch (controller flag 0x200000). */
  catching?(owner: SpellTarget): void;
}

interface Axe {
  id: number;
  owner: SpellTarget;
  pos: V3;
  vel: V3;
  /** Out: seconds left; back: null. */
  out: number | null;
  /** Back: spline parameter (0..3), pace (per second), keys 0-2 (key 3 is the hand, moved every tick). */
  t: number;
  pace: number;
  keys: V3[];
  /** Characters met (each once a throw: turned back at one, it would meet it again at once). */
  hit: Set<number>;
  /**
   * Characters it was launched inside of (the blow's own victim, a step in front): a swept body
   * meets what it moves into, not what it starts in, so these are passed until it is clear of them.
   */
  inside: Set<SpellTarget>;
  sendIn: number;
  /** The wielder's catch flag was raised (once, at t >= 3 - 0.15 x pace). */
  catching?: boolean;
}

const tuple = (v: V3): T3 => [round(v.x), round(v.y), round(v.z)];
const round = (n: number) => Math.round(n * 1000) / 1000;
const len = (v: V3) => Math.hypot(v.x, v.y, v.z);
const norm = (v: V3): V3 => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
function segmentDistance(p: V3, a: V3, b: V3): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / l2)) : 0;
  return Math.hypot(a.x + ab.x * t - p.x, a.y + ab.y * t - p.y, a.z + ab.z * t - p.z);
}

export class BoomerAxes {
  private readonly axes: Axe[] = [];
  private nextId = 1;
  private readonly host: BoomerHost;

  constructor(host: BoomerHost) {
    this.host = host;
  }

  /** Whether `a`'s axe is in flight (its hand is empty). */
  flying(a: SpellTarget): boolean {
    return this.axes.some((x) => x.owner === a);
  }

  get count(): number {
    return this.axes.length;
  }

  /**
   * 0x0043EAE0: takes a free pooled axe (none: nothing happens, the weapon stays in the hand),
   * sends it from `hand` along `dir` (unit). Returns whether it was thrown.
   */
  throw(owner: SpellTarget, hand: V3, dir: V3): boolean {
    if (this.axes.length >= BOOMER_RULES.pool || this.flying(owner)) return false;
    const s = BOOMER_RULES.speed;
    const axe: Axe = { id: this.nextId++, owner, pos: { ...hand }, vel: { x: dir.x * s, y: dir.y * s, z: dir.z * s }, out: BOOMER_RULES.outSeconds, t: 0, pace: 0, keys: [], hit: new Set(), inside: new Set(), sendIn: BOOMER_RULES.sendEvery };
    for (const c of this.host.characters()) if (c !== owner && this.touches(c, axe.pos)) axe.inside.add(c);
    this.axes.push(axe);
    this.send(axe);
    return true;
  }

  /** The wielder is gone (left the zone): its axe goes with it. */
  dropOwner(owner: SpellTarget): void {
    for (let i = this.axes.length - 1; i >= 0; i--) {
      if (this.axes[i]!.owner !== owner) continue;
      this.send(this.axes[i]!, true);
      this.axes.splice(i, 1);
    }
  }

  step(): void {
    for (let i = this.axes.length - 1; i >= 0; i--) {
      const axe = this.axes[i]!;
      if (!this.host.present(axe.owner)) {
        this.send(axe, true);
        this.axes.splice(i, 1);
        continue;
      }
      if (axe.out !== null) this.stepOut(axe);
      else if (this.stepBack(axe)) {
        this.axes.splice(i, 1);
        this.send(axe, true);
        this.host.caught(axe.owner);
      }
    }
  }

  /** Out (0x004C06B0 with +0x3C clear): straight on until something stops it or its time runs out. */
  private stepOut(axe: Axe): void {
    for (const c of axe.inside) if (!this.touches(c, axe.pos)) axe.inside.delete(c);
    const travel = len(axe.vel) * TICK_DT;
    const dir = norm(axe.vel);
    const wall = rayDistance(this.host.mw, axe.pos, dir, travel);
    const reach = wall ?? travel;
    const to = { x: axe.pos.x + dir.x * reach, y: axe.pos.y + dir.y * reach, z: axe.pos.z + dir.z * reach };
    const met = this.firstMet(axe, axe.pos, to);
    if (met) {
      axe.pos = met.at;
      this.hitCharacter(axe, met.c);
      this.turnBack(axe);
      return;
    }
    axe.pos = to;
    if (wall !== null) {
      this.hitWall(axe);
      this.turnBack(axe);
      return;
    }
    axe.out! -= TICK_DT;
    if (axe.out! <= 0) this.turnBack(axe);
  }

  /** Back (+0x3C set): along the spline to the hand; true once caught. */
  private stepBack(axe: Axe): boolean {
    const R = BOOMER_RULES;
    const hand = this.handPoint(axe.owner);
    const ts = [0, 1, 2, 3];
    const sx = naturalSpline(ts, [...axe.keys.map((k) => k.x), hand.x]);
    const sy = naturalSpline(ts, [...axe.keys.map((k) => k.y), hand.y]);
    const sz = naturalSpline(ts, [...axe.keys.map((k) => k.z), hand.z]);
    axe.t += TICK_DT * axe.pace;
    if (axe.t >= 3 - R.catchAt * axe.pace) return true;
    // 0x004C06B0: crossing 3 - 0.15 x pace with the hand empty (it always is while the axe flies
    // here) raises the wielder's controller flag 0x200000: the THROW_ITEM group's clip, the catch.
    if (!axe.catching && axe.t >= 3 - R.catchFlagAt * axe.pace) {
      axe.catching = true;
      this.host.catching?.(axe.owner);
      this.host.emit(axe.pos, { axe: { id: axe.id, owner: axe.owner.entityId, pos: tuple(axe.pos), vel: tuple(axe.vel), catching: true } });
    }
    const to = { x: sx(axe.t), y: sy(axe.t), z: sz(axe.t) };
    // Velocity = (spline point - position) / frame: the physics carries it there (walls do not
    // turn it again: only a hit on the way out starts the return).
    const met = this.firstMet(axe, axe.pos, to);
    if (met) this.hitCharacter(axe, met.c);
    axe.vel = { x: (to.x - axe.pos.x) / TICK_DT, y: (to.y - axe.pos.y) / TICK_DT, z: (to.z - axe.pos.z) / TICK_DT };
    axe.pos = to;
    if (--axe.sendIn <= 0) {
      axe.sendIn = R.sendEvery;
      this.send(axe);
    }
    return false;
  }

  /**
   * 0x004C0CC0: the curve home from where it is. Key 0 at t 0 = here; keys 1, 2 at t 1, 2 =
   * 0.25 / 0.5 of the way to the wielder, pushed across the horizontal line by rand x 0.3 (a
   * random side for the first, the other side for the second); key 3 at t 3 = the hand. Pace
   * 80 / distance (ft) per second.
   */
  private turnBack(axe: Axe): void {
    const R = BOOMER_RULES;
    const w = axe.owner.character.position;
    const d = { x: w.x - axe.pos.x, y: w.y - axe.pos.y, z: w.z - axe.pos.z };
    const dist = Math.max(len(d), 1e-3);
    axe.pace = R.returnPace / dist;
    axe.out = null;
    axe.t = 0;
    let side = Math.round(this.host.random()) * 2 - 1;
    axe.keys = [{ ...axe.pos }];
    for (let i = 1; i <= 2; i++) {
      const f = i * R.keyStep;
      const q = this.host.random() * side * R.wobble;
      axe.keys.push({ x: axe.pos.x + d.x * f + q * d.z, y: axe.pos.y + d.y * f, z: axe.pos.z + d.z * f - q * d.x });
      side = -side;
    }
    axe.vel = { x: 0, y: 0, z: 0 };
    axe.sendIn = 1;
  }

  /** Key 3: the empty right hand, 3 ft to the wielder's side and 6 ft up (its frame, 0x004C07F5). */
  private handPoint(owner: SpellTarget): V3 {
    const p = owner.character.position;
    const yaw = dequantizeAngle(owner.yaw);
    // Forward (-sin, -cos); right = (-f.z, f.x).
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    return { x: p.x + rx * BOOMER_RULES.hand.side, y: p.y + BOOMER_RULES.hand.up, z: p.z + rz * BOOMER_RULES.hand.side };
  }

  /** The first character (not the wielder, not met yet, one the wielder may harm) the step from a to b passes within reach of. */
  private firstMet(axe: Axe, a: V3, b: V3): { c: SpellTarget; at: V3 } | null {
    const reach = PLAYER_RADIUS + BOOMER_RULES.radius;
    const dir = norm({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    let best: { c: SpellTarget; at: V3 } | null = null;
    let bestAlong = Infinity;
    for (const c of this.host.characters()) {
      if (c === axe.owner || axe.hit.has(c.entityId) || axe.inside.has(c) || !this.host.alive(c) || !this.host.hostile(axe.owner, c)) continue;
      const cp = c.character.position;
      const feet = { x: cp.x, y: cp.y + reach, z: cp.z };
      const head = { x: cp.x, y: cp.y + PLAYER_HEIGHT - reach, z: cp.z };
      const m = { x: cp.x, y: cp.y + BODY_MID, z: cp.z };
      const d = Math.min(segmentDistance(m, a, b), segmentDistance(feet, a, b), segmentDistance(head, a, b));
      if (d > reach) continue;
      const along = Math.max(0, (cp.x - a.x) * dir.x + (cp.y + BODY_MID - a.y) * dir.y + (cp.z - a.z) * dir.z);
      if (along < bestAlong) {
        bestAlong = along;
        const l = Math.min(along, len({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }));
        best = { c, at: { x: a.x + dir.x * l, y: a.y + dir.y * l, z: a.z + dir.z * l } };
      }
    }
    return best;
  }

  /** Whether the axe at `p` overlaps a character's body (axis from the feet to the head). */
  private touches(c: SpellTarget, p: V3): boolean {
    const cp = c.character.position;
    const y = Math.max(cp.y, Math.min(cp.y + PLAYER_HEIGHT, p.y));
    return Math.hypot(p.x - cp.x, p.y - y, p.z - cp.z) <= PLAYER_RADIUS + BOOMER_RULES.radius;
  }

  /**
   * 0x004C0A50: a raised shield taking MELEE stops it (sparks, effect 1, at the contact);
   * otherwise SLASH 5 + AIR 5, sound 306 + round(rand) at the victim, a push of 3 along the
   * flight and its impact (0x004C02C0).
   */
  private hitCharacter(axe: Axe, c: SpellTarget): void {
    axe.hit.add(c.entityId);
    const at = tuple(axe.pos);
    if (this.host.shieldStops(c, axe.pos)) {
      this.host.emit(axe.pos, { fx: [{ name: 'SWORD_METAL', level: 1, at }] });
      return;
    }
    const v = new Array<number>(DAMAGE_TYPES.length).fill(0);
    for (const [t, n] of Object.entries(BOOMER_RULES.damage)) v[Number(t)] = n;
    const cp = c.character.position;
    this.host.emit(cp, { sounds: [{ id: BOOMER_RULES.hitSound + Math.round(this.host.random()), at: tuple(cp) }] });
    const h = Math.hypot(axe.vel.x, axe.vel.z);
    this.host.damage(axe.owner, c, v, h > 1e-6 ? { x: axe.vel.x / h, z: axe.vel.z / h, d: BOOMER_RULES.knock } : undefined);
  }

  /** 0x004C0BD0: sparks (effect 1), a scorch on the faces round it and sound 328 or 206 (round(rand) != 0). */
  private hitWall(axe: Axe): void {
    const at = tuple(axe.pos);
    const sound = BOOMER_RULES.wallSounds[Math.round(this.host.random()) ? 1 : 0]!;
    this.host.emit(axe.pos, { fx: [{ name: 'SWORD_METAL', level: 1, at }], sounds: [{ id: sound, at }], decals: [{ kind: 'SCORCH', at }] });
  }

  private send(axe: Axe, end = false): void {
    this.host.emit(axe.pos, { axe: { id: axe.id, owner: axe.owner.entityId, pos: tuple(axe.pos), vel: tuple(axe.vel), ...(end ? { end } : {}) } });
  }
}

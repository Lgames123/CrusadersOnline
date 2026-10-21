import { PLAYER_HEIGHT, PLAYER_RADIUS, TICK_DT, rayDistance, type MovementWorld, type SpellEventMsg } from '@crusaders/shared';
import { BODY_MID, type SpellTarget } from './spell_runtime.ts';

/**
 * Arrows from a weapon whose use is SHOOT (the Dasher Hand Bow). The original's SHOOT
 * (0x004010C0 → 0x00440790) launches a pooled type-0xB object (class 11, ctor 0x004BFE50, vtable
 * 0x4E3400 — the Boomer Axe's base) only with an Arrow in the bag, and nobody ever carries one,
 * so the original never shoots. Here every shot flies (no ammunition): see the context note.
 *
 * Decoded: its hit on a character (0x004C0010) asks the victim's shield first; unblocked it
 * pushes the victim along the flight (0x004C02C0, the Boomer's 3 ft), plays sound 306 + rand
 * and deals its damage; blocked, it only shows the block's sparks. Not decoded: the launch
 * speed (the stack vector in 0x00440790) — 100 ft/s here, straight, 1.5 s at most.
 */

type V3 = { x: number; y: number; z: number };
type T3 = [number, number, number];

const FT = 0.3048;

export const ARROW_RULES = {
  /** Flight speed (not decoded). */
  speed: 100 * FT,
  /** Seconds before it drops out of the world unseen. */
  life: 1.5,
  /** How close to a body's axis it hits. */
  radius: PLAYER_RADIUS + 0.12,
  /** The victim's push along the flight (0x004C02C0, magnitude 3.0, as the Boomer's). */
  knock: 3 * FT,
  /** On a character (0x004C0010: 0x132 + rand), on the level (the Boomer's wall sounds). */
  hitSound: 306,
  wallSound: 328,
  /** Shooting range of creatures holding a bow (not original: they never shoot there). */
  mobRange: 22,
  /** Seconds between a creature's shots. */
  mobCooldown: 2.4,
} as const;

export interface ArrowHost {
  readonly mw: MovementWorld;
  random(): number;
  characters(): Iterable<SpellTarget>;
  alive(a: SpellTarget): boolean;
  hostile(a: SpellTarget, b: SpellTarget): boolean;
  /** A raised shield facing `from` that takes projectiles (mask PROJECTILE). */
  shieldStops(a: SpellTarget, from: V3): boolean;
  /** The shooter's blow lands on `target` (its damage roll), pushed along `push`. */
  hit(shooter: SpellTarget, target: SpellTarget, push: { x: number; z: number; d: number }): void;
  /** A shield stopped it (the block's sparks and sound). */
  blocked(shooter: SpellTarget, target: SpellTarget, at: V3): void;
  emit(at: V3, d: SpellEventMsg['d']): void;
}

interface Arrow {
  id: number;
  owner: SpellTarget;
  pos: V3;
  vel: V3;
  life: number;
}

const tuple = (v: V3): T3 => [round(v.x), round(v.y), round(v.z)];
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Distance from point p to segment a-b. */
function segmentDistance(p: V3, a: V3, b: V3): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / l2)) : 0;
  return Math.hypot(a.x + ab.x * t - p.x, a.y + ab.y * t - p.y, a.z + ab.z * t - p.z);
}

export class Arrows {
  private readonly flying: Arrow[] = [];
  /** Ids above the spell runtime's (both travel as SC_SPELL_EVENT projectiles). */
  private nextId = 1_000_000;
  private readonly host: ArrowHost;

  constructor(host: ArrowHost) {
    this.host = host;
  }

  /** Looses an arrow from `from` along the unit vector `dir`. */
  shoot(owner: SpellTarget, from: V3, dir: V3): void {
    const s = ARROW_RULES.speed;
    const a: Arrow = { id: this.nextId++, owner, pos: { ...from }, vel: { x: dir.x * s, y: dir.y * s, z: dir.z * s }, life: ARROW_RULES.life };
    this.flying.push(a);
    this.send(a);
  }

  private send(a: Arrow, end = false): void {
    this.host.emit(a.pos, { projectile: { id: a.id, spell: 'arrow', level: 1, pos: tuple(a.pos), vel: tuple(a.vel), ...(end ? { end } : {}) } });
  }

  /** Its owner left the zone: its arrows go with it. */
  forget(owner: SpellTarget): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      if (this.flying[i]!.owner !== owner) continue;
      this.send(this.flying[i]!, true);
      this.flying.splice(i, 1);
    }
  }

  step(): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const a = this.flying[i]!;
      const speed = Math.hypot(a.vel.x, a.vel.y, a.vel.z);
      const travel = speed * TICK_DT;
      const dir = { x: a.vel.x / speed, y: a.vel.y / speed, z: a.vel.z / speed };
      const wall = rayDistance(this.host.mw, a.pos, dir, travel);
      const reach = wall ?? travel;
      const to = { x: a.pos.x + dir.x * reach, y: a.pos.y + dir.y * reach, z: a.pos.z + dir.z * reach };
      let hit: SpellTarget | null = null;
      let hitAt = Infinity;
      for (const c of this.host.characters()) {
        if (c === a.owner || !this.host.alive(c) || !this.host.hostile(a.owner, c)) continue;
        const cp = c.character.position;
        const r = ARROW_RULES.radius;
        const d = Math.min(
          segmentDistance({ x: cp.x, y: cp.y + BODY_MID, z: cp.z }, a.pos, to),
          segmentDistance({ x: cp.x, y: cp.y + r, z: cp.z }, a.pos, to),
          segmentDistance({ x: cp.x, y: cp.y + PLAYER_HEIGHT - r, z: cp.z }, a.pos, to),
        );
        if (d > r) continue;
        const along = (cp.x - a.pos.x) * dir.x + (cp.z - a.pos.z) * dir.z;
        if (along < hitAt) {
          hitAt = along;
          hit = c;
        }
      }
      a.life -= TICK_DT;
      if (hit) {
        a.pos = { x: a.pos.x + dir.x * Math.max(0, Math.min(reach, hitAt)), y: a.pos.y + dir.y * Math.max(0, Math.min(reach, hitAt)), z: a.pos.z + dir.z * Math.max(0, Math.min(reach, hitAt)) };
        this.flying.splice(i, 1);
        this.send(a, true);
        if (this.host.shieldStops(hit, a.pos)) this.host.blocked(a.owner, hit, a.pos);
        else {
          this.host.emit(a.pos, { sounds: [{ id: ARROW_RULES.hitSound + Math.round(this.host.random()), at: tuple(a.pos) }] });
          const h = Math.hypot(dir.x, dir.z) || 1;
          this.host.hit(a.owner, hit, { x: dir.x / h, z: dir.z / h, d: ARROW_RULES.knock });
        }
        continue;
      }
      a.pos = to;
      if (wall !== null) {
        this.flying.splice(i, 1);
        this.send(a, true);
        this.host.emit(a.pos, { sounds: [{ id: ARROW_RULES.wallSound, at: tuple(a.pos) }] });
        continue;
      }
      if (a.life <= 0) {
        this.flying.splice(i, 1);
        this.send(a, true);
      }
    }
  }

  clear(): void {
    this.flying.length = 0;
  }
}

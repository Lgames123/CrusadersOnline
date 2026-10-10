/**
 * Derived-stat formulas of the original engine, recovered from its stat routine
 * (docs/reverse-engineering/executable-analysis.md §7). Pure functions of the four attributes
 * and the level, reimplemented from the observed behaviour — not used by the vertical slice's
 * balance yet (see gameplay-systems.md §4); they become the source of truth once the damage
 * application and resist steps are recovered as well.
 */
export interface Attributes {
  might: number;
  intellect: number;
  endurance: number;
  speed: number;
}

/** Attributes are base + equipment/potion bonus, each capped at 50. */
export const ATTRIBUTE_CAP = 50;

export function effectiveAttributes(base: Attributes, bonus: Partial<Attributes> = {}): Attributes {
  const f = (k: keyof Attributes) => Math.min(ATTRIBUTE_CAP, base[k] + (bonus[k] ?? 0));
  return { might: f('might'), intellect: f('intellect'), endurance: f('endurance'), speed: f('speed') };
}

export function originalMaxHp(a: Attributes, level: number): number {
  return 50 + 0.6 * a.endurance * level;
}

export function originalMaxMana(a: Attributes, level: number): number {
  return Math.trunc((a.intellect * level) / 3) + 20;
}

/** Multiplier applied to the stronger of the weapon's slash/bash damage. Truncated to one decimal. */
export function originalDamageMultiplier(a: Attributes, level: number): number {
  return Math.trunc(10 * (0.9 + 0.005 * a.might * level)) / 10;
}

/** Movement/animation rate multiplier. */
export function originalSpeedMultiplier(a: Attributes, level: number): number {
  return 0.999 + 0.01 * level + ((a.speed - 15) * 1.2 * 0.5) / 35;
}

/** Weapon hit: the stronger of slash and bash, scaled by the damage multiplier (engine behaviour). */
export function originalWeaponHit(slash: number, bash: number, multiplier: number): { type: 'slash' | 'bash'; amount: number } {
  return slash > bash ? { type: 'slash', amount: slash * multiplier } : { type: 'bash', amount: bash * multiplier };
}

/** The engine's 11 damage types, in table order (default.ctx DR0..DR10 / DD0..DD10). */
export const DAMAGE_TYPES = ['SLASH', 'BASH', 'FIRE', 'AIR', 'EARTH', 'WATER', 'MIND', 'SPIRIT', 'BODY', 'LIGHT', 'DARK'] as const;

/**
 * Damage taken (engine behaviour, executable-analysis.md §8): per type,
 * max(0, incoming - absorb) x resist x protection, then the positive components are summed.
 * `resist` is the default.ctx DR row for the difficulty (players) or the creature's table;
 * `protection` is the product of equipped items' SetProtection multipliers (1 = none).
 */
export function originalDamageTaken(
  incoming: readonly number[],
  resist: readonly number[],
  protection: readonly number[] = [],
  absorb: readonly number[] = [],
): number {
  let total = 0;
  for (let t = 0; t < DAMAGE_TYPES.length; t++) {
    const v = Math.max(0, (incoming[t] ?? 0) - (absorb[t] ?? 0)) * (resist[t] ?? 1) * (protection[t] ?? 1);
    if (v > 0) total += v;
  }
  return total;
}

/**
 * Flinch roll after a non-lethal hit on the player: 0.5 x random + damage / hpBeforeHit.
 * >= 0.8 heavy stagger, >= 0.7 light flinch, otherwise none.
 */
export function originalFlinch(damage: number, hpBefore: number, random: number): 'stagger' | 'flinch' | 'none' {
  const v = random * 0.5 + damage / hpBefore;
  return v >= 0.8 ? 'stagger' : v >= 0.7 ? 'flinch' : 'none';
}

/** Shield block cone: the engine compares the facing dot product with cos(30) — 30 radians, i.e. about +/-81 degrees. */
export const ORIGINAL_BLOCK_COS = Math.cos(30);

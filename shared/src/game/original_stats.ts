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

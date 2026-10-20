/**
 * Area levels (MMO, not original; area_levels_and_affix_tiers_plan.md §1): every act of the
 * campaign has a level its resident creatures fight at and the gear they drop is made at (item
 * level). Behind the server feature `mmoLevels` for creature levels, XP and HP / damage scaling;
 * with `mmoItems` the item level always comes from here (it sets the affix tiers).
 *
 * Levels follow the chapters' travel order (waypoints.ts WAYPOINT_CHAPTERS) inside the plan's
 * brackets: the prison 1–2, chapter 1 2–10, chapter 2 11–32, chapter 3 33–40, chapter 4 40–44,
 * chapter 5 45–50. Necros is pinned at 50 whatever his act says.
 */
import { LEVEL_PREFIX } from '../arena/level.ts';

export const AREA_LEVELS: Readonly<Record<string, number>> = {
  train: 1,
  // Chapter 1: escape and the Citadel (2–10).
  ws9a: 2, ws1a: 4, cs1b: 5, cs1a: 7, ci1a: 8, ci1b: 9, ci9a: 10, ci9b: 10,
  // Chapter 2: the Horn of Shattering (11–32).
  ci2a: 11, ci2b: 12, cs2a: 13, cs2b: 13, ws2a: 14,
  ca1a: 15, ca1b: 16, ca1c: 18, ca1d: 19,
  du1a: 20, du1b: 21, es1a: 23,
  co1a: 24, cm1a: 25, cm1b: 26, co8a: 26, cm2a: 27, cm2b: 27, co2a: 28,
  du2a: 28, du2b: 29, es2a: 29, du9a: 30, du9b: 30, es9a: 31, co3a: 31, co9a: 31, du3a: 32, du3b: 32, es3a: 32,
  // Chapter 3: Captain Ursan (33–40).
  cs3a: 33, cs3b: 33, ci3a: 34, ci3b: 34, ws3a: 35, ca2a: 35, ca2b: 36, ca2c: 36, ca2d: 36,
  gl2a: 37, gl2b: 38, gl1a: 39, gl1b: 40,
  // Chapter 4: the Solidify spell (40–44).
  du1c: 40, du8c: 40, du9c: 41, gl3a: 41, gl3b: 41, gl3c: 42, gl4a: 42, gl4b: 42, gl4c: 42,
  du2c: 42, du3c: 43, du4a: 43, du4b: 43, co4a: 44, cs4a: 43, cs4b: 43,
  ci4a: 44, ci4b: 44, ws4a: 44, ca3a: 43, ca3b: 43, ca3c: 44, ca3d: 44,
  // Chapter 5: Necros (45–50); Cs5b is the post-game hub.
  es4a: 45, es4b: 47, ws5a: 48, bs1a: 49, cs5b: 50,
};

/** Necros's level, whatever act he stands in. */
export const NECROS_LEVEL = 50;
/** Highest level a player, a creature or an item can have. */
export const LEVEL_CAP = 100;

/**
 * An act's level ("cs1a", "level:cs1a", a dungeon instance "level:ca1d@crypt-3"); an inn
 * ("cs1b-inn") is its town's; anything unknown is 1.
 */
export function areaLevel(act: string): number {
  let a = act.toLowerCase();
  if (a.startsWith(LEVEL_PREFIX)) a = a.slice(LEVEL_PREFIX.length);
  a = a.split('@')[0]!.replace(/-inn$/, '');
  return AREA_LEVELS[a] ?? 1;
}

/** Creature kinds by how far above its area a creature fights. */
export type MobRank = 'normal' | 'elite' | 'boss';

/** Levels above the area: elites +1, act and dungeon bosses +2. */
export const RANK_LEVEL_OFFSET: Readonly<Record<MobRank, number>> = { normal: 0, elite: 1, boss: 2 };
/** XP multiplier per rank (plan §2.2: elites ×2.5, bosses ×10). */
export const RANK_XP_MULT: Readonly<Record<MobRank, number>> = { normal: 1, elite: 2.5, boss: 10 };

/** A creature's level: its area's plus its rank's offset, at most LEVEL_CAP. */
export function mobLevel(area: number, rank: MobRank): number {
  return Math.max(1, Math.min(LEVEL_CAP, area + RANK_LEVEL_OFFSET[rank]));
}

/** Max HP at level L: base × (1 + 0.045 (L − 1)). */
export function mobHpScale(level: number): number {
  return 1 + 0.045 * (Math.max(1, level) - 1);
}

/** Weapon damage at level L: base × (1 + 0.035 (L − 1)). */
export function mobDamageScale(level: number): number {
  return 1 + 0.035 * (Math.max(1, level) - 1);
}

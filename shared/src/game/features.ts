/**
 * Gameplay behaviours that differ from the original game, kept for possible future use. All of
 * them are off by default: the defaults are the original's rules. A server enables them with
 * GAME_FEATURES (comma-separated names); the client learns them from SC_WORLD_ENTER so its
 * prediction matches. Presentation-only options live in the client's settings.
 */
export interface GameplayFeatures {
  /**
   * Shielded creatures raise the shield in reaction to a player's swing (archetype blockChance /
   * blockTicks / blockCooldown). The original's creatures only raised it in their stance
   * (executable-analysis §15.2).
   */
  reactiveBlock: boolean;
  /**
   * A side swing re-triggers 0.3 s into the previous one and consecutive side swings alternate
   * sides (an earlier reading of a capture). The original plays each upper-body swing whole and
   * frees the layer before the next click counts (~0.91 s apart; executable-analysis §14.1b).
   */
  sideSwingRetrigger: boolean;
  /**
   * A diagonal key pair runs (or retreats) along the diagonal with the body turned 45°, and
   * shield + diagonal hops along it (an earlier playtest reading). The original's selector
   * (0x42AFC0) lets a sideways key override forward / back: a diagonal is a sidestep.
   */
  diagonalMoves: boolean;
  /**
   * MMO items (docs/game-design/mmo/03, 04): rarity and affixes rolled on equipment a player
   * gets, refinement materials dropped by creatures, refinement +1..+10 at merchants.
   */
  mmoItems: boolean;
  /**
   * MMO dungeons (docs/game-design/mmo/06, dungeons.ts): instanced runs with a boss, entered from
   * a waypoint crystal by a finished character and his party.
   */
  mmoDungeons: boolean;
  /** MMO soft skills (docs/game-design/mmo/07, crafting.ts): ore veins, smithing, salvaging. */
  mmoCrafting: boolean;
  /**
   * MMO area levels (area_levels.ts): creatures fight at their act's level (HP and damage scaled,
   * Necros 50), XP from the creature's level and the level gap, the MMO XP curve to level 100.
   */
  mmoLevels: boolean;
}

export const ORIGINAL_FEATURES: Readonly<GameplayFeatures> = {
  reactiveBlock: false,
  sideSwingRetrigger: false,
  diagonalMoves: false,
  mmoItems: false,
  mmoDungeons: false,
  mmoCrafting: false,
  mmoLevels: false,
};

export type FeatureName = keyof GameplayFeatures;
export const FEATURE_NAMES = Object.keys(ORIGINAL_FEATURES) as FeatureName[];

/** The original's rules with `on` switched on (unknown names are ignored). */
export function gameplayFeatures(on: Partial<GameplayFeatures> | Iterable<string> = {}): GameplayFeatures {
  const out: GameplayFeatures = { ...ORIGINAL_FEATURES };
  if (Symbol.iterator in Object(on)) {
    for (const name of on as Iterable<string>) if ((FEATURE_NAMES as string[]).includes(name)) out[name as FeatureName] = true;
  } else {
    for (const name of FEATURE_NAMES) if ((on as Partial<GameplayFeatures>)[name] === true) out[name] = true;
  }
  return out;
}

/** Only the features that are on (for SC_WORLD_ENTER). */
export function enabledFeatures(f: Readonly<GameplayFeatures>): Partial<GameplayFeatures> {
  const out: Partial<GameplayFeatures> = {};
  for (const name of FEATURE_NAMES) if (f[name]) out[name] = true;
  return out;
}

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
   * Merchants trade: the use key on one opens its shop (game/shops.ts). The original places
   * merchants but they neither speak nor trade (executable-analysis §18). On by default: the
   * server config switches it off with GAME_FEATURES=-merchantShops.
   */
  merchantShops: boolean;
}

export const ORIGINAL_FEATURES: Readonly<GameplayFeatures> = {
  reactiveBlock: false,
  sideSwingRetrigger: false,
  diagonalMoves: false,
  merchantShops: false,
};

/** Non-original features a server has on unless its GAME_FEATURES says `-name`. */
export const DEFAULT_ON_FEATURES: readonly FeatureName[] = ['merchantShops'];

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

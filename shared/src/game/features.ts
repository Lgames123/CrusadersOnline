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
   * Side swings play their whole clip before the next one starts (balance: they no longer
   * outpace the combo). The original re-triggers a side swing mid-swing, 0.3 s into the
   * previous one (executable-analysis §14.1b).
   */
  sideSwingFullClip: boolean;
}

export const ORIGINAL_FEATURES: Readonly<GameplayFeatures> = {
  reactiveBlock: false,
  sideSwingFullClip: false,
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

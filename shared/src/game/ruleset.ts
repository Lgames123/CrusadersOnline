import { DAMAGE_TYPES, type Attributes } from './original_stats.ts';

/**
 * Default ruleset: the original engine's numeric parameters needed by the vertical slice
 * (attribute rows, resist rows, attack modes), recorded as facts in the reverse-engineering docs
 * (gameplay-mechanics.md, executable-analysis.md §7–8). No original assets are involved; a
 * user's converted rules (local/generated/rules/*.json) contain the complete tables. Items live
 * in items.ts.
 */
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

export type DamageType = (typeof DAMAGE_TYPES)[number];
/** 11 values in DAMAGE_TYPES order. */
export type DamageVector = number[];

export function damageVector(parts: Partial<Record<DamageType, number>>, fill = 0): DamageVector {
  return DAMAGE_TYPES.map((t) => parts[t] ?? fill);
}

export interface PlayerRules {
  attributes: Attributes;
  /** default.ctx DR row: damage-taken multipliers for the difficulty. */
  resist: DamageVector;
}

/** default.ctx DM/DI/DE/DS and DR0–DR10 columns (Easy, Medium, Hard). */
const PLAYER: Record<Difficulty, PlayerRules> = {
  easy: {
    attributes: { might: 25, intellect: 20, endurance: 30, speed: 20 },
    resist: damageVector({ SLASH: 0.6, BASH: 0.6, DARK: 1.0 }, 1),
  },
  medium: {
    attributes: { might: 20, intellect: 15, endurance: 25, speed: 15 },
    resist: damageVector({ SLASH: 0.9, BASH: 0.9, DARK: 1.0 }, 1),
  },
  hard: {
    attributes: { might: 20, intellect: 15, endurance: 20, speed: 15 },
    resist: damageVector({ SLASH: 1.2, BASH: 1.2, DARK: 1.2 }, 1),
  },
};

export function playerRules(difficulty: Difficulty): PlayerRules {
  const r = PLAYER[difficulty];
  return { attributes: { ...r.attributes }, resist: [...r.resist] };
}

/** Engine attack modes (Stats scale at +0x44): normal 1.0, power 1.25. The slice uses power for the 3rd combo hit. */
export const ATTACK_MODE_SCALE = { normal: 1.0, power: 1.25 } as const;

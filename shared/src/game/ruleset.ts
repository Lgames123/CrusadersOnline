import { DAMAGE_TYPES, type Attributes } from './original_stats.ts';

/**
 * Default ruleset: the original engine's numeric parameters needed by the vertical slice
 * (attribute rows, resist rows, one weapon), recorded as facts in the reverse-engineering docs
 * (gameplay-mechanics.md, executable-analysis.md §7–8). No original assets are involved; a
 * user's converted rules (local/generated/rules/*.json) contain the complete tables.
 */
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

export type DamageType = (typeof DAMAGE_TYPES)[number];
/** 11 values in DAMAGE_TYPES order. */
export type DamageVector = number[];

export function damageVector(parts: Partial<Record<DamageType, number>>, fill = 0): DamageVector {
  return DAMAGE_TYPES.map((t) => parts[t] ?? fill);
}

export interface WeaponDef {
  name: string;
  damage: DamageVector;
  /** Animation/swing rate multiplier (items.ctx `Speed`). */
  speed: number;
}

export interface ArmorDef {
  name: string;
  /** Damage-taken multipliers (items.ctx `SetProtection`), 1 = none. */
  protection: DamageVector;
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

/** The slice's starting weapon uses the original "Axe" numbers (items.ctx). */
export const STARTING_WEAPON: Readonly<WeaponDef> = {
  name: 'Axe',
  damage: damageVector({ SLASH: 5, BASH: 5 }),
  speed: 1.1,
};

export const NO_ARMOR: Readonly<ArmorDef> = { name: 'None', protection: damageVector({}, 1) };

/** Engine attack modes (Stats scale at +0x44): normal 1.0, power 1.25. The slice uses power for the 3rd combo hit. */
export const ATTACK_MODE_SCALE = { normal: 1.0, power: 1.25 } as const;

import { LUNGE_TICKS, TICK_RATE } from '../constants.ts';
import { originalMaxHp, type Attributes } from './original_stats.ts';
import { ATTACK_MODE_SCALE, type DamageVector } from './ruleset.ts';

/**
 * Combat and progression rules shared by server (authority) and client (presentation).
 * Damage, HP, resist and experience formulas follow the original engine (original_stats.ts,
 * ruleset.ts, executable-analysis.md §8–9); creature HP, XP and resists are the most common
 * values of the original level placements (asset-format-discovery.md §6). Swing timings and AI
 * parameters are vertical-slice values.
 */
const ticks = (ms: number) => Math.round((ms / 1000) * TICK_RATE);

export interface SwingTiming {
  /** Ticks before the hitbox becomes active. */
  startup: number;
  /** Ticks during which the hitbox can connect. */
  active: number;
  /** Ticks after the active window before the next action. */
  recovery: number;
}

/** Base swing at weapon speed 1.0; see swingForWeaponSpeed(). */
export const PLAYER_SWING: Readonly<SwingTiming> = { startup: ticks(150), active: ticks(150), recovery: ticks(250) };

/** Weapon `Speed` scales the animation rate (engine field +0x28), so swings get shorter. */
export function swingForWeaponSpeed(speed: number, base: Readonly<SwingTiming> = PLAYER_SWING): SwingTiming {
  const s = speed > 0 ? speed : 1;
  return {
    startup: Math.max(1, Math.round(base.startup / s)),
    active: Math.max(1, Math.round(base.active / s)),
    recovery: Math.max(1, Math.round(base.recovery / s)),
  };
}
/**
 * The original plays every clip at 1000/30 frames per second (× the character's speed
 * multiplier, ~1 at level 1) and its swings follow each attack clip's SWING / IMPACT /
 * RECOVERY events (executable-analysis.md §14). Frame numbers of Drake's clips:
 */
export const ORIGINAL_CLIP_FPS = 1000 / 30;
export interface ClipEvents { swing: number; impact: number; recovery: number }
/**
 * Plain clicks chain five swings (combo routine 0x0042CA20: states 24 → 23 → 25 → 103 → 104).
 * With a one-handed weapon they play models.ctx's "COMBO" clips in file order — the damage
 * frames captured in play match their IMPACT events: PN25_combo_a, PN02_1_sw_lv,
 * PN15_1_chn_atk_a, PN16_1_chn_atk_b, PN17_1_pwr_atk.
 */
const COMBO_CLIPS: readonly ClipEvents[] = [
  { swing: 11, impact: 13, recovery: 18 },
  { swing: 7, impact: 8, recovery: 13 },
  { swing: 7, impact: 9, recovery: 15 },
  { swing: 5, impact: 10, recovery: 17 },
  { swing: 11, impact: 12, recovery: 23 },
];
/** Movement key + click (original controls): overhead PN03, side swings PN09/PN10, low PN01, jump PN05. */
const DIRECTIONAL_CLIPS: Readonly<Record<'overhead' | 'left' | 'right' | 'low' | 'jump', ClipEvents>> = {
  overhead: { swing: 10, impact: 12, recovery: 16 },
  left: { swing: 5, impact: 8, recovery: 14 },
  right: { swing: 8, impact: 9, recovery: 14 },
  low: { swing: 14, impact: 16, recovery: 19 },
  jump: { swing: 17, impact: 20, recovery: 24 },
};
/** Frames after RECOVERY before the next swing can start (observed chain hand-over). */
const CHAIN_SLACK_FRAMES = 3;

/** Swing timing of an attack (kind + combo step), scaled by the weapon's Speed. */
export function attackTiming(kind: 'normal' | 'overhead' | 'left' | 'right' | 'low' | 'jump' | 'thrust' | 'bash', combo: number, weaponSpeed = 1): SwingTiming {
  if (kind === 'thrust') return clipSwingTiming(MOB_THRUST.clip, weaponSpeed);
  if (kind === 'bash') return clipSwingTiming(MOB_BASH.clip, weaponSpeed);
  const c = kind === 'normal' ? COMBO_CLIPS[Math.min(Math.max(combo, 1), COMBO_CLIPS.length) - 1]! : DIRECTIONAL_CLIPS[kind];
  return clipSwingTiming(c, weaponSpeed);
}

/**
 * Creature melee as logged from the running game's AI (every SetNextState request of the
 * skeletons, executable-analysis.md §15.2): they run beyond ~12 ft, walk in combat stance
 * inside it, hop forward (ASM_HOP_F) from ~8 ft and swing when the hop ends. Swings are the
 * clips bound to their ASM states: SWING_LEVEL (PN02), CHOP_LOW (PN01), SWING_OVERHEAD (PN03),
 * opening a chain in about 45 / 37 / 18 % of the hops. The order is also the chain order: a
 * second swing follows low -> level, level -> overhead, overhead -> low or level (9 / 8 in four
 * logs). Same-creature bursts of attacks <= 1.3 s apart: 1 (73 %), 2 (23 %), 3 (3 %).
 */
export const MOB_ATTACKS: readonly { kind: 'overhead' | 'normal' | 'low'; weight: number; clip: ClipEvents }[] = [
  { kind: 'normal', weight: 0.45, clip: { swing: 7, impact: 8, recovery: 13 } },
  { kind: 'low', weight: 0.37, clip: { swing: 14, impact: 16, recovery: 19 } },
  { kind: 'overhead', weight: 0.18, clip: { swing: 10, impact: 12, recovery: 16 } },
];
/** Chain order of the creature swings (next swing after each kind; overhead goes on with low or level). */
export const MOB_CHAIN_NEXT: Readonly<Record<'overhead' | 'normal' | 'low', readonly ('overhead' | 'normal' | 'low')[]>> = {
  low: ['normal'],
  normal: ['overhead'],
  overhead: ['low', 'normal'],
};
/** Close-range jab (ASM_THRUST, PP02: SWING 6, RECOVERY 17; no IMPACT event, hit on frame 9). */
export const MOB_THRUST = { kind: 'thrust' as const, clip: { swing: 6, impact: 9, recovery: 17 } };
/**
 * Standing in combat stance closer than this, a creature jabs (ASM_THRUST, requested at
 * 4.0-4.7 ft) instead of hopping in, once per stance (~1.1 s apart while the target stays).
 */
export const MOB_THRUST_RANGE = 4.8 * 0.3048;
/**
 * Shield bash (ASM_RAM_SHOULDER, PL01: 24 frames, no events; the charge covers 6.5 ft by
 * frame 11). Logged twice in ~90 stance decisions within 8 ft (4-5.7 ft): the player was
 * stunned (ASM_IMPACT_MEDIUM) without damage.
 */
export const MOB_BASH = { kind: 'bash' as const, clip: { swing: 4, impact: 9, recovery: 24 } };
export const MOB_BASH_CHANCE = 0.02;
export const MOB_BASH_RANGE = 5.8 * 0.3048;
/** Leaping strike (ASM_JUMP_ATTACK): taken instead of the hop in ~15 % of approaches at ~7.5 ft. */
export const MOB_JUMP_ATTACK = { kind: 'jump' as const, clip: { swing: 17, impact: 20, recovery: 24 } };
export const MOB_JUMP_ATTACK_CHANCE = 0.12;
/**
 * From the stance at 5-7 ft a creature swings straight away (no hop): SWING_OVERHEAD, SWING_LEVEL
 * and CHOP_LOW were requested 12 / 9 / 8 times at 5.0-7.0 ft in three logs (~32 % of the stance
 * decisions); beyond that it hops in first.
 */
export const MOB_SWING_RANGE = 7 * 0.3048;
/**
 * Attack rhythm logged in the original: chains of 1 (74 %) or 2 (26 %) swings. After each
 * action the creature stands 0.5 s in combat stance; in about half the stances it then raises
 * its shield (upper-body layer, ASM_BLOCK) for 0.82 s and attacks as it lowers it. The shield
 * was never raised in reaction to the player's swings.
 */
export const MOB_CHAIN_WEIGHTS = [0.74, 0.26] as const;
export const MOB_STANCE_TICKS = Math.round(0.5 * TICK_RATE);
export const MOB_SHIELD_TICKS = Math.round(0.82 * TICK_RATE);
export const MOB_SHIELD_CHANCE = 0.55;
/**
 * Inside 8 ft, after its stance, a creature sometimes steps back (ASM_RETREAT) instead of
 * attacking, and keeps retreating until it is 8 ft away (logged: every retreat ended at
 * 8.0-8.2 ft), then walks in and hops again.
 */
export const MOB_RETREAT_CHANCE = 0.12;
export const MOB_RETREAT_RANGE = 8 * 0.3048;
/** Upper bound of a retreat (it stops at 8 ft; this only stops it against a wall). */
export const MOB_RETREAT_TICKS = Math.round(1.5 * TICK_RATE);

/** Distance (centre to centre, m) inside which a creature walks in combat stance instead of running (logged 8-12 ft). */
export const MOB_COMBAT_RANGE = 12 * 0.3048;
/** Distance from which a creature lunges with a forward hop before swinging (logged 7.5-8 ft). */
export const MOB_HOP_RANGE = 8 * 0.3048;
/** ASM_HOP_F (PC07): 5.65 ft of root motion; the swing was requested 0.9-1.06 s after the hop. */
export const MOB_HOP_TICKS = LUNGE_TICKS;
/** Share of hops that end in the combat stance without a swing (logged 11 of 43). */
export const MOB_HOP_NO_SWING_CHANCE = 0.25;

/** Picks a creature attack with `roll` in [0, 1). */
export function pickMobAttack(roll: number): (typeof MOB_ATTACKS)[number] {
  let acc = 0;
  for (const a of MOB_ATTACKS) if (roll < (acc += a.weight)) return a;
  return MOB_ATTACKS[0]!;
}

/** The swing that follows `kind` in a creature chain (`roll` in [0, 1) picks among the options). */
export function nextMobAttack(kind: 'overhead' | 'normal' | 'low', roll = 0): (typeof MOB_ATTACKS)[number] {
  const options = MOB_CHAIN_NEXT[kind];
  const next = options[Math.min(options.length - 1, Math.floor(roll * options.length))]!;
  return MOB_ATTACKS.find((a) => a.kind === next)!;
}

export function clipSwingTiming(c: Readonly<ClipEvents>, weaponSpeed = 1): SwingTiming {
  const s = weaponSpeed > 0 ? weaponSpeed : 1;
  const at = (frame: number) => Math.round((frame / ORIGINAL_CLIP_FPS / s) * TICK_RATE);
  const startup = Math.max(1, at(c.swing));
  const active = Math.max(1, at(c.impact) - startup + 1);
  const recovery = Math.max(1, at(c.recovery + CHAIN_SLACK_FRAMES) - startup - active);
  return { startup, active, recovery };
}

/** Inputs arriving during recovery (or this many ticks after it) continue the combo. */
export const COMBO_WINDOW_TICKS = ticks(300);
/** Five-hit combo; every step uses the normal attack mode (the 1.25 mode is a difficulty setting). */
export const COMBO_MULTIPLIERS = [1, 1, 1, 1, 1].map(() => ATTACK_MODE_SCALE.normal);
/**
 * Melee reach beyond the target's radius and arc, from 18 hits captured in the running game
 * (executable-analysis.md §14): hits landed up to 5.95 ft centre to centre and up to ~40° off
 * the attacker's heading. These are lower bounds (few attempts at longer range).
 */
export const PLAYER_REACH = 6 * 0.3048 - 0.4;
export const PLAYER_ARC_DEG = 90;

export const PLAYER_RESPAWN_TICKS = ticks(5000);
export const MAX_LEVEL = 50;

/** XP added to the next-level threshold when reaching level n (index = new level); 4000 from level 6. */
const XP_STEP = [0, 500, 1000, 2000, 3000, 4000] as const;
const XP_STEP_LATE = 4000;

/** Total XP needed to reach `level` (engine Stats_LevelUp): 0, 500, 1500, 3500, 6500, 10500, +4000... */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 2; l <= level; l++) total += l - 1 < XP_STEP.length ? XP_STEP[l - 1]! : XP_STEP_LATE;
  return total;
}

export interface MobArchetype {
  id: string;
  name: string;
  maxHp: number;
  /** Item id of the creature's weapon (creature template table); creatures deal its whole damage vector. */
  weapon: string;
  /** Item id of its shield, if any. */
  shield: string | null;
  /** Damage-taken multipliers per type (level placement data, SLASH ... DARK). */
  resist: DamageVector;
  /**
   * Reactive block (optional feature, off by default: WorldZoneOptions.reactiveBlock): chance
   * to raise the shield when a player starts a swing at it, how long it stays up, and the
   * minimum time before the next block. Not original behaviour: logged skeletons only raised
   * the shield in their stance (MOB_SHIELD_*, executable-analysis §15.2).
   */
  blockChance: number;
  blockTicks: number;
  blockCooldown: number;
  /** Chase speed, m/s. */
  speed: number;
  aggroRadius: number;
  /** Distance from its spawn beyond which the mob gives up and returns. */
  leashRadius: number;
  reach: number;
  arcDeg: number;
  swing: SwingTiming;
  /** Minimum ticks between the end of one swing and the start of the next. */
  cooldown: number;
  xpReward: number;
  goldMin: number;
  goldMax: number;
  /** Items that may drop into the killer's inventory, each rolled independently (slice values). */
  loot: readonly { itemId: string; chance: number }[];
  /** Ticks the corpse stays before the mob respawns. */
  respawnTicks: number;
}

/**
 * Melee creatures of the original levels. Loadouts come from the creature template table
 * (executable-analysis.md §9.1); HP, XP and resists are overridden per placement in original
 * levels (the values here are each type's most common placement). AI, swing timings, loot and
 * shield behaviour are slice values shared with the skeleton.
 */
function meleeVariant(base: MobArchetype, over: Partial<MobArchetype> & Pick<MobArchetype, 'id' | 'name'>): MobArchetype {
  return { ...base, loot: [], ...over };
}

const SKELETON_WARRIOR: MobArchetype = {
  id: 'skeleton_warrior',
  name: 'Skeleton Warrior',
  // Original: 25 HP, 40 XP and these resists in 357 of 480 level placements; loadout from the
  // creature template table (Long Sword + Wooden Shield).
  maxHp: 25,
  weapon: 'long_sword',
  shield: 'wooden_shield',
  resist: [0.9, 1.1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.75],
  blockChance: 0.35,
  blockTicks: ticks(700),
  blockCooldown: ticks(1500),
  speed: 4.2,
  aggroRadius: 10,
  // Skeletons followed the player for more than 75 m in the original.
  leashRadius: 80,
  // Skeleton hits on the player were captured from 4.0 to 5.25 ft centre to centre.
  reach: 5.25 * 0.3048 - 0.4,
  arcDeg: 90,
  swing: { startup: ticks(400), active: ticks(150), recovery: ticks(500) },
  cooldown: ticks(300),
  xpReward: 40,
  goldMin: 5,
  goldMax: 10,
  loot: [
    { itemId: 'long_sword', chance: 0.25 },
    { itemId: 'scale_armor', chance: 0.1 },
  ],
  respawnTicks: ticks(10_000),
};

export const MOB_ARCHETYPES: Readonly<Record<string, MobArchetype>> = {
  skeleton_warrior: SKELETON_WARRIOR,
  // Skeleton Ghost: Long Sword + Wooden Shield; 40 HP, 75 XP.
  skeleton_ghost: meleeVariant(SKELETON_WARRIOR, {
    id: 'skeleton_ghost', name: 'Skeleton Ghost', maxHp: 40, xpReward: 75,
    resist: [1, 0.75, 1, 0.75, 1.25, 1, 1.1, 1.5, 1, 1.25, 0.5],
  }),
  // Shadow: Heavy Mace + Wooden Shield; 60 HP, 200 XP.
  shadow: meleeVariant(SKELETON_WARRIOR, {
    id: 'shadow', name: 'Shadow', maxHp: 60, xpReward: 200, weapon: 'heavy_mace',
    resist: [0.5, 0.25, 0.5, 0.5, 0.5, 0.5, 1.25, 1.25, 0, 1.5, 0.25],
  }),
  // Dark Mage: Mace + Metal Shield (its spells are not implemented); 45 HP, 60 XP.
  dark_mage: meleeVariant(SKELETON_WARRIOR, {
    id: 'dark_mage', name: 'Dark Mage', maxHp: 45, xpReward: 60, weapon: 'mace', shield: 'metal_shield',
    resist: [1, 1, 0.75, 0.75, 0.75, 0.75, 1, 1, 1, 1.25, 0.5],
  }),
};

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Original formula: 50 + 0.6 × Endurance × level, rounded for the protocol. */
export function playerMaxHp(attributes: Attributes, level: number): number {
  return Math.round(originalMaxHp(attributes, level));
}

/** Facing vector for a yaw in radians (yaw 0 faces -Z, counter-clockwise from above). */
export function forwardXZ(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Yaw (radians) that faces from (fromX, fromZ) towards (toX, toZ). */
export function yawTowards(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

/** True if the target lies within `reach` metres and inside the forward cone of `arcDeg` degrees. */
export function inMeleeArc(ax: number, az: number, yaw: number, tx: number, tz: number, reach: number, arcDeg: number, targetRadius = 0): boolean {
  const dx = tx - ax;
  const dz = tz - az;
  const dist = Math.hypot(dx, dz);
  if (dist > reach + targetRadius) return false;
  if (dist < 1e-6) return true;
  const f = forwardXZ(yaw);
  const cos = (dx * f.x + dz * f.z) / dist;
  return cos >= Math.cos(((arcDeg / 2) * Math.PI) / 180);
}

import { TICK_RATE } from '../constants.ts';

/**
 * Combat and progression rules shared by server (authority) and client (presentation).
 * Values come from docs/gameplay-specification.md §4 and gameplay-systems.md §2.2; they are
 * vertical-slice values until the original formulas are recovered (reverse-engineering backlog).
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

export const PLAYER_SWING: Readonly<SwingTiming> = { startup: ticks(150), active: ticks(150), recovery: ticks(250) };
/** Inputs arriving during recovery (or this many ticks after it) continue the combo. */
export const COMBO_WINDOW_TICKS = ticks(300);
export const COMBO_MULTIPLIERS = [1.0, 1.25, 1.6] as const;
export const PLAYER_BASE_DAMAGE = 12;
export const PLAYER_REACH = 2.2;
export const PLAYER_ARC_DEG = 110;

export const PLAYER_BASE_HP = 100;
export const HP_PER_LEVEL = 10;
export const PLAYER_RESPAWN_TICKS = ticks(5000);
export const XP_PER_LEVEL = 100;
export const MAX_LEVEL = 50;

export interface MobArchetype {
  id: string;
  name: string;
  maxHp: number;
  damageMin: number;
  damageMax: number;
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
  /** Ticks the corpse stays before the mob respawns. */
  respawnTicks: number;
}

export const MOB_ARCHETYPES: Readonly<Record<string, MobArchetype>> = {
  skeleton_warrior: {
    id: 'skeleton_warrior',
    name: 'Skeleton Warrior',
    maxHp: 60,
    damageMin: 8,
    damageMax: 12,
    speed: 4.2,
    aggroRadius: 10,
    leashRadius: 30,
    reach: 2.0,
    arcDeg: 90,
    swing: { startup: ticks(400), active: ticks(150), recovery: ticks(500) },
    cooldown: ticks(300),
    xpReward: 25,
    goldMin: 5,
    goldMax: 10,
    respawnTicks: ticks(10_000),
  },
};

export function levelForXp(xp: number): number {
  return Math.min(MAX_LEVEL, 1 + Math.floor(xp / XP_PER_LEVEL));
}

export function maxHpForLevel(level: number): number {
  return PLAYER_BASE_HP + (level - 1) * HP_PER_LEVEL;
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

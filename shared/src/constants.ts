/** Server simulation rate. Client prediction runs at the same fixed step. */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_DT = 1 / TICK_RATE;

export const GRAVITY = -9.81;

/** Player capsule (gameplay-specification.md §3.1). Height includes both hemispheres. */
export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.85;
export const PLAYER_HALF_SEGMENT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;

export const MAX_SLOPE_DEG = 45;
export const STEP_HEIGHT = 0.35;
export const GROUND_SNAP = 0.1;

/** Ground speeds per direction, metres/second. */
export interface MovementStats {
  /** Forward (run). */
  runSpeed: number;
  /** Backward ("retreat steadily"). */
  backSpeed: number;
  /** Sideways (running sidestep). */
  strafeSpeed: number;
  /** Forward while walking carefully (Shift). */
  walkSpeed: number;
  /** Backward while walking carefully. */
  walkBackSpeed: number;
  /** Sideways while walking carefully. */
  walkStrafeSpeed: number;
  jumpVelocity: number;
}

const FT = 0.3048;

/**
 * The player's speeds in the original game: locomotion there is driven by the animations'
 * root motion, so each speed is the root displacement of Drake's clip per loop at 30 fps
 * (executable-analysis.md §11): run PA01 15.6 ft/s, retreat PA06 3.9, running sidestep
 * PB01_w_side* 10.3 (left/right averaged), walk PB01_w_fw 5.2, careful sidestep PB02/03 3.8;
 * the original has no careful-backward clip, so it uses the retreat speed.
 * Jump velocity is not recovered yet (UNK-012): the jump clips barely lift the root.
 */
export const DEFAULT_MOVEMENT_STATS: Readonly<MovementStats> = {
  runSpeed: 15.6 * FT,
  backSpeed: 3.9 * FT,
  strafeSpeed: 10.3 * FT,
  walkSpeed: 5.2 * FT,
  walkBackSpeed: 3.9 * FT,
  walkStrafeSpeed: 3.8 * FT,
  jumpVelocity: 6.5,
};

/**
 * Drake's rolls (C + direction): root displacement and length of ASM_ROLL_F/B/L/R
 * (PE03 / PE06 / PE04 / PE05) at 30 fps, in feet and frames (executable-analysis.md §11).
 * Index = roll direction - 1: forward, back, left, right.
 */
export const ORIGINAL_ROLLS: readonly { distanceFt: number; frames: number }[] = [
  { distanceFt: 10.73, frames: 25 },
  { distanceFt: 10.96, frames: 25 },
  { distanceFt: 10.8, frames: 27 },
  { distanceFt: 9.99, frames: 25 },
];

/** Roll length in simulation ticks and speed in metres per second, per direction - 1. */
export const ROLLS: readonly { ticks: number; speed: number }[] = ORIGINAL_ROLLS.map((r) => {
  const ticks = Math.round((r.frames / 30) * TICK_RATE);
  return { ticks, speed: (r.distanceFt * FT) / (ticks / TICK_RATE) };
});

/** Same speed in every direction (creatures until their own clips are measured). */
export function uniformMovementStats(speed: number, jumpVelocity = 0): MovementStats {
  return { runSpeed: speed, backSpeed: speed, strafeSpeed: speed, walkSpeed: speed, walkBackSpeed: speed, walkStrafeSpeed: speed, jumpVelocity };
}

/** Interest radius for snapshots, metres. */
export const INTEREST_RADIUS = 64;

/** Server simulation rate. Client prediction runs at the same fixed step. */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_DT = 1 / TICK_RATE;

/**
 * The original's character physics (executable-analysis.md §13), feet converted to metres:
 * gravity 78.4 ft/s²; while rising, quadratic drag 0.01 per foot (a = -k·v·|v|); holding jump
 * in the air adds a small lift (the original's per-frame 0.2 ft/s boost at its 30 fps step).
 */
export const GRAVITY = -78.4 * 0.3048;
export const RISE_DRAG = 0.01 / 0.3048;
/**
 * Jumps carry no run speed (running is root motion, not physics): in the air, each held
 * direction accelerates 156.8 × 1.3 × 0.16 = 32.6 ft/s² along that body axis (twice
 * forward in a running jump), against a horizontal drag of 0.02 per foot. Once the
 * horizontal distance travelled in the air passes the jump's limit (5.2 ft; 13 ft for a
 * running jump) the push stops and the drag rises to 0.05 per foot (executable-analysis §13).
 */
export const AIR_ACCEL = 156.8 * 1.3 * 0.16 * 0.3048; // the per-frame 0.033 and 1/0.033 cancel: 32.6 ft/s²
export const AIR_DRAG = 0.02 / 0.3048;
export const AIR_DRAG_SPENT = 0.05 / 0.3048;
export const AIR_LIMIT = 5.2 * 0.3048;
export const AIR_LIMIT_RUNNING = 13 * 0.3048;
export const JUMP_HOLD_LIFT = (78.4 * 0.033 * 1.3 * 0.06 / 0.0333) * 0.3048;

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
 * root motion, so each speed is the root displacement of Drake's clip per loop played at the
 * engine's 1000/30 frames per second (executable-analysis.md §11, §14): run PA01 15.6 ft/s at
 * 30 fps × 10/9, retreat PA06 3.9, running sidestep PB01_w_side* 10.3 (left/right averaged),
 * walk PB01_w_fw 5.2, careful sidestep PB02/03 3.8 (all × 10/9);
 * the original has no careful-backward clip, so it uses the retreat speed.
 * The jump impulse comes from the physics code, not from the jump clips (§13).
 */
/** Clips play at 1000/30 frames per second instead of their authored 30: speeds × 10/9. */
const CLIP_RATE = 10 / 9;
export const DEFAULT_MOVEMENT_STATS: Readonly<MovementStats> = {
  runSpeed: 15.6 * CLIP_RATE * FT,
  backSpeed: 3.9 * CLIP_RATE * FT,
  strafeSpeed: 10.3 * CLIP_RATE * FT,
  walkSpeed: 5.2 * CLIP_RATE * FT,
  walkBackSpeed: 3.9 * CLIP_RATE * FT,
  walkStrafeSpeed: 3.8 * CLIP_RATE * FT,
  // Jump impulse: 78.4 × 0.033 × 15 × 1.3 ft/s added on take-off (§13).
  jumpVelocity: 78.4 * 0.033 * 15 * 1.3 * FT,
};

/**
 * Drake's rolls (C + direction): root displacement and length of ASM_ROLL_F/B/L/R
 * (PE03 / PE06 / PE04 / PE05), in feet and frames (played at 1000/30 frames per second) (executable-analysis.md §11).
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
  const ticks = Math.round((r.frames / (30 * CLIP_RATE)) * TICK_RATE);
  return { ticks, speed: (r.distanceFt * FT) / (ticks / TICK_RATE) };
});

/** Same speed in every direction (creatures until their own clips are measured). */
export function uniformMovementStats(speed: number, jumpVelocity = 0): MovementStats {
  return { runSpeed: speed, backSpeed: speed, strafeSpeed: speed, walkSpeed: speed, walkBackSpeed: speed, walkStrafeSpeed: speed, jumpVelocity };
}

/** Interest radius for snapshots, metres. */
export const INTEREST_RADIUS = 64;

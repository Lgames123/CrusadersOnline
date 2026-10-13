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
  /**
   * Sidesteps per side as [sideways (+ right), forward] m/s: the original's sidestep clips drift
   * forward and differ left / right. Absent: strafeSpeed / walkStrafeSpeed straight sideways.
   */
  strafeLeft?: readonly [number, number];
  strafeRight?: readonly [number, number];
  walkStrafeLeft?: readonly [number, number];
  walkStrafeRight?: readonly [number, number];
  jumpVelocity: number;
  /**
   * Feature diagonalMoves (not original): a diagonal key pair runs (or retreats) along the
   * diagonal with the body turned 45°, and shield + diagonal hops along it. The original's
   * movement selector (0x42AFC0) lets a sideways key override forward / back.
   */
  diagonalMoves?: boolean;
}

const FT = 0.3048;

/**
 * The player's speeds in the original game. Locomotion there is the clips' root motion (bone 0's
 * X / Z per frame, 0x429810 / 0x422CF0) in the character's frame, so each speed is the root
 * displacement of the clip the player's state plays (the player's state → clip table 0x4EC820
 * over models.ctx's L list) per loop, at the engine's 1000/30 frames per second. A clip loops at
 * its header +0x14 − 1 frames (§11; the root holds its last key past the clip's end):
 * RUNNING PA01 13.0 ft / 25 frames, RETREAT PA06 5.04 ft / 41, WALKING PB01_w_fw 5.68 ft / 33;
 * running sidesteps (states 87 / 88) PB01_w_sideleft 7.20 ft left + 1.11 forward / 22 and
 * PB01_w_sideright 7.71 right + 0.85 forward / 22; careful sidesteps (Shift, ASM_SIDE_STEP_L / R)
 * PB02 2.32 ft and PB03 2.75 ft per 33-frame loop (a 20-frame step, then still). Back with Shift is
 * the retreat (no careful-backward state). The jump impulse comes from the physics code (§13).
 */
/** Clips play at 1000/30 frames per second instead of their authored 30: speeds × 10/9. */
const CLIP_RATE = 10 / 9;
/** Feet over `frames` of a clip at the engine's 1000/30 frames per second, in metres per second. */
const clipSpeed = (feet: number, frames: number) => (feet / frames) * 30 * CLIP_RATE * FT;
export const DEFAULT_MOVEMENT_STATS: Readonly<MovementStats> = {
  runSpeed: clipSpeed(12.996, 25),
  backSpeed: clipSpeed(5.044, 41),
  strafeSpeed: (clipSpeed(7.199, 22) + clipSpeed(7.707, 22)) / 2,
  walkSpeed: clipSpeed(5.676, 33),
  walkBackSpeed: clipSpeed(5.044, 41),
  walkStrafeSpeed: (clipSpeed(2.323, 33) + clipSpeed(2.754, 33)) / 2,
  strafeLeft: [-clipSpeed(7.199, 22), clipSpeed(1.108, 22)],
  strafeRight: [clipSpeed(7.707, 22), clipSpeed(0.848, 22)],
  walkStrafeLeft: [-clipSpeed(2.323, 33), 0],
  walkStrafeRight: [clipSpeed(2.754, 33), 0],
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

/**
 * With the shield up (right mouse button) the original walks forward (ASM_WALKING), retreats
 * backwards (ASM_RETREAT) and, with a sideways key (diagonals too: it overrides forward / back),
 * moves in discrete side hops (ASM_HOP_L / ASM_HOP_R), each followed by a short stand (~0.2 s)
 * while the key is held (executable-analysis §14.2). For the player those states play the combat
 * sidesteps PB04_cm_stp_l (21 frames) and PB05_cm_stp_r (20 frames) (state → clip table 0x4EC820),
 * not the creatures' PC09 / PC10 hops.
 */
export const SHIELD_HOP_PAUSE_TICKS = Math.round(0.2 * TICK_RATE);
/**
 * Root displacement of PB04 / PB05 at each frame, in feet: sideways (left negative; a small
 * counter-step first, then the step) and forward (out and back to 0). The hop follows these.
 */
export const SHIELD_HOP_LEFT_CURVE: readonly number[] = [0, 0.083, 0.167, 0.25, 0.334, 0.417, 0.501, -0.099, -0.698, -1.298, -1.897, -2.449, -2.941, -3.434, -3.926, -4.141, -4.356, -4.466, -4.577, -4.687, -4.797, -4.908];
export const SHIELD_HOP_LEFT_FORWARD: readonly number[] = [0, 0.067, 0.135, 0.202, 0.27, 0.337, 0.405, 0.405, 0.405, 0.405, 0.405, 0.387, 0.358, 0.329, 0.299, 0.26, 0.22, 0.176, 0.132, 0.088, 0.044, 0];
export const SHIELD_HOP_RIGHT_CURVE: readonly number[] = [0, -0.135, -0.269, -0.404, -0.115, 0.174, 0.463, 1.007, 1.55, 2.094, 2.638, 2.898, 3.158, 3.419, 3.679, 3.939, 4.129, 4.319, 4.379, 4.44, 4.5];
export const SHIELD_HOP_RIGHT_FORWARD: readonly number[] = [0, 0.1, 0.2, 0.299, 0.316, 0.333, 0.35, 0.34, 0.33, 0.32, 0.31, 0.28, 0.251, 0.221, 0.191, 0.161, 0.129, 0.097, 0.065, 0.032, 0];
/** Length of a side hop in ticks (left 21 frames, right 20). */
export function shieldHopTicks(action: number): number {
  return curveTicks(action === ACTION_HOP_LEFT ? SHIELD_HOP_LEFT_CURVE : SHIELD_HOP_RIGHT_CURVE);
}

/**
 * Root displacement of the roll clips per frame, in feet along their travel axis (forward PE03
 * and back PE06 lengthwise, left PE04 and right PE05 sideways; signs as the motion): rolls follow
 * these profiles instead of a constant speed. Index = roll direction - 1.
 */
export const ROLL_CURVES: readonly (readonly number[])[] = [
  [0, 0.316, 0.633, 0.949, 1.265, 1.582, 1.898, 2.214, 2.531, 3.036, 3.541, 4.046, 4.551, 5.219, 5.832, 6.446, 7.059, 7.672, 8.027, 8.599, 9.254, 9.946, 10.249, 10.497, 10.728, 10.96],
  [0, -0.318, -0.636, -1.014, -1.706, -2.361, -2.933, -3.288, -3.901, -4.514, -5.127, -5.741, -6.409, -6.914, -7.419, -7.924, -8.429, -8.71, -8.992, -9.273, -9.554, -9.835, -10.116, -10.398, -10.679, -10.96],
  [0, -0.487, -0.974, -1.487, -1.999, -2.512, -3.16, -3.807, -4.455, -5.103, -5.659, -6.215, -6.476, -6.737, -6.998, -7.259, -7.597, -7.934, -8.271, -8.609, -8.946, -9.283, -9.597, -9.897, -10.196, -10.496, -10.796, -11.095],
  [0, 0.992, 1.984, 2.977, 4.234, 5.491, 5.969, 6.447, 6.924, 7.402, 7.626, 7.743, 7.86, 7.976, 8.34, 8.703, 8.852, 9, 9.148, 9.273, 9.397, 9.516, 9.636, 9.755, 9.874, 9.993],
];

/**
 * Attacks that carry the character: forward root displacement of Drake's attack clips per
 * frame, in feet, for the clips whose root ends away from where it started (the others sway
 * and come back, net zero, and keep the feet planted). Index = attack motion id - 1:
 * 1 combo step 1 (PN25, +3.85 ft), 2 combo step 3 (PN15 spin, +3.43 ft), 3 combo step 5
 * (PN17 power attack: 1.6 ft back, then +2.16 ft), 4 jump attack (PN05, run / jump + click, +6.26 ft).
 */
export const ATTACK_CURVES: readonly (readonly number[])[] = [
  [0, 0, -0.01, -0.03, -0.06, -0.02, 0.02, 0.05, 0.11, 0.27, 0.55, 1, 1.6, 2.25, 2.83, 3.28, 3.59, 3.76, 3.85],
  [0, 0.24, 0.5, 0.57, 0.65, 0.65, 0.66, 0.62, 2.06, 2.24, 2.43, 2.56, 2.7, 2.79, 2.88, 2.97, 3.07, 3.16, 3.25, 3.34, 3.43],
  [0, -0.38, -0.76, -1.15, -1.36, -1.58, -1.61, -1.61, -1.57, -1.51, -1.4, -1.26, -1.06, -0.85, -0.58, 0.18, 1.07, 1.97, 2.06, 2.15, 2.24, 2.33, 2.32, 2.31, 2.3, 2.3, 2.27, 2.25, 2.23, 2.21, 2.18, 2.16],
  [0, 0.05, 0.09, 0.14, 0.19, 0.26, 0.33, 0.42, 0.52, 0.72, 1.05, 1.45, 1.86, 2.34, 2.82, 3.29, 3.77, 4.24, 4.6, 4.95, 5.25, 5.43, 5.61, 5.69, 5.76, 5.81, 5.87, 5.91, 5.95, 5.98, 6.01, 6.03, 6.06, 6.07, 6.09, 6.11, 6.12, 6.14, 6.16, 6.18, 6.2, 6.23, 6.26, 6.26],
];
/** Movement action id of an attack's root motion (rollDir = ACTION_ATTACK + motion - 1). */
export const ACTION_ATTACK = 8;
/** Ticks an attack motion lasts (its clip at 1000/30 fps). */
export function attackMotionTicks(motion: number): number {
  return Math.ceil(((ATTACK_CURVES[motion - 1]!.length - 1) / (30 * CLIP_RATE)) * TICK_RATE);
}
/** Attack motion id (0 = none) of an attack kind and combo step. */
export function attackMotion(kind: string, combo: number): number {
  if (kind === 'jump') return 4;
  if (kind !== 'normal') return 0;
  return combo === 1 ? 1 : combo === 3 ? 2 : combo === 5 ? 3 : 0;
}

/**
 * Hit reactions (executable-analysis §8.4 / §15.3), timed movement actions that keep the
 * character from moving or acting: 16 a directional impact (ASM_IMPACT_FRONT/LEFT/RIGHT/BACK,
 * 17-frame clips), 17 a stun (ASM_IMPACT_MEDIUM: no clip bound, ~0.9 s logged), 18 a knock-down
 * (ASM_IMPACT_SEVERE, PI02: 48 frames, thrown ~9 ft back, then up again 5.36 ft from the start).
 */
export const ACTION_IMPACT = 16;
export const ACTION_STUN = 17;
export const ACTION_KNOCKDOWN = 18;
/** PI02 root displacement per frame along the facing, in feet (negative = backwards). */
export const KNOCKDOWN_CURVE: readonly number[] = [0, -1.42, -2.84, -4.26, -5.51, -6.75, -7.99, -8.18, -8.34, -8.46, -8.57, -8.59, -8.61, -8.63, -8.65, -8.67, -8.69, -8.7, -8.72, -8.74, -8.76, -8.76, -8.75, -8.76, -8.79, -8.82, -8.86, -8.9, -8.95, -9.04, -9.08, -8.33, -7.44, -6.56, -5.77, -4.97, -4.18, -4.31, -4.43, -4.56, -4.69, -4.82, -4.94, -5.01, -5.08, -5.16, -5.25, -5.3, -5.36];
/** Ticks of each hit reaction. */
export function hitReactionTicks(action: number): number {
  const frames = action === ACTION_KNOCKDOWN ? KNOCKDOWN_CURVE.length - 1 : action === ACTION_STUN ? 0.9 * 30 * CLIP_RATE : 17;
  return Math.ceil((frames / (30 * CLIP_RATE)) * TICK_RATE);
}
/**
 * Creature actions that move by their clip's forward root curve (feet per frame): 12 the
 * forward hop before a swing (ASM_HOP_F, PC07: still for 4 frames, 5.74 ft by frame 12, then
 * still; the action lasts LUNGE_TICKS, standing after the clip), 13 the shield bash
 * (ASM_RAM_SHOULDER, PL01: 6.54 ft by frame 11, settling to 5.18 ft).
 */
export const ACTION_LUNGE = 12;
export const ACTION_BASH = 13;
/** The lunge lasts 1.0 s: the next request was logged 0.9-1.06 s after the hop. */
export const LUNGE_TICKS = Math.round(1.0 * TICK_RATE);
export const LUNGE_CURVE: readonly number[] = [0, 0, 0, 0, 0, 0.54, 1.16, 1.86, 2.59, 3.32, 4.01, 4.7, 5.22, 5.74, 5.72, 5.71, 5.69, 5.67, 5.65, 5.65, 5.65];
export const BASH_CURVE: readonly number[] = [0, 0.08, 0.17, 0.25, 0.94, 1.63, 2.46, 3.36, 4.37, 5.37, 5.96, 6.54, 6.44, 6.33, 6.23, 6.12, 6.02, 5.91, 5.81, 5.71, 5.6, 5.5, 5.39, 5.29, 5.18];
/** Ticks a clip curve lasts at 1000/30 fps. */
export function curveTicks(curve: readonly number[]): number {
  return Math.ceil(((curve.length - 1) / (30 * CLIP_RATE)) * TICK_RATE);
}
/** Forward root curve of a timed action (attacks, knock-down, lunge, bash), or null. */
export function actionCurve(action: number): readonly number[] | null {
  if (action >= ACTION_ATTACK && action < ACTION_ATTACK + ATTACK_CURVES.length) return ATTACK_CURVES[action - ACTION_ATTACK]!;
  if (action === ACTION_KNOCKDOWN) return KNOCKDOWN_CURVE;
  if (action === ACTION_LUNGE) return LUNGE_CURVE;
  if (action === ACTION_BASH) return BASH_CURVE;
  return null;
}

/** Whether a timed movement action is an attack's root motion. */
export function isAttackAction(action: number): boolean {
  return action >= ACTION_ATTACK && action < ACTION_ATTACK + ATTACK_CURVES.length;
}
/** Whether a timed movement action is a hit reaction (no acting until it ends). */
export function isHitAction(action: number): boolean {
  return action >= ACTION_IMPACT && action <= ACTION_KNOCKDOWN;
}

/** Root displacement (metres) of a curve sampled per clip frame, at `ticks` into the action. */
export function curveAtTick(curve: readonly number[], ticks: number): number {
  const frame = (ticks / TICK_RATE) * 30 * CLIP_RATE;
  const i = Math.min(curve.length - 1, Math.max(0, Math.floor(frame)));
  const j = Math.min(curve.length - 1, i + 1);
  const t = Math.min(1, Math.max(0, frame - i));
  return (curve[i]! + (curve[j]! - curve[i]!) * t) * FT;
}
/** Movement action ids beyond the rolls (1-4): side hops and the stand after a hop. */
export const ACTION_HOP_LEFT = 5;
export const ACTION_HOP_RIGHT = 6;
export const ACTION_HOP_PAUSE = 7;

/** Same speed in every direction (creatures until their own clips are measured). */
export function uniformMovementStats(speed: number, jumpVelocity = 0): MovementStats {
  return { runSpeed: speed, backSpeed: speed, strafeSpeed: speed, walkSpeed: speed, walkBackSpeed: speed, walkStrafeSpeed: speed, jumpVelocity };
}

/** Interest radius for snapshots, metres. */
export const INTEREST_RADIUS = 64;

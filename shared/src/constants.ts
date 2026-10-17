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
 * direction accelerates 156.8 × 1.3 × 0.16 = 32.6 ft/s² along that body axis, and the
 * forward jumps (kinds 9 / 10) push forward, the back jump (20) backwards, as much again
 * without a key. Drag is k × v × |v| per axis where |v| is the whole 3-D speed (0x004923E0):
 * k = 0.02 horizontally, 0.01 vertically while rising. Once the horizontal distance travelled
 * since take-off passes the kind's limit the push stops and k rises to 0.05; once the vertical
 * distance passes its limit the hold lift stops and the rising k is 0.1 (executable-analysis §13).
 */
export const AIR_ACCEL = 156.8 * 1.3 * 0.16 * 0.3048; // the per-frame 0.033 and 1/0.033 cancel: 32.6 ft/s²
export const AIR_DRAG = 0.02 / 0.3048;
export const AIR_DRAG_SPENT = 0.05 / 0.3048;
export const RISE_DRAG_SPENT = 0.1 / 0.3048;
export const JUMP_HOLD_LIFT = (78.4 * 0.033 * 1.3 * 0.06 / 0.0333) * 0.3048;
/** Grounded vertical speed the original holds (−5 ft/s); the take-off impulse adds to it. */
export const GROUND_HOLD_SPEED = -5 * 0.3048;
/**
 * Jump kinds: the ASM state the jump selector (0x0042BD40) picks from the held keys (a sideways
 * key overrides forward / back): 8 STANDING_JUMP_V (none), 9 STANDING_JUMP_F (Shift + forward),
 * 10 RUNNING_JUMP_F (forward), 11 / 12 STANDING_JUMP_L / R, 20 STANDING_JUMP_B (back).
 */
export const JUMP_V = 8;
export const JUMP_F = 9;
export const JUMP_RUN = 10;
export const JUMP_L = 11;
export const JUMP_R = 12;
export const JUMP_B = 20;
export const JUMP_KINDS: readonly number[] = [JUMP_V, JUMP_F, JUMP_RUN, JUMP_L, JUMP_R, JUMP_B];
/**
 * The impulse leaves on the clip's JUMP LEAVEGROUND event (0x00457CA0 sets physics flag
 * 0x8000): PC01 / PC02 frame 10, PC03 frame 6, PC04 / PC05 / PC06 frame 12. Until then the
 * jump state stands (its clip's root hardly moves).
 */
const JUMP_TAKEOFF_FRAMES: Readonly<Record<number, number>> = { [JUMP_V]: 10, [JUMP_F]: 10, [JUMP_RUN]: 6, [JUMP_L]: 12, [JUMP_R]: 12, [JUMP_B]: 12 };
/** Ticks a jump stands before it leaves the ground, at clip rate `rate`. */
export function jumpTakeoffTicks(kind: number, rate = 1): number {
  return Math.max(1, Math.round(((JUMP_TAKEOFF_FRAMES[kind] ?? 10) / (ENGINE_CLIP_FPS * rate)) * TICK_RATE));
}
/** Travel limits of a jump in metres (0x00492B70: 1.3 × 4 ft per axis; ×2.5 / ×1.5 horizontally for kinds 10 / 9, ×2.3 vertically for 8). */
export function jumpLimits(kind: number): { horizontal: number; vertical: number } {
  const base = 1.3 * 4 * 0.3048;
  return { horizontal: base * (kind === JUMP_RUN ? 2.5 : kind === JUMP_F ? 1.5 : 1), vertical: base * (kind === JUMP_V ? 2.3 : 1) };
}
/** Forward push a jump kind adds without a key (+1 forward, −1 back). */
export function jumpAutoPush(kind: number): number {
  return kind === JUMP_F || kind === JUMP_RUN ? 1 : kind === JUMP_B ? -1 : 0;
}
/**
 * Landing from a vertical or forward jump with jump still held plays ASM_LAND_SOFT: the first
 * 30 % of PD03 (34-frame header; 0x00429BF0), standing, before the next jump.
 */
export function landSoftTicks(rate = 1): number {
  return Math.max(1, Math.round(((0.3 * 34 - 1) / (ENGINE_CLIP_FPS * rate)) * TICK_RATE));
}

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
  /** Locomotion from the original's clips (LOCO_CLIPS) instead of the constant speeds above. */
  clipLocomotion?: boolean;
  /**
   * Clip rate multiplier: the character's speed multiplier (stats +0x24C, 0.999 + 0.01 x level +
   * (Speed - 15) x 1.2 / 35 x 0.5); clips play at 1000/30 x it frames per second (logged 34.0 at
   * level 2). Default 1.
   */
  clipRate?: number;
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
  clipLocomotion: true,
  // Jump impulse: 78.4 × 0.033 × 15 × 1.3 ft/s added on take-off (§13).
  jumpVelocity: 78.4 * 0.033 * 15 * 1.3 * FT,
};

/**
 * Drake's rolls (C + direction): root displacement and length of ASM_ROLL_F/B/L/R
 * (PE03 / PE06 / PE04 / PE05), in feet and frames (played at 1000/30 frames per second) (executable-analysis.md §11).
 * The roll states loop their clip (0x00429BF0) and end, like every state, once the clip time
 * passes header +0x14 − 1 frames (PE03 24, the others 26); while C and a direction stay held
 * the selector (0x0042AFC0) asks for the roll again, so the rolls run on back to back.
 * Index = roll direction - 1: forward, back, left, right.
 */
export const ORIGINAL_ROLLS: readonly { distanceFt: number; frames: number }[] = [
  { distanceFt: 10.73, frames: 24 },
  { distanceFt: 10.96, frames: 26 },
  { distanceFt: 10.8, frames: 26 },
  { distanceFt: 9.99, frames: 26 },
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
export function attackMotionTicks(motion: number, rate = 1): number {
  return Math.ceil(((ATTACK_CURVES[motion - 1]!.length - 1) / (30 * CLIP_RATE * rate)) * TICK_RATE);
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
/**
 * A creature's longer impacts (the picker 0x004273F0): hit from the front it plays
 * ASM_IMPACT_FRONT or, 4 times in 5, one of these; hit from the left, ASM_IMPACT_LEFT or (half
 * the time) LEFT_ALT_01. Clips of the humanoid rig (pi30-pi34), with their root motion in feet
 * per frame: along the facing (negative = back) and sideways (positive = right).
 */
export const ACTION_IMPACT_FRONT_ALT = 19;
export const ACTION_IMPACT_RIGHT_FRONT = 20;
export const ACTION_IMPACT_TWO_STEPS_BACK = 21;
export const ACTION_IMPACT_LOW_FRONT = 22;
export const ACTION_IMPACT_LEFT_ALT = 23;
export const IMPACT_VARIANTS: Readonly<Record<number, { state: number; along: readonly number[]; side?: readonly number[] }>> = {
  // ASM_IMPACT_FRONT_ALT_01 (pi32, 60 frames): reels 1.7 ft back and steps in again.
  [ACTION_IMPACT_FRONT_ALT]: { state: 121, along: [0, -0.134, -0.267, -0.424, -0.581, -0.74, -0.899, -1.039, -1.18, -1.281, -1.382, -1.442, -1.501, -1.535, -1.57, -1.586, -1.603, -1.61, -1.616, -1.619, -1.623, -1.631, -1.639, -1.662, -1.684, -1.709, -1.734, -1.735, -1.736, -1.688, -1.639, -1.534, -1.429, -1.289, -1.149, -0.991, -0.833, -0.674, -0.514, -0.37, -0.225, -0.113, 0, 0.04, 0.081, 0.061, 0.04, 0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  // ASM_IMPACT_RIGHT_FRONT (pi30, 52 frames): staggers about in place.
  [ACTION_IMPACT_RIGHT_FRONT]: { state: 119, along: new Array(53).fill(0) },
  // ASM_IMPACT_FRONT_TWO_STEPS_BACK (pi31, 52 frames): two steps back, 5.1 ft.
  [ACTION_IMPACT_TWO_STEPS_BACK]: { state: 120, along: [0, -0.303, -0.607, -0.955, -1.304, -1.662, -2.021, -2.353, -2.685, -2.955, -3.225, -3.443, -3.661, -3.858, -4.055, -4.225, -4.395, -4.534, -4.673, -4.775, -4.877, -4.937, -4.998, -5.03, -5.062, -5.084, -5.106, -5.118, -5.13, -5.134, -5.138, -5.135, -5.132, -5.124, -5.115, -5.101, -5.088, -5.071, -5.054, -5.034, -5.015, -4.995, -4.974, -4.954, -4.933, -4.914, -4.894, -4.877, -4.86, -4.847, -4.833, -4.825, -4.816] },
  // ASM_IMPACT_LOW_FRONT (pi34, 48 frames): doubled over, 4.5 ft back.
  [ACTION_IMPACT_LOW_FRONT]: { state: 123, along: [0, -0.629, -1.258, -1.696, -2.133, -2.529, -2.924, -3.384, -3.844, -4.168, -4.491, -4.564, -4.638, -4.63, -4.622, -4.581, -4.54, -4.516, -4.491, -4.491, -4.49, -4.49, -4.489, -4.49, -4.491, -4.496, -4.501, -4.509, -4.517, -4.524, -4.531, -4.533, -4.536, -4.53, -4.524, -4.51, -4.496, -4.477, -4.459, -4.436, -4.414, -4.39, -4.366, -4.34, -4.315, -4.291, -4.266, -4.243, -4.22] },
  // ASM_IMPACT_LEFT_ALT_01 (pi33, 42 frames): thrown 3.8 ft to the right.
  [ACTION_IMPACT_LEFT_ALT]: { state: 122, along: new Array(43).fill(0), side: [0, -0.025, -0.05, 0.026, 0.102, 0.705, 1.308, 1.548, 1.789, 2.046, 2.303, 2.556, 2.809, 2.954, 3.099, 3.151, 3.203, 3.248, 3.292, 3.329, 3.367, 3.398, 3.429, 3.456, 3.482, 3.504, 3.526, 3.544, 3.562, 3.578, 3.594, 3.608, 3.622, 3.635, 3.649, 3.662, 3.675, 3.689, 3.703, 3.719, 3.735, 3.753, 3.772] },
};
/** Ticks of each hit reaction. */
export function hitReactionTicks(action: number, rate = 1): number {
  const variant = IMPACT_VARIANTS[action];
  const frames = variant ? variant.along.length - 1 : action === ACTION_KNOCKDOWN ? KNOCKDOWN_CURVE.length - 1 : action === ACTION_STUN ? 0.9 * 30 * CLIP_RATE : 17;
  return Math.ceil((frames / (30 * CLIP_RATE * rate)) * TICK_RATE);
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
/**
 * Ticks a clip curve lasts at 1000/30 fps x `rate`. Every clip of a character plays at 1000/30 x
 * its speed multiplier (stats +0x24C; main clips 0x429810, the upper-body layer 0x428DD0).
 */
export function curveTicks(curve: readonly number[], rate = 1): number {
  return Math.ceil(((curve.length - 1) / (30 * CLIP_RATE * rate)) * TICK_RATE);
}
/** A roll's length in ticks at clip rate `rate`. */
export function rollTicks(dir: number, rate = 1): number {
  return Math.round((ORIGINAL_ROLLS[dir - 1]!.frames / (30 * CLIP_RATE * rate)) * TICK_RATE);
}
/** Forward root curve of a timed action (attacks, knock-down, lunge, bash), or null. */
export function actionCurve(action: number): readonly number[] | null {
  if (action >= ACTION_ATTACK && action < ACTION_ATTACK + ATTACK_CURVES.length) return ATTACK_CURVES[action - ACTION_ATTACK]!;
  if (action === ACTION_KNOCKDOWN) return KNOCKDOWN_CURVE;
  if (IMPACT_VARIANTS[action]) return IMPACT_VARIANTS[action]!.along;
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
  return (action >= ACTION_IMPACT && action <= ACTION_KNOCKDOWN) || IMPACT_VARIANTS[action] !== undefined;
}

/** Root displacement (metres) of a curve sampled per clip frame, at `ticks` into the action. */
export function curveAtTick(curve: readonly number[], ticks: number, rate = 1): number {
  return curveAtFrame(curve, (ticks / TICK_RATE) * 30 * CLIP_RATE * rate);
}
/** Root displacement (metres) of a curve sampled per clip frame, at clip frame `frame`. */
export function curveAtFrame(curve: readonly number[], frame: number): number {
  const i = Math.min(curve.length - 1, Math.max(0, Math.floor(frame)));
  const j = Math.min(curve.length - 1, i + 1);
  const t = Math.min(1, Math.max(0, frame - i));
  return (curve[i]! + (curve[j]! - curve[i]!) * t) * FT;
}
/** Movement action ids beyond the rolls (1-4): side hops and the stand after a hop. */
export const ACTION_HOP_LEFT = 5;
export const ACTION_HOP_RIGHT = 6;
export const ACTION_HOP_PAUSE = 7;
/** A jump standing before take-off (its kind in Character.airKind), and ASM_LAND_SOFT. */
export const ACTION_JUMP = 24;
export const ACTION_LAND = 25;

/**
 * The player's locomotion as the original moves it. Each frame the state's clip advances (at the
 * engine's 1000/30 frames per second, looping at header +0x14 - 1 frames, the root holding its
 * last key past the clip's end) and the root's path length over that time, as a speed, is applied
 * to the held movement keys: sideways and forward / back each at that speed (0x427600:
 * velocity += key axis x speed). So a sideways key alone moves straight sideways, a diagonal moves
 * at 45 degrees at sqrt(2) x the sidestep's speed, and a new state restarts its clip from frame 0
 * (switching sides restarts the step). Confirmed in play (Frida, 16 ms samples): run 17.6 ft/s,
 * sidesteps 11.1 / 11.9, diagonals 15.2-17.1 at 45 degrees, shield hops looping every 33 frames.
 *
 * States (selector 0x42AFC0; clips from the player's table 0x4EC820): run PA01, walk PB01_w_fw,
 * retreat PA06, running sidesteps PB01_w_sideleft / right (87 / 88), careful sidesteps (Shift)
 * PB02 / PB03, shield hops PB04 / PB05. Path: cumulative root path length per frame, in feet.
 */
export interface LocoClip {
  /** Loop length in frames (header +0x14 - 1). */
  wrap: number;
  path: readonly number[];
}
export const LOCO_RUN = 1;
export const LOCO_WALK = 2;
export const LOCO_RETREAT = 3;
export const LOCO_SIDE_LEFT = 4;
export const LOCO_SIDE_RIGHT = 5;
export const LOCO_CAREFUL_LEFT = 6;
export const LOCO_CAREFUL_RIGHT = 7;
export const LOCO_HOP_LEFT = 8;
export const LOCO_HOP_RIGHT = 9;
export const LOCO_CLIPS: Readonly<Record<number, LocoClip>> = {
  [LOCO_RUN]: { wrap: 25, path: [0, 0.3, 0.952, 1.588, 2.079, 2.554, 3.03, 3.512, 3.996, 4.488, 4.988, 5.497, 6.021, 6.571, 7.136, 7.69, 8.22, 8.739, 9.257, 9.777, 10.295, 10.814, 11.335, 11.856, 12.374, 13, 13.622] },
  [LOCO_WALK]: { wrap: 33, path: [0, 0.18, 0.359, 0.539, 0.719, 0.898, 1.077, 1.257, 1.436, 1.616, 1.795, 1.975, 2.155, 2.334, 2.512, 2.691, 2.867, 3.043, 3.22, 3.389, 3.559, 3.729, 3.894, 4.059, 4.224, 4.387, 4.55, 4.713, 4.875, 5.037, 5.198, 5.36, 5.522, 5.684, 5.684] },
  [LOCO_RETREAT]: { wrap: 39, path: [0, 0.064, 0.326, 0.399, 0.469, 0.558, 0.74, 0.831, 0.924, 1.017, 1.203, 1.297, 1.39, 1.483, 1.67, 1.767, 1.866, 1.971, 2.19, 2.299, 2.404, 2.498, 2.672, 2.768, 2.882, 3.023, 3.354, 3.516, 3.657, 3.773, 3.962, 4.05, 4.141, 4.246, 4.488, 4.615, 4.738, 4.852, 5.027, 5.078, 5.096] },
  [LOCO_SIDE_LEFT]: { wrap: 22, path: [0, 0.273, 0.545, 0.818, 1.091, 1.364, 1.73, 2.097, 2.464, 2.927, 3.391, 3.694, 3.997, 4.3, 4.603, 4.906, 5.209, 5.513, 5.816, 6.119, 6.422, 6.725, 7.323, 7.922] },
  [LOCO_SIDE_RIGHT]: { wrap: 22, path: [0, 0.331, 0.662, 0.993, 1.324, 1.655, 1.986, 2.352, 2.718, 3.292, 3.867, 4.127, 4.387, 4.647, 4.907, 5.167, 5.427, 5.687, 5.947, 6.207, 6.696, 7.184, 7.77, 8.356] },
  [LOCO_CAREFUL_LEFT]: { wrap: 33, path: [0, 0.061, 0.121, 0.182, 0.243, 0.303, 0.364, 0.425, 0.485, 0.728, 0.971, 1.214, 1.457, 1.703, 1.95, 2.196, 2.442, 2.523, 2.603, 2.683, 2.764] },
  [LOCO_CAREFUL_RIGHT]: { wrap: 33, path: [0, 0.076, 0.151, 0.227, 0.303, 0.437, 0.572, 0.706, 0.841, 1.039, 1.237, 1.436, 1.634, 1.814, 1.994, 2.174, 2.354, 2.534, 2.714, 2.894, 3.074] },
  [LOCO_HOP_LEFT]: { wrap: 33, path: [0, 0.107, 0.215, 0.322, 0.429, 0.537, 0.644, 1.244, 1.843, 2.443, 3.042, 3.594, 4.088, 4.581, 5.074, 5.293, 5.511, 5.63, 5.749, 5.868, 5.986, 6.105] },
  [LOCO_HOP_RIGHT]: { wrap: 33, path: [0, 0.168, 0.335, 0.503, 0.792, 1.082, 1.372, 1.915, 2.459, 3.003, 3.547, 3.809, 4.071, 4.333, 4.594, 4.856, 5.049, 5.242, 5.31, 5.379, 5.447] },
};
/** The engine's clip rate, frames per second. */
export const ENGINE_CLIP_FPS = 1000 / 30;

/** Root path (feet) of a locomotion clip at a frame (linear between keys; held past the end). */
function locoPathAt(clip: LocoClip, frame: number): number {
  const p = clip.path;
  if (frame >= p.length - 1) return p[p.length - 1]!;
  const i = Math.max(0, Math.floor(frame));
  return p[i]! + (p[i + 1]! - p[i]!) * (frame - i);
}

/** Advances a locomotion clip by `dt` seconds from `frame`: [new frame, path covered in feet]. */
export function advanceLoco(state: number, frame: number, dt: number): [number, number] {
  const clip = LOCO_CLIPS[state];
  if (!clip) return [0, 0];
  let f = frame + dt * ENGINE_CLIP_FPS;
  let path = 0;
  if (f >= clip.wrap) {
    path += locoPathAt(clip, clip.wrap) - locoPathAt(clip, frame);
    f -= clip.wrap;
    path += locoPathAt(clip, f);
  } else {
    path = locoPathAt(clip, f) - locoPathAt(clip, frame);
  }
  return [f, path];
}

/** Same speed in every direction (creatures until their own clips are measured). */
export function uniformMovementStats(speed: number, jumpVelocity = 0): MovementStats {
  return { runSpeed: speed, backSpeed: speed, strafeSpeed: speed, walkSpeed: speed, walkBackSpeed: speed, walkStrafeSpeed: speed, jumpVelocity };
}

/** Interest radius for snapshots, metres. */
export const INTEREST_RADIUS = 64;

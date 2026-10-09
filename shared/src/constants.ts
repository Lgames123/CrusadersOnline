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

export interface MovementStats {
  walkSpeed: number;
  runSpeed: number;
  jumpVelocity: number;
}

export const DEFAULT_MOVEMENT_STATS: Readonly<MovementStats> = {
  walkSpeed: 2.5,
  runSpeed: 6.0,
  jumpVelocity: 6.5,
};

/** Interest radius for snapshots, metres. */
export const INTEREST_RADIUS = 64;

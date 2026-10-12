import type RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { AIR_ACCEL, AIR_DRAG, AIR_DRAG_SPENT, AIR_LIMIT, AIR_LIMIT_RUNNING, GRAVITY, JUMP_HOLD_LIFT, PLAYER_HALF_SEGMENT, RISE_DRAG, PLAYER_HEIGHT, PLAYER_RADIUS, ROLLS, type MovementStats } from '../constants.ts';
import type { Vec3 } from '../math/vec3.ts';
import { dequantizeAngle } from '../math/quantize.ts';
import { INPUT } from '../protocol/opcodes.ts';
import type { InputFrame } from '../protocol/binary/input.ts';
import { CHARACTER_GROUPS, type MovementWorld } from './physics.ts';

/**
 * A kinematic player capsule. `position` is the feet position in metres.
 * After every step, position (mm) and vertical velocity (mm/s) are snapped to the wire
 * resolution, so a client that resets to a server snapshot and replays the same inputs
 * reproduces the server's result exactly.
 */
export interface Character {
  collider: RAPIER.Collider;
  position: Vec3;
  velocityY: number;
  grounded: boolean;
  /** Roll in progress: 0 none, 1 forward, 2 back, 3 left, 4 right. */
  rollDir: number;
  /** Ticks of the roll still to run. */
  rollTicks: number;
  /** Jump in progress: 0 none, 1 standing / back / side, 2 running (forward). */
  airKind: number;
  /** Horizontal physics velocity during a jump, m/s (world X/Z). */
  airVelX: number;
  airVelZ: number;
  /** Horizontal distance travelled since take-off, metres. */
  airTravel: number;
}

/** Jump state carried in reconciliation snapshots. */
export interface AirState {
  kind: number;
  velX: number;
  velZ: number;
  travel: number;
}

const HALF_HEIGHT = PLAYER_HEIGHT / 2;

const snapMm = (v: number) => Math.round(v * 1000) / 1000;

export function createCharacter(mw: MovementWorld, feet: Readonly<Vec3>): Character {
  const desc = mw.rapier.ColliderDesc.capsule(PLAYER_HALF_SEGMENT, PLAYER_RADIUS)
    .setTranslation(feet.x, feet.y + HALF_HEIGHT, feet.z)
    .setCollisionGroups(CHARACTER_GROUPS)
    .setSensor(true);
  const collider = mw.world.createCollider(desc);
  return {
    collider,
    position: { x: snapMm(feet.x), y: snapMm(feet.y), z: snapMm(feet.z) },
    velocityY: 0,
    grounded: false,
    rollDir: 0,
    rollTicks: 0,
    airKind: 0,
    airVelX: 0,
    airVelZ: 0,
    airTravel: 0,
  };
}

export function removeCharacter(mw: MovementWorld, c: Character): void {
  mw.world.removeCollider(c.collider, false);
}

/** Hard-sets the character state (spawn, teleport, reconciliation). Values are snapped to wire resolution. */
export function setCharacterState(c: Character, feet: Readonly<Vec3>, velocityY: number, grounded: boolean, rollDir = 0, rollTicks = 0, air?: Readonly<AirState>): void {
  c.airKind = air?.kind ?? 0;
  c.airVelX = c.airKind ? snapMm(air!.velX) : 0;
  c.airVelZ = c.airKind ? snapMm(air!.velZ) : 0;
  c.airTravel = c.airKind ? snapMm(air!.travel) : 0;
  c.rollDir = rollTicks > 0 ? rollDir : 0;
  c.rollTicks = c.rollDir ? rollTicks : 0;
  c.position.x = snapMm(feet.x);
  c.position.y = snapMm(feet.y);
  c.position.z = snapMm(feet.z);
  c.velocityY = snapMm(velocityY);
  c.grounded = grounded;
  c.collider.setTranslation({ x: c.position.x, y: c.position.y + HALF_HEIGHT, z: c.position.z });
}

const desired = { x: 0, y: 0, z: 0 };
/** Downward speed while grounded, m/s. */
const GROUND_STICK = -0.5;

/**
 * Advances one character by one fixed step. This function is the single source of movement
 * rules: the server runs it for authority, the client runs it for prediction (ADR-005/006).
 *
 * Conventions: yaw = 0 faces -Z; yaw increases counter-clockwise seen from above.
 */
export function stepCharacter(
  mw: MovementWorld,
  c: Character,
  input: Readonly<InputFrame>,
  stats: Readonly<MovementStats>,
  dt: number,
): void {
  const f = input.flags;
  let fwd = 0;
  let right = 0;
  // C + direction starts a roll (grounded, not attacking); it then runs its full length.
  if (c.rollTicks === 0 && c.grounded && f & INPUT.ROLL && !(f & INPUT.ROOTED)) {
    const dir = rollDirection(f);
    if (dir) {
      c.rollDir = dir;
      c.rollTicks = ROLLS[dir - 1]!.ticks;
    }
  }
  const rolling = c.rollTicks > 0;
  // Attacking plants the feet (INPUT.ROOTED), so does ducking (C held); gravity still applies.
  if (!rolling && !(f & (INPUT.ROOTED | INPUT.DUCK))) {
    if (f & INPUT.FORWARD) fwd += 1;
    if (f & INPUT.BACK) fwd -= 1;
    if (f & INPUT.RIGHT) right += 1;
    if (f & INPUT.LEFT) right -= 1;
  }

  let vx = 0;
  let vz = 0;
  if (rolling) {
    const yaw = dequantizeAngle(input.yaw);
    const s = Math.sin(yaw);
    const co = Math.cos(yaw);
    const speed = ROLLS[c.rollDir - 1]!.speed;
    const along = c.rollDir === 1 ? speed : c.rollDir === 2 ? -speed : 0;
    const side = c.rollDir === 4 ? speed : c.rollDir === 3 ? -speed : 0;
    vx = -s * along + co * side;
    vz = -co * along - s * side;
  } else if (fwd !== 0 || right !== 0) {
    const yaw = dequantizeAngle(input.yaw);
    const s = Math.sin(yaw);
    const co = Math.cos(yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    // Straight: that direction's speed. Diagonal: the body turns into the motion
    // (movementFacingOffset) and keeps the forward or backward cycle's speed.
    const len = Math.hypot(fwd, right);
    const walk = (f & INPUT.WALK) !== 0;
    const lengthwise = fwd > 0 ? (walk ? stats.walkSpeed : stats.runSpeed) : (walk ? stats.walkBackSpeed : stats.backSpeed);
    const sideways = fwd !== 0 ? lengthwise : walk ? stats.walkStrafeSpeed : stats.strafeSpeed;
    const along = (fwd / len) * lengthwise;
    const side = (right / len) * sideways;
    vx = -s * along + co * side;
    vz = -co * along - s * side;
  }

  // Original vertical physics: take-off impulse, gravity, extra lift while jump is held in
  // the air, and quadratic drag while rising.
  let vy = c.velocityY;
  let ay = GRAVITY;
  const air: AirState = { kind: c.airKind, velX: c.airVelX, velZ: c.airVelZ, travel: c.airTravel };
  const jumping = c.grounded && (f & INPUT.JUMP) !== 0 && !rolling && !(f & INPUT.DUCK) && stats.jumpVelocity > 0;
  if (jumping) {
    vy = stats.jumpVelocity + ay * dt;
    // Take-off: no horizontal speed carries over; holding forward makes a running jump.
    air.kind = f & INPUT.FORWARD && !(f & INPUT.BACK) ? 2 : 1;
    air.velX = air.velZ = air.travel = 0;
  } else if (c.grounded) {
    // On the ground the original holds a constant downward stick speed instead of
    // accumulating gravity; a small one keeps the controller glued to slopes and steps.
    vy = GROUND_STICK;
  } else {
    if (f & INPUT.JUMP) ay += JUMP_HOLD_LIFT;
    vy += ay * dt;
  }
  if (vy > 0) {
    const drag = RISE_DRAG * vy * vy * dt;
    vy = drag > vy ? 0 : vy - drag;
  }

  if (air.kind && !rolling) {
    // Jump: horizontal physics (air control, drag, distance limit) replaces ground motion.
    const yaw = dequantizeAngle(input.yaw);
    const s = Math.sin(yaw);
    const co = Math.cos(yaw);
    const spent = air.travel > (air.kind === 2 ? AIR_LIMIT_RUNNING : AIR_LIMIT);
    let along = 0;
    let side = 0;
    if (!spent && !(f & INPUT.ROOTED)) {
      along = ((f & INPUT.FORWARD ? 1 : 0) - (f & INPUT.BACK ? 1 : 0) + (air.kind === 2 ? 1 : 0)) * AIR_ACCEL;
      side = ((f & INPUT.RIGHT ? 1 : 0) - (f & INPUT.LEFT ? 1 : 0)) * AIR_ACCEL;
    }
    air.velX += (-s * along + co * side) * dt;
    air.velZ += (-co * along - s * side) * dt;
    const k = spent ? AIR_DRAG_SPENT : AIR_DRAG;
    const dragX = k * air.velX * Math.abs(air.velX) * dt;
    const dragZ = k * air.velZ * Math.abs(air.velZ) * dt;
    air.velX = Math.abs(dragX) > Math.abs(air.velX) ? 0 : air.velX - dragX;
    air.velZ = Math.abs(dragZ) > Math.abs(air.velZ) ? 0 : air.velZ - dragZ;
    vx = air.velX;
    vz = air.velZ;
  }

  desired.x = vx * dt;
  desired.y = vy * dt;
  desired.z = vz * dt;
  mw.controller.computeColliderMovement(c.collider, desired, undefined, CHARACTER_GROUPS);
  const moved = mw.controller.computedMovement();
  const grounded = mw.controller.computedGrounded();

  // Hit a ceiling while rising: stop vertical motion.
  if (desired.y > 0 && moved.y < desired.y * 0.5) vy = 0;
  if (grounded && vy < 0) vy = 0;

  const rollTicks = rolling ? c.rollTicks - 1 : 0;
  if (air.kind) {
    air.travel += Math.hypot(moved.x, moved.z);
    // Landing ends the jump (but not on the take-off step itself).
    if (grounded && !jumping) air.kind = 0;
  }
  setCharacterState(
    c,
    { x: c.position.x + moved.x, y: c.position.y + moved.y, z: c.position.z + moved.z },
    vy,
    grounded,
    c.rollDir,
    rollTicks,
    air,
  );
}

/** Roll direction for held movement flags: 1 forward, 2 back, 3 left, 4 right, 0 none. */
export function rollDirection(flags: number): number {
  if (flags & INPUT.FORWARD && !(flags & INPUT.BACK)) return 1;
  if (flags & INPUT.BACK && !(flags & INPUT.FORWARD)) return 2;
  if (flags & INPUT.LEFT && !(flags & INPUT.RIGHT)) return 3;
  if (flags & INPUT.RIGHT && !(flags & INPUT.LEFT)) return 4;
  return 0;
}

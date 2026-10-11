import type RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { GRAVITY, PLAYER_HALF_SEGMENT, PLAYER_HEIGHT, PLAYER_RADIUS, type MovementStats } from '../constants.ts';
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
  };
}

export function removeCharacter(mw: MovementWorld, c: Character): void {
  mw.world.removeCollider(c.collider, false);
}

/** Hard-sets the character state (spawn, teleport, reconciliation). Values are snapped to wire resolution. */
export function setCharacterState(c: Character, feet: Readonly<Vec3>, velocityY: number, grounded: boolean): void {
  c.position.x = snapMm(feet.x);
  c.position.y = snapMm(feet.y);
  c.position.z = snapMm(feet.z);
  c.velocityY = snapMm(velocityY);
  c.grounded = grounded;
  c.collider.setTranslation({ x: c.position.x, y: c.position.y + HALF_HEIGHT, z: c.position.z });
}

const desired = { x: 0, y: 0, z: 0 };

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
  // Attacking plants the feet (INPUT.ROOTED); gravity still applies.
  if (!(f & INPUT.ROOTED)) {
    if (f & INPUT.FORWARD) fwd += 1;
    if (f & INPUT.BACK) fwd -= 1;
    if (f & INPUT.RIGHT) right += 1;
    if (f & INPUT.LEFT) right -= 1;
  }

  let vx = 0;
  let vz = 0;
  if (fwd !== 0 || right !== 0) {
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

  let vy = c.velocityY;
  if (c.grounded && f & INPUT.JUMP) vy = stats.jumpVelocity;
  vy += GRAVITY * dt;

  desired.x = vx * dt;
  desired.y = vy * dt;
  desired.z = vz * dt;
  mw.controller.computeColliderMovement(c.collider, desired, undefined, CHARACTER_GROUPS);
  const moved = mw.controller.computedMovement();
  const grounded = mw.controller.computedGrounded();

  // Hit a ceiling while rising: stop vertical motion.
  if (desired.y > 0 && moved.y < desired.y * 0.5) vy = 0;
  if (grounded && vy < 0) vy = 0;

  setCharacterState(
    c,
    { x: c.position.x + moved.x, y: c.position.y + moved.y, z: c.position.z + moved.z },
    vy,
    grounded,
  );
}

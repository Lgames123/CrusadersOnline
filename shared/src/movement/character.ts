import type RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { ACTION_ATTACK, ACTION_LUNGE, LUNGE_TICKS, ATTACK_CURVES, actionCurve, attackMotionTicks, curveTicks, hitReactionTicks, isAttackAction, ACTION_HOP_LEFT, ACTION_HOP_PAUSE, ACTION_HOP_RIGHT, SHIELD_HOP_LEFT_CURVE, SHIELD_HOP_PAUSE_TICKS, SHIELD_HOP_RIGHT_CURVE, SHIELD_HOP_TICKS, curveAtTick, ROLL_CURVES, AIR_ACCEL, AIR_DRAG, AIR_DRAG_SPENT, AIR_LIMIT, AIR_LIMIT_RUNNING, GRAVITY, JUMP_HOLD_LIFT, PLAYER_HALF_SEGMENT, RISE_DRAG, PLAYER_HEIGHT, PLAYER_RADIUS, ROLLS, type MovementStats } from '../constants.ts';
import type { Vec3 } from '../math/vec3.ts';
import { dequantizeAngle } from '../math/quantize.ts';
import { INPUT, INPUT_ATTACK_SHIFT } from '../protocol/opcodes.ts';
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
  /**
   * Timed movement action in progress: 0 none, 1-4 rolls (forward, back, left, right),
   * 5 / 6 shield side hops (left / right), 7 the stand after a side hop, 8-11 an attack's
   * root motion (ACTION_ATTACK + attack motion - 1), 16-18 hit reactions (impact, stun, knock-down).
   */
  rollDir: number;
  /** Ticks of the roll still to run. */
  rollTicks: number;
  /** Total ticks of the timed action in progress (its curve is sampled from its start). */
  actionLength: number;
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
    actionLength: 0,
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
  c.actionLength = actionTicks(c.rollDir);
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
  // An attack whose clip carries the character starts its root motion (also over the stand
  // after a hop or another attack's motion: combo steps restart it).
  const motion = (f >> INPUT_ATTACK_SHIFT) & 0xf;
  if (motion > 0 && motion <= ATTACK_CURVES.length && c.grounded && (c.rollTicks === 0 || c.rollDir === ACTION_HOP_PAUSE || isAttackAction(c.rollDir))) {
    startTimedAction(c, ACTION_ATTACK + motion - 1);
  }
  // C + direction starts a roll (grounded, not attacking); it then runs its full length.
  // Shield + a sideways key starts a side hop (the original moves sideways in hops when
  // blocking); each hop is followed by a short stand.
  if (c.rollTicks === 0 && c.grounded && !(f & INPUT.ROOTED)) {
    const dir = f & INPUT.ROLL ? rollDirection(f) : 0;
    const side = (f & INPUT.RIGHT ? 1 : 0) - (f & INPUT.LEFT ? 1 : 0);
    if (dir) {
      c.rollDir = dir;
      c.rollTicks = ROLLS[dir - 1]!.ticks;
    } else if (f & INPUT.BLOCK && side !== 0) {
      c.rollDir = side > 0 ? ACTION_HOP_RIGHT : ACTION_HOP_LEFT;
      c.rollTicks = SHIELD_HOP_TICKS;
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
    // Side hops follow the clip's root-motion profile tick by tick.
    let hop = 0;
    if (c.rollDir === ACTION_HOP_LEFT || c.rollDir === ACTION_HOP_RIGHT) {
      const curve = c.rollDir === ACTION_HOP_LEFT ? SHIELD_HOP_LEFT_CURVE : SHIELD_HOP_RIGHT_CURVE;
      const done = SHIELD_HOP_TICKS - c.rollTicks;
      hop = (curveAtTick(curve, done + 1) - curveAtTick(curve, done)) / dt;
    }
    // Rolls follow their clip's root-motion profile too (lengthwise forward/back, sideways left/right).
    let roll = 0;
    if (c.rollDir >= 1 && c.rollDir <= 4) {
      const curve = ROLL_CURVES[c.rollDir - 1]!;
      const done = ROLLS[c.rollDir - 1]!.ticks - c.rollTicks;
      roll = (curveAtTick(curve, done + 1) - curveAtTick(curve, done)) / dt;
    }
    // Attacks move along the facing by their clip's forward root displacement.
    // Attacks, the knock-down (thrown back, PI02) and creature lunges / bashes follow their
    // clip's forward root curve; c.rollTicks counts down from the action's length.
    const curve = actionCurve(c.rollDir);
    if (curve) {
      const done = c.actionLength - c.rollTicks;
      roll = (curveAtTick(curve, done + 1) - curveAtTick(curve, done)) / dt;
    }
    let along = c.rollDir === 1 || c.rollDir === 2 || curve ? roll : 0;
    let side = c.rollDir === 3 || c.rollDir === 4 ? roll : hop;
    // Shield + a diagonal (forward / back with a side key): the side hop goes along that diagonal.
    const lengthwise = (f & INPUT.FORWARD ? 1 : 0) - (f & INPUT.BACK ? 1 : 0);
    if (hop !== 0 && lengthwise !== 0) {
      along = Math.abs(hop) * lengthwise * Math.SQRT1_2;
      side = hop * Math.SQRT1_2;
    }
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
    // Shield up: walk forward, retreat back (sideways keys start side hops above).
    const shield = (f & INPUT.BLOCK) !== 0;
    const walk = (f & INPUT.WALK) !== 0 || shield;
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

  let rollTicks = rolling ? c.rollTicks - 1 : 0;
  let rollDir = c.rollDir;
  // A side hop ends in a short stand before the next one can start.
  if (rolling && rollTicks === 0 && (rollDir === ACTION_HOP_LEFT || rollDir === ACTION_HOP_RIGHT)) {
    rollDir = ACTION_HOP_PAUSE;
    rollTicks = SHIELD_HOP_PAUSE_TICKS;
  }
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
    rollDir,
    rollTicks,
    air,
  );
}

/** Length in ticks of a timed action that follows a curve or holds the character (0 otherwise). */
function actionTicks(action: number): number {
  if (isAttackAction(action)) return attackMotionTicks(action - ACTION_ATTACK + 1);
  if (action >= 16 && action <= 18) return hitReactionTicks(action);
  if (action === ACTION_LUNGE) return LUNGE_TICKS;
  const curve = actionCurve(action);
  return curve ? curveTicks(curve) : 0;
}

/** Starts a timed action (attack motion, hit reaction, creature lunge / bash), replacing any other. */
export function startTimedAction(c: Character, action: number): void {
  c.rollDir = action;
  c.rollTicks = actionTicks(action);
  c.actionLength = c.rollTicks;
}

/** Starts a hit reaction (ACTION_IMPACT / ACTION_STUN / ACTION_KNOCKDOWN): it replaces any timed action. */
export function startHitReaction(c: Character, action: number): void {
  startTimedAction(c, action);
}

/** Roll direction for held movement flags: 1 forward, 2 back, 3 left, 4 right, 0 none. */
export function rollDirection(flags: number): number {
  if (flags & INPUT.FORWARD && !(flags & INPUT.BACK)) return 1;
  if (flags & INPUT.BACK && !(flags & INPUT.FORWARD)) return 2;
  if (flags & INPUT.LEFT && !(flags & INPUT.RIGHT)) return 3;
  if (flags & INPUT.RIGHT && !(flags & INPUT.LEFT)) return 4;
  return 0;
}

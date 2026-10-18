import type RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { IMPACT_VARIANTS, isHitAction, ACTION_ATTACK, ACTION_BASH, ACTION_LUNGE, LUNGE_TICKS, ATTACK_CURVES, actionCurve, attackMotionTicks, curveTicks, hitReactionTicks, isAttackAction, ACTION_HOP_LEFT, ACTION_HOP_PAUSE, ACTION_HOP_RIGHT, SHIELD_HOP_LEFT_CURVE, SHIELD_HOP_LEFT_FORWARD, SHIELD_HOP_PAUSE_TICKS, SHIELD_HOP_RIGHT_CURVE, SHIELD_HOP_RIGHT_FORWARD, shieldHopTicks, curveAtTick, curveAtFrame, ORIGINAL_ROLLS, ROLL_CURVES, rollTicks as rollLength, advanceLoco, ACTION_JUMP, ACTION_LAND, ACTION_MOUNT, LEDGE_MAX_FACING_DOT, LEDGE_MAX_WALL_NORMAL_Y, LEDGE_MIN_RISE, LEDGE_REACH_AHEAD, LEDGE_REACH_UP, LEDGE_TRACE_TO, mountTicks, GROUND_HOLD_SPEED, JUMP_B, JUMP_F, JUMP_L, JUMP_R, JUMP_RUN, JUMP_V, RISE_DRAG_SPENT, jumpAutoPush, jumpLimits, jumpTakeoffTicks, landSoftTicks, LOCO_CAREFUL_LEFT, LOCO_CAREFUL_RIGHT, LOCO_HOP_LEFT, LOCO_HOP_RIGHT, LOCO_RETREAT, LOCO_RUN, LOCO_SIDE_LEFT, LOCO_SIDE_RIGHT, LOCO_WALK, AIR_ACCEL, AIR_DRAG, AIR_DRAG_SPENT, GRAVITY, JUMP_HOLD_LIFT, MAX_SLOPE_DEG, PLAYER_HALF_SEGMENT, RISE_DRAG, PLAYER_HEIGHT, PLAYER_RADIUS, ROLLS, type MovementStats } from '../constants.ts';
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
   * root motion (ACTION_ATTACK + attack motion - 1), 16-18 hit reactions (impact, stun, knock-down),
   * 24 a jump standing before take-off, 25 the soft landing, 26 pulling up onto a ledge.
   */
  rollDir: number;
  /** Ticks of the roll still to run. */
  rollTicks: number;
  /** Total ticks of the timed action in progress (its curve is sampled from its start). */
  actionLength: number;
  /**
   * At rest: the last full step had no input motion and moved under 0.5 mm, so standing still
   * needs no collision query. Cleared by any state reset (spawn, reconciliation).
   */
  settled: boolean;
  /** Jump in progress (also while it stands before take-off): 0 none, else its kind (JUMP_*, the ASM state). */
  airKind: number;
  /** Horizontal physics velocity during a jump, m/s (world X/Z). */
  airVelX: number;
  airVelZ: number;
  /** Horizontal distance travelled since take-off, metres. */
  airTravel: number;
  /** Vertical distance travelled since take-off (up and down), metres. */
  airRise: number;
  /** Clip rate multiplier (the character's speed multiplier; set from its stats every step). */
  clipRate: number;
  /** Locomotion state (LOCO_*; 0 standing) and its clip's frame (clip locomotion, LOCO_CLIPS). */
  locoState: number;
  locoFrame: number;
}

/** Locomotion clip state carried in reconciliation snapshots. */
export interface LocoState {
  state: number;
  frame: number;
}

/** Jump state carried in reconciliation snapshots. */
export interface AirState {
  kind: number;
  velX: number;
  velZ: number;
  travel: number;
  rise?: number;
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
    settled: false,
    airKind: 0,
    airVelX: 0,
    airVelZ: 0,
    airTravel: 0,
    airRise: 0,
    clipRate: 1,
    locoState: 0,
    locoFrame: 0,
  };
}

export function removeCharacter(mw: MovementWorld, c: Character): void {
  mw.world.removeCollider(c.collider, false);
}

/** Hard-sets the character state (spawn, teleport, reconciliation). Values are snapped to wire resolution. */
export function setCharacterState(c: Character, feet: Readonly<Vec3>, velocityY: number, grounded: boolean, rollDir = 0, rollTicks = 0, air?: Readonly<AirState>, loco?: Readonly<LocoState>): void {
  c.locoState = loco?.state ?? 0;
  c.locoFrame = loco ? Math.round(loco.frame * 4) / 4 : 0;
  c.airKind = air?.kind ?? 0;
  c.airVelX = c.airKind ? snapMm(air!.velX) : 0;
  c.airVelZ = c.airKind ? snapMm(air!.velZ) : 0;
  c.airTravel = c.airKind ? snapMm(air!.travel) : 0;
  c.airRise = c.airKind ? snapMm(air!.rise ?? 0) : 0;
  c.rollDir = rollTicks > 0 ? rollDir : 0;
  c.rollTicks = c.rollDir ? rollTicks : 0;
  c.actionLength = actionTicks(c.rollDir, c.clipRate);
  c.settled = false;
  c.position.x = snapMm(feet.x);
  c.position.y = snapMm(feet.y);
  c.position.z = snapMm(feet.z);
  c.velocityY = snapMm(velocityY);
  c.grounded = grounded;
  c.collider.setTranslation({ x: c.position.x, y: c.position.y + HALF_HEIGHT, z: c.position.z });
}

const desired = { x: 0, y: 0, z: 0 };
/** Metres per foot (the clips' unit). */
const FT_M = 0.3048;
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
  c.clipRate = stats.clipRate ?? 1;
  const rate = c.clipRate;
  let fwd = 0;
  let right = 0;
  // An attack whose clip carries the character starts its root motion (also over the stand
  // after a hop or another attack's motion: combo steps restart it; and over a jump still
  // standing before take-off: the jump selector 0x0042BD40 turns a click there into the leap).
  const motion = (f >> INPUT_ATTACK_SHIFT) & 0xf;
  if (motion > 0 && motion <= ATTACK_CURVES.length && c.grounded && (c.rollTicks === 0 || c.rollDir === ACTION_HOP_PAUSE || isAttackAction(c.rollDir) || c.rollDir === ACTION_JUMP)) {
    startTimedAction(c, ACTION_ATTACK + motion - 1);
  }
  // C + direction rolls (grounded, not attacking) and the roll runs its full length; with both
  // still held the next roll follows at once (the selector 0x0042AFC0 asks for it every frame).
  // Shield + a sideways key starts a side hop (the original moves sideways in hops when
  // blocking); each hop is followed by a short stand.
  if (c.rollTicks === 0 && c.grounded && !(f & INPUT.ROOTED)) {
    const dir = f & (INPUT.ROLL | INPUT.DUCK) ? rollDirection(f) : 0;
    const side = movementAxes(f)[1];
    if (dir) {
      c.rollDir = dir;
      c.rollTicks = rollLength(dir, rate);
    } else if (f & INPUT.BLOCK && f & INPUT.JUMP) {
      // Shield + jump: the shield rush (ASM_RAM_SHOULDER, PL01's root motion) instead of a jump.
      startTimedAction(c, ACTION_BASH);
    } else if (f & INPUT.JUMP && !(f & INPUT.DUCK) && stats.jumpVelocity > 0) {
      // Jump: the kind's clip stands until its JUMP event, then the impulse (below).
      c.airKind = jumpKind(f);
      c.rollDir = ACTION_JUMP;
      // The stand, then the take-off step itself.
      c.rollTicks = c.actionLength = jumpTakeoffTicks(c.airKind, rate) + 1;
      c.airVelX = c.airVelZ = c.airTravel = c.airRise = 0;
    } else if (f & INPUT.BLOCK && side !== 0 && (!stats.clipLocomotion || stats.diagonalMoves)) {
      // Constant-speed / feature locomotion: discrete hops as timed actions (clip locomotion
      // loops the hop clip as a locomotion state instead, below).
      c.rollDir = side > 0 ? ACTION_HOP_RIGHT : ACTION_HOP_LEFT;
      c.rollTicks = shieldHopTicks(c.rollDir);
    }
  }
  const rolling = c.rollTicks > 0;
  // A jump stands until its last tick, the take-off step (its kind is in airKind).
  const windup = rolling && c.rollDir === ACTION_JUMP;
  const takeoff = windup && c.rollTicks === 1 && c.grounded;
  // Attacking plants the feet (INPUT.ROOTED), so does ducking (C held); gravity still applies.
  if (!rolling && !(f & (INPUT.ROOTED | INPUT.DUCK))) {
    [fwd, right] = movementAxes(f);
  }

  let vx = 0;
  let vz = 0;
  /** Locomotion clip state after this step (standing unless moving by clip locomotion). */
  let locoNext: LocoState = { state: 0, frame: 0 };
  if (rolling) {
    const yaw = dequantizeAngle(input.yaw);
    const s = Math.sin(yaw);
    const co = Math.cos(yaw);
    // Side hops follow the clip's root-motion profile tick by tick.
    let hop = 0;
    let hopForward = 0;
    if (c.rollDir === ACTION_HOP_LEFT || c.rollDir === ACTION_HOP_RIGHT) {
      const left = c.rollDir === ACTION_HOP_LEFT;
      const curve = left ? SHIELD_HOP_LEFT_CURVE : SHIELD_HOP_RIGHT_CURVE;
      const fwdCurve = left ? SHIELD_HOP_LEFT_FORWARD : SHIELD_HOP_RIGHT_FORWARD;
      const done = shieldHopTicks(c.rollDir) - c.rollTicks;
      hop = (curveAtTick(curve, done + 1, rate) - curveAtTick(curve, done, rate)) / dt;
      hopForward = (curveAtTick(fwdCurve, done + 1, rate) - curveAtTick(fwdCurve, done, rate)) / dt;
    }
    // Rolls follow their clip's root-motion profile too (lengthwise forward/back, sideways left/right).
    let roll = 0;
    // A roll's ticks span its state's whole loop (ORIGINAL_ROLLS frames), so rolls held back to
    // back cover the clip's distance per loop whatever the tick rounding.
    if (c.rollDir >= 1 && c.rollDir <= 4) {
      const curve = ROLL_CURVES[c.rollDir - 1]!;
      const ticks = rollLength(c.rollDir, rate);
      const done = ticks - c.rollTicks;
      const at = (t: number) => curveAtFrame(curve, (t / ticks) * ORIGINAL_ROLLS[c.rollDir - 1]!.frames);
      roll = (at(done + 1) - at(done)) / dt;
    }
    // Attacks move along the facing by their clip's forward root displacement.
    // Attacks, the knock-down (thrown back, PI02) and creature lunges / bashes follow their
    // clip's forward root curve; c.rollTicks counts down from the action's length.
    const curve = actionCurve(c.rollDir);
    if (curve) {
      const done = c.actionLength - c.rollTicks;
      roll = (curveAtTick(curve, done + 1, rate) - curveAtTick(curve, done, rate)) / dt;
    }
    // A creature thrown sideways by its impact (ASM_IMPACT_LEFT_ALT_01).
    const sideCurve = IMPACT_VARIANTS[c.rollDir]?.side;
    if (sideCurve) {
      const done = c.actionLength - c.rollTicks;
      hop = (curveAtTick(sideCurve, done + 1, rate) - curveAtTick(sideCurve, done, rate)) / dt;
    }
    let along = c.rollDir === 1 || c.rollDir === 2 || curve ? roll : hopForward;
    let side = c.rollDir === 3 || c.rollDir === 4 ? roll : hop;
    // Feature diagonalMoves (not original): shield + a diagonal hops along that diagonal.
    const lengthwise = (f & INPUT.FORWARD ? 1 : 0) - (f & INPUT.BACK ? 1 : 0);
    if (stats.diagonalMoves && hop !== 0 && lengthwise !== 0) {
      along = hop * (c.rollDir === ACTION_HOP_RIGHT ? 1 : -1) * lengthwise * Math.SQRT1_2;
      side = hop * Math.SQRT1_2;
    }
    vx = -s * along + co * side;
    vz = -co * along - s * side;
  } else if (fwd !== 0 || right !== 0) {
    const yaw = dequantizeAngle(input.yaw);
    const s = Math.sin(yaw);
    const co = Math.cos(yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    // The original's movement selector (0x42AFC0): a sideways key overrides forward / back and
    // plays a sidestep (running: states 87 / 88; Shift: ASM_SIDE_STEP_L / R), which moves by its
    // clip's root motion (sideways plus a forward drift); otherwise forward runs (Shift or the
    // shield: walks) and back retreats. Shield + sideways hops (above).
    const shield = (f & INPUT.BLOCK) !== 0;
    const walk = (f & INPUT.WALK) !== 0 || shield;
    let along = 0;
    let side = 0;
    if (stats.clipLocomotion && !stats.diagonalMoves) {
      // The state's clip (restarted on a state change) gives the speed; the held keys its
      // direction, each axis at that speed (LOCO_CLIPS).
      let state: number;
      if (right !== 0) state = shield ? (right < 0 ? LOCO_HOP_LEFT : LOCO_HOP_RIGHT) : f & INPUT.WALK ? (right < 0 ? LOCO_CAREFUL_LEFT : LOCO_CAREFUL_RIGHT) : right < 0 ? LOCO_SIDE_LEFT : LOCO_SIDE_RIGHT;
      else state = fwd > 0 ? (walk ? LOCO_WALK : LOCO_RUN) : LOCO_RETREAT;
      const frame = state === c.locoState ? c.locoFrame : 0;
      const [next, feet] = advanceLoco(state, frame, dt * (stats.clipRate ?? 1));
      locoNext = { state, frame: next };
      const speed = (feet * FT_M) / dt;
      side = right * speed;
      along = fwd * speed;
    } else if (stats.diagonalMoves) {
      // Feature diagonalMoves (not original): diagonals run along the diagonal (body turned 45°).
      const len = Math.hypot(fwd, right);
      const lengthwise = fwd > 0 ? (walk ? stats.walkSpeed : stats.runSpeed) : (walk ? stats.walkBackSpeed : stats.backSpeed);
      const sideways = fwd !== 0 ? lengthwise : walk ? stats.walkStrafeSpeed : stats.strafeSpeed;
      along = (fwd / len) * lengthwise;
      side = (right / len) * sideways;
    } else if (right !== 0) {
      // Shield + sideways is only ever the side hop (a timed action), never a sidestep.
      const step = right < 0 ? (walk ? stats.walkStrafeLeft : stats.strafeLeft) : (walk ? stats.walkStrafeRight : stats.strafeRight);
      if (!shield) {
        side = step ? step[0] : right * (walk ? stats.walkStrafeSpeed : stats.strafeSpeed);
        along = step ? step[1] : 0;
      }
    } else {
      along = fwd > 0 ? (walk ? stats.walkSpeed : stats.runSpeed) : -(walk ? stats.walkBackSpeed : stats.backSpeed);
    }
    vx = -s * along + co * side;
    vz = -co * along - s * side;
  }

  // Original vertical physics (0x00492B70 / 0x004923E0): take-off impulse, gravity, extra lift
  // while jump is held in the air, and drag k x v x |v| against the whole speed of the step before.
  const air: AirState = { kind: c.airKind, velX: c.airVelX, velZ: c.airVelZ, travel: c.airTravel, rise: c.airRise };
  const flying = air.kind !== 0 && !rolling;
  const limits = flying ? jumpLimits(air.kind) : null;
  const riseSpent = limits !== null && air.rise! > limits.vertical;
  const speed = Math.hypot(c.velocityY, flying ? c.airVelX : 0, flying ? c.airVelZ : 0);
  let vy = c.velocityY;
  let ay = GRAVITY;
  if (takeoff) {
    // The impulse adds to the grounded -5 ft/s; no horizontal speed carries over.
    vy = stats.jumpVelocity + GROUND_HOLD_SPEED;
    air.velX = air.velZ = air.travel = air.rise = 0;
  } else if (c.grounded) {
    // On the ground the original holds a constant downward stick speed instead of
    // accumulating gravity; a small one keeps the controller glued to slopes and steps.
    vy = GROUND_STICK;
  } else {
    // Past the vertical limit the lift stops (the acceleration is reset to gravity).
    if (f & INPUT.JUMP && !riseSpent) ay += JUMP_HOLD_LIFT;
    vy += ay * dt;
  }
  if (c.velocityY > 0) {
    const k = riseSpent ? RISE_DRAG_SPENT : RISE_DRAG;
    const drag = k * vy * speed * dt;
    vy = Math.abs(drag) > Math.abs(vy) ? 0 : vy - drag;
  }

  if (flying) {
    // Jump: horizontal physics (air control, drag, distance limit) replaces ground motion.
    const yaw = dequantizeAngle(input.yaw);
    const s = Math.sin(yaw);
    const co = Math.cos(yaw);
    const spent = air.travel > limits!.horizontal;
    let along = 0;
    let side = 0;
    if (!spent && !(f & INPUT.ROOTED)) {
      // Back wins over forward, left over right (0x00492B70); forward / back jumps push on their own.
      const [keyFwd, keyRight] = movementAxes(f);
      along = (keyFwd + jumpAutoPush(air.kind)) * AIR_ACCEL;
      side = keyRight * AIR_ACCEL;
    }
    air.velX += (-s * along + co * side) * dt;
    air.velZ += (-co * along - s * side) * dt;
    const k = spent ? AIR_DRAG_SPENT : AIR_DRAG;
    const dragX = k * air.velX * speed * dt;
    const dragZ = k * air.velZ * speed * dt;
    air.velX = Math.abs(dragX) > Math.abs(air.velX) ? 0 : air.velX - dragX;
    air.velZ = Math.abs(dragZ) > Math.abs(air.velZ) ? 0 : air.velZ - dragZ;
    // Without a push, speeds under 2.5 ft/s stop.
    if (spent && Math.hypot(air.velX, air.velZ) < 2.5 * FT_M) air.velX = air.velZ = 0;
    vx = air.velX;
    vz = air.velZ;
  }

  // Standing still on the ground (no input motion, timed action or jump): nothing moves, so the
  // controller's collision query is skipped - it is most of a crowded zone's tick. The ground
  // stick would only re-confirm the contact.
  const still = c.grounded && vx === 0 && vz === 0 && !takeoff && !rolling && !air.kind && locoNext.state === 0;
  if (still && c.settled) return;

  desired.x = vx * dt;
  desired.y = vy * dt;
  desired.z = vz * dt;
  mw.controller.computeColliderMovement(c.collider, desired, undefined, CHARACTER_GROUPS);
  const moved = mw.controller.computedMovement();
  // The controller reports ground on any contact below, steep or not; only a walkable surface
  // holds the character (on a steeper one it keeps falling and slides off). Without this one
  // could stand on 70° rock and be stepped up canyon walls, out of the level.
  const grounded = mw.controller.computedGrounded() && touchesWalkable(mw);

  // Hit a ceiling while rising: stop vertical motion.
  if (desired.y > 0 && moved.y < desired.y * 0.5) vy = 0;
  if (grounded && vy < 0) vy = 0;

  // In the air, a ledge within reach pulls the character up onto it (0x004916A0 / 0x004912F0).
  const ledge = !grounded && !rolling && !(f & INPUT.JUMP) ? ledgeAhead(mw, c, moved, dequantizeAngle(input.yaw)) : null;
  if (ledge) {
    setCharacterState(c, ledge, 0, true, ACTION_MOUNT, mountTicks(rate));
    return;
  }

  let rollTicks = rolling ? c.rollTicks - 1 : 0;
  let rollDir = c.rollDir;
  // A side hop ends in a short stand before the next one can start.
  if (rolling && rollTicks === 0 && (rollDir === ACTION_HOP_LEFT || rollDir === ACTION_HOP_RIGHT)) {
    rollDir = ACTION_HOP_PAUSE;
    rollTicks = SHIELD_HOP_PAUSE_TICKS;
  }
  // A roll ending with C and a direction still held runs straight into the next one.
  const nextRoll = f & (INPUT.ROLL | INPUT.DUCK) && !(f & INPUT.ROOTED) ? rollDirection(f) : 0;
  if (rolling && rollTicks === 0 && rollDir >= 1 && rollDir <= 4 && nextRoll && grounded) {
    rollDir = nextRoll;
    rollTicks = rollLength(nextRoll, rate);
  }
  // The take-off step's motion counts towards the jump's travel already.
  if (air.kind && (!windup || takeoff)) {
    air.travel += Math.hypot(moved.x, moved.z);
    air.rise! += Math.abs(moved.y);
    // Landing ends the jump (but not on the take-off step itself). Still holding jump after a
    // vertical or forward jump plays the soft landing first (0x0042BD40: ASM_LAND_SOFT).
    if (grounded && !takeoff) {
      if (f & INPUT.JUMP && (air.kind === JUMP_V || air.kind === JUMP_F || air.kind === JUMP_RUN) && rollTicks === 0) {
        rollDir = ACTION_LAND;
        rollTicks = landSoftTicks(rate);
      }
      air.kind = 0;
    }
  }
  setCharacterState(
    c,
    { x: c.position.x + moved.x, y: c.position.y + moved.y, z: c.position.z + moved.z },
    vy,
    grounded,
    rollDir,
    rollTicks,
    air,
    air.kind ? undefined : locoNext,
  );
  c.settled = still && grounded && Math.abs(moved.x) < 0.0005 && Math.abs(moved.y) < 0.0005 && Math.abs(moved.z) < 0.0005;
}

/**
 * Whether the character should look grounded (animation): on the ground, or not jumping and
 * not yet falling fast. Stepping up a stair or over a small bump leaves the ground for a tick
 * or two; without this the run would flicker into the airborne clip on every step.
 */
export function looksGrounded(c: Character): boolean {
  return c.grounded || (c.airKind === 0 && c.velocityY > LOOKS_GROUNDED_FALL_SPEED);
}
/** Downward speed (m/s) past which a fall shows as airborne (~0.17 s of falling). */
const LOOKS_GROUNDED_FALL_SPEED = -4;

/** Cosine of the steepest surface that still counts as ground (the climb limit, with a margin for faceted floors). */
const GROUND_MIN_NORMAL_Y = Math.cos(((MAX_SLOPE_DEG + 5) * Math.PI) / 180);

/** Whether the last controller move touched a walkable surface (normal close enough to up). */
function touchesWalkable(mw: MovementWorld): boolean {
  const n = mw.controller.numComputedCollisions();
  for (let i = 0; i < n; i++) {
    const hit = mw.controller.computedCollision(i);
    if (hit && hit.normal1.y >= GROUND_MIN_NORMAL_Y) return true;
  }
  // No contact this step: the controller's own snap-to-ground decided (flat ground stands).
  return n === 0;
}

/**
 * The ledge the original's grab test (0x004912F0) finds after this step's move, as the feet
 * position to pull up to, or null. `moved` is the step's motion (the character's new feet are
 * its position plus it). Needs a wall touched this step, faced within ~37° and near vertical; the
 * point 4.5 ft up and 2.21 ft ahead open; a trace from it back down to 1.5 ft above the feet
 * meeting a walkable top more than 3 ft above them. The original lands 1.5 ft lower and lets its
 * collision lift the body out; here the capsule must fit standing on the top.
 */
function ledgeAhead(mw: MovementWorld, c: Character, moved: Readonly<Vec3>, yaw: number): Vec3 | null {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let wall = false;
  const n = mw.controller.numComputedCollisions();
  for (let i = 0; i < n && !wall; i++) {
    const hit = mw.controller.computedCollision(i);
    if (!hit || Math.abs(hit.normal1.y) > LEDGE_MAX_WALL_NORMAL_Y) continue;
    const len = Math.hypot(hit.normal1.x, hit.normal1.z);
    wall = len > 0 && (hit.normal1.x * fx + hit.normal1.z * fz) / len <= LEDGE_MAX_FACING_DOT;
  }
  if (!wall) return null;
  // The original tests every frame; a tick covers more height than the test's 1.5 ft window, so
  // it is also tried at the heights the step passed through (from the end back to the start).
  const end = c.position.y + moved.y;
  const samples = Math.max(1, Math.ceil(Math.abs(moved.y) / LEDGE_SAMPLE));
  for (let i = 0; i < samples; i++) {
    const y = end - (moved.y * i) / samples;
    const target = ledgeAt(mw, { x: c.position.x + moved.x, y, z: c.position.z + moved.z }, fx, fz);
    if (target) return target;
  }
  return null;
}
/** Height step between ledge tests within one tick, metres. */
const LEDGE_SAMPLE = 0.2;

/** The grab test at one feet position, facing (fx, fz): the feet position on the ledge, or null. */
function ledgeAt(mw: MovementWorld, feet: Readonly<Vec3>, fx: number, fz: number): Vec3 | null {
  const from = { x: feet.x + fx * LEDGE_REACH_AHEAD, y: feet.y + LEDGE_REACH_UP, z: feet.z + fz * LEDGE_REACH_AHEAD };
  if (mw.world.projectPoint(from, true, undefined, CHARACTER_GROUPS)?.isInside) return null;
  const d = { x: feet.x - from.x, y: feet.y + LEDGE_TRACE_TO - from.y, z: feet.z - from.z };
  const len = Math.hypot(d.x, d.y, d.z);
  const ray = new mw.rapier.Ray(from, { x: d.x / len, y: d.y / len, z: d.z / len });
  const hit = mw.world.castRayAndGetNormal(ray, len, true, undefined, CHARACTER_GROUPS);
  if (!hit || hit.normal.y < GROUND_MIN_NORMAL_Y) return null;
  const top = from.y + ray.dir.y * hit.timeOfImpact;
  if (top - feet.y <= LEDGE_MIN_RISE) return null;
  const target = { x: from.x, y: top, z: from.z };
  const shape = new mw.rapier.Capsule(PLAYER_HALF_SEGMENT, PLAYER_RADIUS);
  const centre = { x: target.x, y: target.y + HALF_HEIGHT + 0.01, z: target.z };
  if (mw.world.intersectionWithShape(centre, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, CHARACTER_GROUPS)) return null;
  return target;
}

/** Length in ticks of a timed action that follows a curve or holds the character (0 otherwise). */
function actionTicks(action: number, rate = 1): number {
  if (isAttackAction(action)) return attackMotionTicks(action - ACTION_ATTACK + 1, rate);
  if (isHitAction(action)) return hitReactionTicks(action, rate);
  if (action === ACTION_LUNGE) return LUNGE_TICKS;
  if (action === ACTION_MOUNT) return mountTicks(rate);
  const curve = actionCurve(action);
  return curve ? curveTicks(curve, rate) : 0;
}

/** Starts a timed action (attack motion, hit reaction, creature lunge / bash), replacing any other. */
export function startTimedAction(c: Character, action: number): void {
  // On the ground a jump can only be standing before its take-off: the action replaces it.
  if (c.grounded) c.airKind = 0;
  c.rollDir = action;
  c.rollTicks = actionTicks(action, c.clipRate);
  c.actionLength = c.rollTicks;
}

/** Starts a hit reaction (ACTION_IMPACT / ACTION_STUN / ACTION_KNOCKDOWN): it replaces any timed action. */
export function startHitReaction(c: Character, action: number): void {
  startTimedAction(c, action);
}

/**
 * Roll direction for held movement flags: 1 forward, 2 back, 3 left, 4 right, 0 none. The
 * original checks forward, back, left, right in that order (0x42AFC0): the first held one rolls.
 */
export function rollDirection(flags: number): number {
  if (flags & INPUT.FORWARD) return 1;
  if (flags & INPUT.BACK) return 2;
  if (flags & INPUT.LEFT) return 3;
  if (flags & INPUT.RIGHT) return 4;
  return 0;
}

/**
 * Jump kind for held keys, as the jump selector (0x0042BD40) picks the state: right, else left,
 * overrides forward / back; forward is the running jump, with Shift the standing forward one.
 */
export function jumpKind(flags: number): number {
  if (flags & INPUT.RIGHT) return JUMP_R;
  if (flags & INPUT.LEFT) return JUMP_L;
  const fwd = movementAxes(flags)[0];
  if (fwd > 0) return flags & INPUT.WALK ? JUMP_F : JUMP_RUN;
  if (fwd < 0) return JUMP_B;
  return JUMP_V;
}

/**
 * Held movement as the original reads the keys (0x492B70): back wins over forward, left over
 * right. Returns [forward (+1 / -1 / 0), right (+1 / -1 / 0)].
 */
export function movementAxes(flags: number): [number, number] {
  const fwd = flags & INPUT.BACK ? -1 : flags & INPUT.FORWARD ? 1 : 0;
  const right = flags & INPUT.LEFT ? -1 : flags & INPUT.RIGHT ? 1 : 0;
  return [fwd, right];
}

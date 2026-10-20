import { beforeAll, describe, expect, it } from 'vitest';
import {
  ANIM,
  DEFAULT_MOVEMENT_STATS,
  INPUT,
  ACTION_ATTACK,
  ACTION_KNOCKDOWN,
  ACTION_STUN,
  hitReactionTicks,
  startHitReaction,
  startTimedAction,
  ACTION_LUNGE,
  ACTION_BASH,
  LUNGE_TICKS,
  ATTACK_CURVES,
  INPUT_ATTACK_SHIFT,
  attackMotion,
  attackMotionTicks,
  ACTION_HOP_LEFT,
  ACTION_HOP_PAUSE,
  ACTION_HOP_RIGHT,
  SHIELD_HOP_PAUSE_TICKS,
  shieldHopTicks,
  advanceLoco,
  rollTicks,
  attackTiming,
  ENGINE_CLIP_FPS,
  LOCO_RUN,
  LOCO_WALK,
  LOCO_RETREAT,
  LOCO_SIDE_LEFT,
  LOCO_SIDE_RIGHT,
  LOCO_CAREFUL_LEFT,
  LOCO_CAREFUL_RIGHT,
  LOCO_HOP_LEFT,
  LOCO_HOP_RIGHT,
  movementAnim,
  ROLLS,
  attackKindFor,
  movementFacingOffset,
  PLAYER_RADIUS,
  TICK_DT,
  createCharacter,
  pushCharacter,
  PLAYER_HEIGHT,
  PLAYER_HALF_SEGMENT,
  createMovementWorld,
  createSyntheticArena,
  initPhysics,
  quantizeAngle,
  setCharacterState,
  stepCharacter,
  type Character,
  type InputFrame,
  type MovementWorld,
  type Rapier,
  ACTION_LAND,
  ACTION_MOUNT,
  mountTicks,
  JUMP_B,
  JUMP_F,
  JUMP_L,
  JUMP_R,
  JUMP_RUN,
  JUMP_V,
  jumpTakeoffTicks,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const arena = createSyntheticArena();

function setup(spawn = { x: 0, y: 0.5, z: 0 }): { mw: MovementWorld; c: Character } {
  const mw = createMovementWorld(rapier, arena);
  return { mw, c: createCharacter(mw, spawn) };
}

function run(mw: MovementWorld, c: Character, flags: number, yaw: number, ticks: number, startTick = 0, stats = DEFAULT_MOVEMENT_STATS) {
  const input: InputFrame = { clientTick: 0, flags, yaw: quantizeAngle(yaw), pitch: 0 };
  for (let i = 0; i < ticks; i++) {
    input.clientTick = startTick + i;
    stepCharacter(mw, c, input, stats, TICK_DT);
  }
}
const DIAGONAL_STATS = { ...DEFAULT_MOVEMENT_STATS, diagonalMoves: true };
/** Root path (feet) of a locomotion clip over `ticks` from its first frame. */
function clipFeet(state: number, ticks: number): number {
  let frame = 0;
  let feet = 0;
  for (let i = 0; i < ticks; i++) {
    const [next, d] = advanceLoco(state, frame, TICK_DT);
    frame = Math.round(next * 4) / 4;
    feet += d;
  }
  return feet;
}

describe('shared character controller', () => {
  it('falls onto the floor and becomes grounded', () => {
    const { mw, c } = setup({ x: 0, y: 3, z: 0 });
    run(mw, c, 0, 0, 40);
    expect(c.grounded).toBe(true);
    expect(c.position.y).toBeCloseTo(0, 1);
    expect(c.velocityY).toBe(0);
  });

  it('runs at run speed in open space (yaw 0 = -Z)', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10); // settle
    const z0 = c.position.z;
    run(mw, c, INPUT.FORWARD, 0, 20); // 1 second
    expect(z0 - c.position.z).toBeCloseTo(DEFAULT_MOVEMENT_STATS.runSpeed, 0);
    expect(Math.abs(c.position.x)).toBeLessThan(0.02);
  });

  it('moves by the state clip root path, applied to each held key axis (0x427600)', () => {
    const cases: [number, number, number, number][] = [
      // flags, state, expected sideways sign, expected forward sign
      [INPUT.FORWARD, LOCO_RUN, 0, 1],
      [INPUT.BACK, LOCO_RETREAT, 0, -1],
      [INPUT.FORWARD | INPUT.WALK, LOCO_WALK, 0, 1],
      [INPUT.LEFT, LOCO_SIDE_LEFT, -1, 0],
      [INPUT.RIGHT, LOCO_SIDE_RIGHT, 1, 0],
      [INPUT.LEFT | INPUT.WALK, LOCO_CAREFUL_LEFT, -1, 0],
      [INPUT.RIGHT | INPUT.WALK, LOCO_CAREFUL_RIGHT, 1, 0],
    ];
    for (const [flags, state, sx, sf] of cases) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, flags, 0, 20);
      const feet = clipFeet(state, 20);
      // yaw 0: right = +X, forward = -Z
      expect(c.position.x - start.x).toBeCloseTo(sx * feet * 0.3048, 1);
      expect(start.z - c.position.z).toBeCloseTo(sf * feet * 0.3048, 1);
      expect(c.locoState).toBe(state);
    }
    // Per loop: run 13.0 ft / 25 frames (17.3 ft/s), sidesteps 7.32 / 7.77 ft / 22 frames.
    expect(clipFeet(LOCO_RUN, 15) / 0.75).toBeCloseTo(17.3, 0);
  });

  it('a diagonal is the sidestep at 45 degrees: the sidestep speed on both axes', () => {
    for (const [fwd, sf] of [[INPUT.FORWARD, 1], [INPUT.BACK, -1]] as const) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, fwd | INPUT.RIGHT, 0, 20);
      const feet = clipFeet(LOCO_SIDE_RIGHT, 20) * 0.3048;
      expect(c.position.x - start.x).toBeCloseTo(feet, 1);
      expect(start.z - c.position.z).toBeCloseTo(sf * feet, 1);
      expect(movementAnim(fwd | INPUT.RIGHT, true, 0)).toBe(ANIM.STRAFE_RIGHT);
      expect(movementFacingOffset(fwd | INPUT.RIGHT)).toBe(0); // the body keeps the view heading
    }
    // Back wins over forward, left over right.
    expect(movementAnim(INPUT.FORWARD | INPUT.BACK, true, 0)).toBe(ANIM.RETREAT);
    expect(movementAnim(INPUT.LEFT | INPUT.RIGHT, true, 0)).toBe(ANIM.STRAFE_LEFT);
  });

  it('clips play at the character speed multiplier (34 fps logged at level 2)', () => {
    const fast = { ...DEFAULT_MOVEMENT_STATS, clipRate: 1.02 };
    const a = setup();
    const b = setup();
    run(a.mw, a.c, 0, 0, 10);
    run(b.mw, b.c, 0, 0, 10, 0, fast);
    const za = a.c.position.z;
    const zb = b.c.position.z;
    run(a.mw, a.c, INPUT.FORWARD, 0, 15);
    run(b.mw, b.c, INPUT.FORWARD, 0, 15, 0, fast);
    expect((zb - b.c.position.z) / (za - a.c.position.z)).toBeCloseTo(1.02, 1);
  });

  it('swings, rolls and timed actions play at the clip rate too', () => {
    const total = (s: { startup: number; active: number; recovery: number }) => s.startup + s.active + s.recovery;
    expect(total(attackTiming('normal', 5, 1, 1.25))).toBeLessThan(total(attackTiming('normal', 5, 1, 1)));
    expect(total(attackTiming('left', 1, 2, 1))).toBe(total(attackTiming('left', 1, 1, 1))); // layer: not the weapon's speed
    expect(total(attackTiming('left', 1, 1, 1.25))).toBeLessThan(total(attackTiming('left', 1, 1, 1)));
    expect(rollTicks(3, 1.25)).toBeLessThan(rollTicks(3, 1));
    expect(hitReactionTicks(ACTION_KNOCKDOWN, 1.25)).toBeLessThan(hitReactionTicks(ACTION_KNOCKDOWN, 1));
  });

  it('switching sides restarts the step clip from its first frame', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    run(mw, c, INPUT.LEFT | INPUT.BACK, 0, 7);
    expect(c.locoState).toBe(LOCO_SIDE_LEFT);
    expect(c.locoFrame).toBeGreaterThan(10);
    run(mw, c, INPUT.RIGHT | INPUT.BACK, 0, 1);
    expect(c.locoState).toBe(LOCO_SIDE_RIGHT);
    expect(Math.abs(c.locoFrame - ENGINE_CLIP_FPS * TICK_DT)).toBeLessThanOrEqual(0.125); // one tick in, quarter frames
  });

  it('feature diagonalMoves (not original): diagonals run along the diagonal, body turned', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    // Short run: on the box arena Rapier's controller can snag after ~0.4 m at some speeds (the
    // feet sink a few mm into the floor box); not what this test is about.
    run(mw, c, INPUT.FORWARD | INPUT.RIGHT, 0, 2, 0, DIAGONAL_STATS);
    expect(Math.hypot(c.position.x - start.x, c.position.z - start.z)).toBeCloseTo(DEFAULT_MOVEMENT_STATS.runSpeed * 2 * TICK_DT, 1);
    expect(c.position.x - start.x).toBeCloseTo(start.z - c.position.z, 1); // 45° to the right
    expect(movementFacingOffset(INPUT.FORWARD | INPUT.RIGHT, true)).toBeCloseTo(-Math.PI / 4);
    expect(movementFacingOffset(INPUT.BACK | INPUT.RIGHT, true)).toBeCloseTo(Math.PI / 4);
    expect(movementAnim(INPUT.FORWARD | INPUT.RIGHT, true, 0, true)).toBe(ANIM.RUN);
  });

  it('plants the feet while the own swing plays (INPUT.ROOTED)', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    run(mw, c, INPUT.FORWARD | INPUT.ROOTED, 0, 10);
    expect(Math.hypot(c.position.x - start.x, c.position.z - start.z)).toBeLessThan(1e-3);
  });

  it('rolls the original distance in the held direction, then stops (C + direction)', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    run(mw, c, INPUT.FORWARD | INPUT.ROLL, 0, 1);
    expect(c.rollDir).toBe(1);
    run(mw, c, 0, 0, ROLLS[0]!.ticks + 5); // keys released: the roll still runs its length
    expect(c.rollDir).toBe(0);
    expect(start.z - c.position.z).toBeCloseTo(10.73 * 0.3048, 1);
  });

  it('rolls back to back while C and a direction stay held (the selector asks every frame)', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    // C pressed first, then the direction: rolls all the same.
    run(mw, c, INPUT.DUCK, 0, 3);
    for (let i = 0; i < ROLLS[0]!.ticks * 2; i++) {
      run(mw, c, INPUT.DUCK | INPUT.FORWARD, 0, 1);
      expect(c.rollDir).toBe(1);
    }
    expect(start.z - c.position.z).toBeCloseTo(2 * 10.73 * 0.3048, 1);
  });

  it('attacks whose clip moves the root carry the character forward by that distance', () => {
    // Combo step 1 (PN25, +3.85 ft) and the jump attack (PN05, +6.26 ft); the feet stay planted otherwise.
    for (const [kind, combo, feet] of [['normal', 1, 3.85], ['normal', 3, 3.43], ['normal', 5, 2.16], ['jump', 1, 6.26]] as const) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      const motion = attackMotion(kind, combo);
      expect(ATTACK_CURVES[motion - 1]!.at(-1)).toBe(feet);
      run(mw, c, INPUT.ROOTED | (motion << INPUT_ATTACK_SHIFT), 0, 1);
      expect(c.rollDir).toBe(ACTION_ATTACK + motion - 1);
      run(mw, c, INPUT.ROOTED, 0, attackMotionTicks(motion) + 5);
      expect(c.rollDir).toBe(0);
      expect(start.z - c.position.z).toBeCloseTo(feet * 0.3048, 1);
    }
    // Swings that sway and come back (combo step 2, side swings) do not move the character.
    expect(attackMotion('normal', 2)).toBe(0);
    expect(attackMotion('left', 1)).toBe(0);
  });

  it('hit reactions hold the character; a knock-down throws it back 5.36 ft (PI02)', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    startHitReaction(c, ACTION_STUN);
    // Neither movement keys nor an attack's root motion act during the reaction.
    run(mw, c, INPUT.FORWARD | (1 << INPUT_ATTACK_SHIFT), 0, hitReactionTicks(ACTION_STUN) - 1);
    expect(Math.hypot(c.position.x - start.x, c.position.z - start.z)).toBeLessThan(1e-3);
    expect(c.rollDir).toBe(ACTION_STUN);
    run(mw, c, 0, 0, 2);
    expect(c.rollDir).toBe(0);
    startHitReaction(c, ACTION_KNOCKDOWN);
    run(mw, c, INPUT.FORWARD, 0, hitReactionTicks(ACTION_KNOCKDOWN));
    expect(c.rollDir).toBe(0);
    expect(c.position.z - start.z).toBeCloseTo(5.36 * 0.3048, 1); // yaw 0 faces -Z: thrown towards +Z
  });

  it('shield + jump is the shield rush: PL01 carries Drake ~5.2 ft forward, no jump', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    run(mw, c, INPUT.BLOCK | INPUT.JUMP, 0, 1);
    expect(c.rollDir).toBe(ACTION_BASH);
    run(mw, c, INPUT.BLOCK, 0, 20);
    expect(c.rollDir).toBe(0);
    expect(c.position.y).toBeCloseTo(start.y, 2);
    expect(start.z - c.position.z).toBeCloseTo(5.18 * 0.3048, 1);
    expect(movementAnim(INPUT.BLOCK, true, ACTION_BASH)).toBe(ANIM.ATTACK_BASH);
  });

  it("a creature's lunge follows PC07: still at first, then 5.65 ft, then still until it ends", () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    startTimedAction(c, ACTION_LUNGE);
    run(mw, c, 0, 0, 2);
    expect(Math.abs(c.position.z - start.z)).toBeLessThan(0.01); // wind-up (frames 0-4)
    run(mw, c, 0, 0, LUNGE_TICKS - 2);
    expect(c.rollDir).toBe(0);
    expect(start.z - c.position.z).toBeCloseTo(5.65 * 0.3048, 1);
  });

  it('replays a roll exactly from a mid-roll snapshot (reconciliation)', () => {
    const a = setup();
    run(a.mw, a.c, 0, 0, 10);
    run(a.mw, a.c, INPUT.LEFT | INPUT.ROLL, 0, 1);
    run(a.mw, a.c, INPUT.LEFT, 0, 4);
    const snap = { pos: { ...a.c.position }, vy: a.c.velocityY, g: a.c.grounded, dir: a.c.rollDir, ticks: a.c.rollTicks };
    run(a.mw, a.c, INPUT.LEFT, 0, 8);
    const b = setup();
    setCharacterState(b.c, snap.pos, snap.vy, snap.g, snap.dir, snap.ticks);
    run(b.mw, b.c, INPUT.LEFT, 0, 8);
    expect(b.c.position).toEqual(a.c.position);
  });

  it('ducks in place while C is held alone', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    run(mw, c, INPUT.DUCK, 0, 10);
    expect(Math.hypot(c.position.x - start.x, c.position.z - start.z)).toBeLessThan(1e-3);
    expect(c.rollDir).toBe(0);
  });

  it('jumps carry no run speed; held directions push in the air (original air control)', () => {
    // Reference distances from the original's physics (0x00492B70 / 0x004923E0: drag against the
    // whole 3-D speed, travel limits per jump kind) stepped at 30 fps: running jump (forward
    // held) 19.7 ft, Shift + forward 16.2 ft, side jump 9.9 ft (12.0 with forward held too: a side
    // key picks the side jump, the forward key still pushes), back 14.6 ft, standing 0.
    const jumpDistance = (flags: number, kind: number) => {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, flags | INPUT.JUMP, 0, 1);
      expect(c.airKind).toBe(kind);
      for (let i = 0; i < 40 && !(c.grounded && c.airKind === 0); i++) run(mw, c, flags, 0, 1);
      return Math.hypot(c.position.x - start.x, c.position.z - start.z) / 0.3048;
    };
    for (const [flags, kind, feet] of [[INPUT.FORWARD, JUMP_RUN, 19.7], [INPUT.FORWARD | INPUT.WALK, JUMP_F, 16.2], [INPUT.RIGHT, JUMP_R, 9.9], [INPUT.FORWARD | INPUT.LEFT, JUMP_L, 12.0], [INPUT.BACK, JUMP_B, 14.6]] as const) {
      const d = jumpDistance(flags, kind);
      expect(d).toBeGreaterThan(feet * 0.93);
      expect(d).toBeLessThan(feet * 1.07);
    }
    expect(jumpDistance(0, JUMP_V)).toBeLessThan(0.05);
  });

  it('stands until the jump clip leaves the ground, rooted, and lands soft with jump held', () => {
    for (const [flags, kind, frame] of [[0, JUMP_V, 10], [INPUT.FORWARD, JUMP_RUN, 6], [INPUT.BACK, JUMP_B, 12]] as const) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      let leftAt = -1;
      for (let i = 0; i < 20 && leftAt < 0; i++) {
        run(mw, c, flags | INPUT.JUMP, 0, 1);
        if (!c.grounded) leftAt = i;
        else expect(Math.hypot(c.position.x - start.x, c.position.z - start.z)).toBeLessThan(1e-3);
      }
      // The JUMP LEAVEGROUND event's frame at 1000/30 fps.
      expect(leftAt).toBe(jumpTakeoffTicks(kind));
      expect(Math.round((frame / (1000 / 30)) * 20)).toBe(leftAt);
      for (let i = 0; i < 40 && !c.grounded; i++) run(mw, c, flags | INPUT.JUMP, 0, 1);
      expect(c.rollDir).toBe(kind === JUMP_B ? 0 : ACTION_LAND);
    }
  });

  it('catches a ledge in the air and pulls up onto it (ASM_LOW_MOUNT, 0x004912F0)', () => {
    // A 4 m (13.1 ft) pillar, its face just ahead (yaw 0 faces -Z): a standing jump, pushing
    // forward against the face once in the air, catches its top on the way up.
    const { mw, c } = setup({ x: -8, y: 0.5, z: -6.8 });
    run(mw, c, 0, 0, 10);
    for (let i = 0; i < 20 && c.grounded; i++) run(mw, c, INPUT.JUMP, 0, 1);
    expect(c.grounded).toBe(false);
    let mountedAt = -1;
    for (let i = 0; i < 40 && mountedAt < 0; i++) {
      run(mw, c, INPUT.FORWARD, 0, 1);
      if (c.rollDir === ACTION_MOUNT) mountedAt = i;
    }
    expect(mountedAt).toBeGreaterThanOrEqual(0);
    // On the top at once, 2.21 ft past the feet against the face; it stands there for the clip.
    expect(c.position.y).toBeCloseTo(4, 2);
    expect(c.position.z).toBeCloseTo(-6.85 - 2.21 * 0.3048, 1);
    expect(movementAnim(INPUT.FORWARD, c.grounded, c.rollDir)).toBe(ANIM.MOUNT_LOW);
    const at = { ...c.position };
    run(mw, c, INPUT.FORWARD, 0, mountTicks() - 1);
    expect(c.rollDir).toBe(ACTION_MOUNT);
    expect(Math.hypot(c.position.x - at.x, c.position.z - at.z)).toBeLessThan(1e-3);
    run(mw, c, 0, 0, 2);
    expect(c.rollTicks).toBe(0);
    expect(c.grounded).toBe(true);
    expect(c.position.y).toBeCloseTo(4, 1);
  });

  it('mounts a 3-4.5 ft ledge walked into on the ground, not a taller one (0x004912F0 grounded)', () => {
    // A 1.1 m (3.6 ft) block whose face is 2.5 m ahead (yaw 0 faces -Z).
    const block = createMovementWorld(rapier, { ...arena, boxes: [...arena.boxes, { kind: 'platform', x: 0, y: 0.55, z: -3, hx: 1, hy: 0.55, hz: 0.5 }] });
    const c = createCharacter(block, { x: 0, y: 0.5, z: 0 });
    run(block, c, 0, 0, 10);
    let mountedAt = -1;
    for (let i = 0; i < 40 && mountedAt < 0; i++) {
      run(block, c, INPUT.FORWARD, 0, 1);
      if (c.rollDir === ACTION_MOUNT) mountedAt = i;
    }
    expect(mountedAt).toBeGreaterThanOrEqual(0);
    expect(c.position.y).toBeCloseTo(1.1, 2);
    expect(c.position.z).toBeLessThan(-2.5);
    // The 4 m pillar: 4.5 ft up is inside it, so walking into it only stops.
    const { mw, c: p } = setup({ x: -8, y: 0.5, z: -6.8 });
    run(mw, p, 0, 0, 10);
    for (let i = 0; i < 30; i++) {
      run(mw, p, INPUT.FORWARD, 0, 1);
      expect(p.rollDir).not.toBe(ACTION_MOUNT);
    }
  });

  it('does not catch a ledge more than 2 ft below the top of the fall (+0x144)', () => {
    // Dropped from 7 m beside the 4 m pillar's face: crossing its top it has fallen 3 m.
    const { mw, c } = setup({ x: -8, y: 7, z: -6.8 });
    for (let i = 0; i < 40 && !c.grounded; i++) {
      run(mw, c, INPUT.FORWARD, 0, 1);
      expect(c.rollDir).not.toBe(ACTION_MOUNT);
    }
    expect(c.position.y).toBeLessThan(0.1);
  });

  it('does not mount a prop: the test sees only the level (the BSP)', () => {
    const points = new Float32Array([-1, 0, -3.5, 1, 0, -3.5, -1, 0, -2.5, 1, 0, -2.5, -1, 1.1, -3.5, 1, 1.1, -3.5, -1, 1.1, -2.5, 1, 1.1, -2.5]);
    const crate = createMovementWorld(rapier, { ...arena, solids: [...(arena.solids ?? []), { points }] });
    const c = createCharacter(crate, { x: 0, y: 0.5, z: 0 });
    run(crate, c, 0, 0, 10);
    for (let i = 0; i < 40; i++) {
      run(crate, c, INPUT.FORWARD, 0, 1);
      expect(c.rollDir).not.toBe(ACTION_MOUNT);
    }
    expect(c.position.y).toBeLessThan(0.1);
  });

  it('gives creatures no ledge grab (only Drake runs the test)', () => {
    const block = createMovementWorld(rapier, { ...arena, boxes: [...arena.boxes, { kind: 'platform', x: 0, y: 0.55, z: -3, hx: 1, hy: 0.55, hz: 0.5 }] });
    const c = createCharacter(block, { x: 0, y: 0.5, z: 0 });
    const stats = { ...DEFAULT_MOVEMENT_STATS, noLedgeGrab: true };
    run(block, c, 0, 0, 10, 0, stats);
    run(block, c, INPUT.FORWARD, 0, 40, 10, stats);
    expect(c.rollDir).not.toBe(ACTION_MOUNT);
    expect(c.position.y).toBeLessThan(0.1);
  });

  it('pushes a character up a slope with the height the move climbs (a fire ball knock-back)', () => {
    // Up the ramp (z 3..9, rising 1.5 m toward +Z): a 15 ft knock-back must lift the body with
    // it. Keeping the old height buried the capsule in the slope, and a buried capsule can fall
    // through the level.
    const { mw, c } = setup({ x: 12, y: 0.3, z: 3.5 });
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    const moved = pushCharacter(mw, c, 0, 15 * 0.3048);
    expect(moved.z).toBeGreaterThan(4);
    expect(c.position.y - start.y).toBeGreaterThan(0.9);
    const body = new rapier.Capsule(PLAYER_HALF_SEGMENT - 0.05, PLAYER_RADIUS - 0.05);
    const centre = { x: c.position.x, y: c.position.y + PLAYER_HEIGHT / 2, z: c.position.z };
    expect(mw.world.intersectionWithShape(centre, { x: 0, y: 0, z: 0, w: 1 }, body, undefined, undefined, c.collider)).toBeNull();
    run(mw, c, 0, 0, 20);
    expect(c.grounded).toBe(true);
    expect(c.position.y - start.y).toBeGreaterThan(0.9);
  });

  it('does not catch a ledge while jump is held', () => {
    const { mw, c } = setup({ x: -8, y: 0.5, z: -6.8 });
    run(mw, c, 0, 0, 10);
    for (let i = 0; i < 60; i++) {
      run(mw, c, INPUT.JUMP | (c.grounded ? 0 : INPUT.FORWARD), 0, 1);
      expect(c.rollDir).not.toBe(ACTION_MOUNT);
    }
  });

  it('moves like the original with the shield up: walk, retreat, looping side hops', () => {
    for (const [flags, state, sf] of [[INPUT.BLOCK | INPUT.FORWARD, LOCO_WALK, 1], [INPUT.BLOCK | INPUT.BACK, LOCO_RETREAT, -1]] as const) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, flags, 0, 20);
      expect(start.z - c.position.z).toBeCloseTo(sf * clipFeet(state, 20) * 0.3048, 1);
    }
    // Sideways (a diagonal too): the hop clip (PB04 / PB05) loops every 33 frames - the step,
    // then still until it restarts.
    for (const [flags, state, sx] of [[INPUT.BLOCK | INPUT.LEFT, LOCO_HOP_LEFT, -1], [INPUT.BLOCK | INPUT.RIGHT, LOCO_HOP_RIGHT, 1]] as const) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, flags, 0, 13); // the step: frames 0-21
      expect(c.position.x - start.x).toBeCloseTo(sx * clipFeet(state, 13) * 0.3048, 1);
      const mid = { ...c.position };
      run(mw, c, flags, 0, 5); // still: frames 21-33
      expect(Math.abs(c.position.x - mid.x)).toBeLessThan(0.02);
      expect(movementAnim(flags, true, 0)).toBe(sx < 0 ? ANIM.HOP_LEFT : ANIM.HOP_RIGHT);
    }
    {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, INPUT.BLOCK | INPUT.FORWARD | INPUT.RIGHT, 0, 13);
      const feet = clipFeet(LOCO_HOP_RIGHT, 13) * 0.3048;
      expect(c.position.x - start.x).toBeCloseTo(feet, 1);
      expect(start.z - c.position.z).toBeCloseTo(feet, 1); // 45 degrees
      expect(movementAnim(INPUT.BLOCK | INPUT.FORWARD | INPUT.RIGHT, true, 0)).toBe(ANIM.HOP_RIGHT);
    }
    // Feature diagonalMoves (not original): discrete timed hops along the diagonal.
    for (const [flags, sx, sz] of [[INPUT.BLOCK | INPUT.FORWARD | INPUT.RIGHT, 1, -1], [INPUT.BLOCK | INPUT.BACK | INPUT.LEFT, -1, 1]] as const) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, flags, 0, shieldHopTicks(flags & INPUT.LEFT ? ACTION_HOP_LEFT : ACTION_HOP_RIGHT), 0, DIAGONAL_STATS);
      const dx = c.position.x - start.x;
      const dz = c.position.z - start.z;
      expect(Math.sign(dx)).toBe(sx);
      expect(Math.sign(dz)).toBe(sz);
      expect(Math.abs(Math.abs(dx) - Math.abs(dz))).toBeLessThan(0.02);
    }
    expect(movementAnim(INPUT.BLOCK | INPUT.LEFT, true, ACTION_HOP_PAUSE, true)).toBe(ANIM.SHIELD_IDLE);
    expect(movementAnim(INPUT.BLOCK, true, 0)).toBe(ANIM.SHIELD_IDLE);
  });

  it('picks the attack from the movement key held with the click', () => {
    expect(attackKindFor(0)).toBe('normal');
    expect(attackKindFor(INPUT.FORWARD | INPUT.LEFT)).toBe('jump');
    expect(attackKindFor(INPUT.LEFT)).toBe('left');
    expect(attackKindFor(INPUT.RIGHT)).toBe('right');
    expect(attackKindFor(INPUT.BACK)).toBe('normal');
    expect(attackKindFor(INPUT.DUCK)).toBe('normal');
    expect(attackKindFor(INPUT.JUMP)).toBe('jump');
  });

  it('is stopped by the perimeter wall', () => {
    const { mw, c } = setup();
    run(mw, c, INPUT.RIGHT, 0, 200); // 10 s towards +X
    expect(c.position.x).toBeLessThanOrEqual(20 - PLAYER_RADIUS + 0.05);
    expect(c.position.x).toBeGreaterThan(19);
  });

  it('is stopped by a pillar', () => {
    const { mw, c } = setup({ x: -8, y: 0.5, z: -3 });
    run(mw, c, INPUT.FORWARD, 0, 60); // towards -Z, pillar at z=-8 with half extent 0.75
    expect(c.position.z).toBeGreaterThan(-8 + 0.75 + PLAYER_RADIUS - 0.05);
  });

  it('climbs the ramp onto the platform', () => {
    const { mw, c } = setup({ x: 12, y: 0.5, z: 1 });
    run(mw, c, 0, 0, 10);
    run(mw, c, INPUT.FORWARD, Math.PI, 40); // yaw π faces +Z
    expect(c.position.z).toBeGreaterThan(9.5);
    expect(c.position.y).toBeCloseTo(1.5, 1);
    expect(c.grounded).toBe(true);
  });

  it('jumps as high as the original (~13 ft, ~1.15 s in the air) and lands', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    let peak = 0;
    const input: InputFrame = { clientTick: 0, flags: INPUT.JUMP, yaw: 0, pitch: 0 };
    stepCharacter(mw, c, input, DEFAULT_MOVEMENT_STATS, TICK_DT);
    input.flags = 0;
    let airTicks = 1;
    for (let i = 0; i < 60; i++) {
      stepCharacter(mw, c, input, DEFAULT_MOVEMENT_STATS, TICK_DT);
      peak = Math.max(peak, c.position.y);
      if (!c.grounded) airTicks++;
    }
    // Reference: the original's integrator stepped at 20 Hz gives 12.95 ft and 1.15 s.
    expect(peak / 0.3048).toBeGreaterThan(12.95 * 0.92);
    expect(peak / 0.3048).toBeLessThan(12.95 * 1.08);
    expect(airTicks / 20).toBeGreaterThan(1.0);
    expect(airTicks / 20).toBeLessThan(1.3);
    expect(c.grounded).toBe(true);
    expect(c.position.y).toBeCloseTo(0, 1);
  });
});

describe('determinism & reconciliation', () => {
  function scriptedInputs(n: number): InputFrame[] {
    let s = 12345;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const out: InputFrame[] = [];
    let flags = 0;
    let yaw = 0;
    for (let i = 0; i < n; i++) {
      if (i % 15 === 0) flags = Math.floor(r() * 64);
      yaw = (yaw + Math.floor(r() * 2000)) & 0xffff;
      out.push({ clientTick: i, flags, yaw, pitch: 0 });
    }
    return out;
  }

  it('two independent worlds produce identical trajectories over 10,000 ticks', () => {
    const inputs = scriptedInputs(10_000);
    const a = setup();
    const b = setup();
    for (const inp of inputs) {
      stepCharacter(a.mw, a.c, inp, DEFAULT_MOVEMENT_STATS, TICK_DT);
      stepCharacter(b.mw, b.c, inp, DEFAULT_MOVEMENT_STATS, TICK_DT);
    }
    expect(a.c.position).toEqual(b.c.position);
    expect(a.c.velocityY).toBe(b.c.velocityY);
  });

  it('reset-to-snapshot + replay reproduces the authoritative result exactly', () => {
    const inputs = scriptedInputs(600);
    const server = setup();
    const client = setup();
    // Server runs everything; snapshot taken at tick 400.
    // The snapshot carries the full movement state (position, vertical speed, roll, jump).
    const take = (c: typeof server.c) => ({
      pos: { ...c.position }, vy: c.velocityY, grounded: c.grounded, rollDir: c.rollDir, rollTicks: c.rollTicks,
      air: { kind: c.airKind, velX: c.airVelX, velZ: c.airVelZ, travel: c.airTravel, rise: c.airRise },
    });
    let snap = take(server.c);
    inputs.forEach((inp, i) => {
      stepCharacter(server.mw, server.c, inp, DEFAULT_MOVEMENT_STATS, TICK_DT);
      if (i === 400) snap = take(server.c);
    });
    // Client was mispredicting, then receives the tick-400 snapshot and replays 401..599.
    run(client.mw, client.c, INPUT.FORWARD, 1, 300);
    setCharacterState(client.c, snap.pos, snap.vy, snap.grounded, snap.rollDir, snap.rollTicks, snap.air);
    for (const inp of inputs.slice(401)) stepCharacter(client.mw, client.c, inp, DEFAULT_MOVEMENT_STATS, TICK_DT);
    expect(client.c.position).toEqual(server.c.position);
  });
});

describe('regression: controller never sticks on flat ground', () => {
  // Rapier 0.20/0.21 KCC stuck capsules at ~1/3 of positions on a flat cuboid; pinned to 0.19.3.
  it('runs freely from 61 start positions across the arena', () => {
    const mw = createMovementWorld(rapier, arena);
    const stuck: number[] = [];
    for (let x = -15; x <= 15; x += 0.5) {
      if (Math.abs(Math.abs(x) - 8) < 1.3) continue; // pillar lanes
      const c = createCharacter(mw, { x, y: 0.05, z: 3 });
      run(mw, c, INPUT.FORWARD, 0, 60);
      if (c.position.z > -8.5) stuck.push(x);
    }
    expect(stuck).toEqual([]);
  });
});

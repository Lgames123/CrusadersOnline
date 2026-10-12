import { beforeAll, describe, expect, it } from 'vitest';
import {
  ANIM,
  DEFAULT_MOVEMENT_STATS,
  INPUT,
  ACTION_HOP_LEFT,
  ACTION_HOP_PAUSE,
  ACTION_HOP_RIGHT,
  SHIELD_HOP_PAUSE_TICKS,
  SHIELD_HOP_TICKS,
  movementAnim,
  ROLLS,
  attackKindFor,
  movementFacingOffset,
  PLAYER_RADIUS,
  TICK_DT,
  createCharacter,
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

function run(mw: MovementWorld, c: Character, flags: number, yaw: number, ticks: number, startTick = 0) {
  const input: InputFrame = { clientTick: 0, flags, yaw: quantizeAngle(yaw), pitch: 0 };
  for (let i = 0; i < ticks; i++) {
    input.clientTick = startTick + i;
    stepCharacter(mw, c, input, DEFAULT_MOVEMENT_STATS, TICK_DT);
  }
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

  it('uses the original per-direction speeds (retreat, sidestep, careful walk)', () => {
    const cases: [number, number][] = [
      [INPUT.BACK, DEFAULT_MOVEMENT_STATS.backSpeed],
      [INPUT.LEFT, DEFAULT_MOVEMENT_STATS.strafeSpeed],
      [INPUT.FORWARD | INPUT.WALK, DEFAULT_MOVEMENT_STATS.walkSpeed],
      [INPUT.RIGHT | INPUT.WALK, DEFAULT_MOVEMENT_STATS.walkStrafeSpeed],
    ];
    for (const [flags, speed] of cases) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, flags, 0, 20);
      expect(Math.hypot(c.position.x - start.x, c.position.z - start.z)).toBeCloseTo(speed, 1);
    }
    // Running is about four times faster than retreating, as in the original.
    expect(DEFAULT_MOVEMENT_STATS.runSpeed / DEFAULT_MOVEMENT_STATS.backSpeed).toBeCloseTo(4, 0);
  });

  it('does not move faster diagonally', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    run(mw, c, INPUT.FORWARD | INPUT.LEFT, 0, 20);
    const d = Math.hypot(c.position.x - start.x, c.position.z - start.z);
    expect(d).toBeLessThanOrEqual(DEFAULT_MOVEMENT_STATS.runSpeed + 0.02);
  });

  it('runs diagonals at the run speed with the body turned into the motion', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    run(mw, c, INPUT.FORWARD | INPUT.RIGHT, 0, 20);
    expect(Math.hypot(c.position.x - start.x, c.position.z - start.z)).toBeCloseTo(DEFAULT_MOVEMENT_STATS.runSpeed, 1);
    expect(c.position.x - start.x).toBeCloseTo(start.z - c.position.z, 1); // 45° to the right
    expect(movementFacingOffset(INPUT.FORWARD | INPUT.RIGHT)).toBeCloseTo(-Math.PI / 4);
    expect(movementFacingOffset(INPUT.BACK | INPUT.RIGHT)).toBeCloseTo(Math.PI / 4); // faces away from the motion
    expect(movementFacingOffset(INPUT.LEFT)).toBe(0);
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

  it('ducks in place while C is held', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    const start = { ...c.position };
    run(mw, c, INPUT.FORWARD | INPUT.DUCK, 0, 10);
    expect(Math.hypot(c.position.x - start.x, c.position.z - start.z)).toBeLessThan(1e-3);
  });

  it('jumps carry no run speed; held directions push in the air (original air control)', () => {
    // Reference distances from the original's rules stepped at 20 Hz (executable-analysis §13):
    // running jump (forward held) 25.3 ft, side jump 13.9 ft, standing jump 0.
    const jumpDistance = (flags: number) => {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, flags | INPUT.JUMP, 0, 1);
      expect(c.airKind).toBeGreaterThan(0);
      for (let i = 0; i < 40 && !(c.grounded && c.airKind === 0); i++) run(mw, c, flags, 0, 1);
      return Math.hypot(c.position.x - start.x, c.position.z - start.z) / 0.3048;
    };
    const running = jumpDistance(INPUT.FORWARD);
    expect(running).toBeGreaterThan(25.3 * 0.85);
    expect(running).toBeLessThan(25.3 * 1.15);
    const side = jumpDistance(INPUT.RIGHT);
    expect(side).toBeGreaterThan(13.9 * 0.85);
    expect(side).toBeLessThan(13.9 * 1.15);
    expect(jumpDistance(0)).toBeLessThan(0.05);
  });

  it('moves like the original with the shield up: walk, retreat, side hops', () => {
    const cases: [number, number][] = [
      [INPUT.BLOCK | INPUT.FORWARD, DEFAULT_MOVEMENT_STATS.walkSpeed],
      [INPUT.BLOCK | INPUT.BACK, DEFAULT_MOVEMENT_STATS.walkBackSpeed],
    ];
    for (const [flags, speed] of cases) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, flags, 0, 20);
      expect(Math.hypot(c.position.x - start.x, c.position.z - start.z)).toBeCloseTo(speed, 1);
    }
    // Sideways: one discrete hop covers the clip's root motion, then a short stand.
    for (const [flags, feet, dir] of [[INPUT.BLOCK | INPUT.LEFT, 5.75, ACTION_HOP_LEFT], [INPUT.BLOCK | INPUT.RIGHT, 4.94, ACTION_HOP_RIGHT]] as const) {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const start = { ...c.position };
      run(mw, c, flags, 0, 1);
      expect(c.rollDir).toBe(dir);
      run(mw, c, flags, 0, SHIELD_HOP_TICKS - 1);
      expect(c.rollDir).toBe(ACTION_HOP_PAUSE);
      const hopped = Math.hypot(c.position.x - start.x, c.position.z - start.z) / 0.3048;
      expect(hopped).toBeCloseTo(feet, 1);
      const mid = { ...c.position };
      run(mw, c, flags, 0, SHIELD_HOP_PAUSE_TICKS - 1);
      expect(Math.hypot(c.position.x - mid.x, c.position.z - mid.z)).toBeLessThan(1e-3); // standing
    }
    // The hop follows the clip's profile: a slow wind-up, then the quick leap.
    {
      const { mw, c } = setup();
      run(mw, c, 0, 0, 10);
      const steps: number[] = [];
      for (let i = 0; i < 6; i++) {
        const before = c.position.x;
        run(mw, c, INPUT.BLOCK | INPUT.LEFT, 0, 1);
        steps.push(Math.abs(c.position.x - before));
      }
      expect(steps[0]!).toBeLessThan(steps[3]! / 2);
    }
    expect(movementAnim(INPUT.BLOCK | INPUT.FORWARD, true, 0)).toBe(ANIM.WALK);
    expect(movementAnim(INPUT.BLOCK | INPUT.BACK, true, 0)).toBe(ANIM.RETREAT);
    expect(movementAnim(INPUT.BLOCK | INPUT.LEFT, true, ACTION_HOP_LEFT)).toBe(ANIM.HOP_LEFT);
    expect(movementAnim(INPUT.BLOCK | INPUT.LEFT, true, ACTION_HOP_PAUSE)).toBe(ANIM.SHIELD_IDLE);
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
      air: { kind: c.airKind, velX: c.airVelX, velZ: c.airVelZ, travel: c.airTravel },
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

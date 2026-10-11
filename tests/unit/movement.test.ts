import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVEMENT_STATS,
  INPUT,
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
    expect(Math.abs(c.position.x)).toBeLessThan(0.01);
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
    expect(d).toBeLessThanOrEqual(DEFAULT_MOVEMENT_STATS.runSpeed + 0.01);
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

  it('picks the attack from the movement key held with the click', () => {
    expect(attackKindFor(0)).toBe('normal');
    expect(attackKindFor(INPUT.FORWARD | INPUT.LEFT)).toBe('overhead');
    expect(attackKindFor(INPUT.LEFT)).toBe('left');
    expect(attackKindFor(INPUT.RIGHT)).toBe('right');
    expect(attackKindFor(INPUT.BACK)).toBe('normal');
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

  it('jumps to roughly v²/2g and lands', () => {
    const { mw, c } = setup();
    run(mw, c, 0, 0, 10);
    let peak = 0;
    const input: InputFrame = { clientTick: 0, flags: INPUT.JUMP, yaw: 0, pitch: 0 };
    stepCharacter(mw, c, input, DEFAULT_MOVEMENT_STATS, TICK_DT);
    input.flags = 0;
    for (let i = 0; i < 60; i++) {
      stepCharacter(mw, c, input, DEFAULT_MOVEMENT_STATS, TICK_DT);
      peak = Math.max(peak, c.position.y);
    }
    const expected = DEFAULT_MOVEMENT_STATS.jumpVelocity ** 2 / (2 * 9.81);
    expect(peak).toBeGreaterThan(expected * 0.85);
    expect(peak).toBeLessThan(expected * 1.15);
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
    let snap = { pos: { ...server.c.position }, vy: 0, grounded: false };
    inputs.forEach((inp, i) => {
      stepCharacter(server.mw, server.c, inp, DEFAULT_MOVEMENT_STATS, TICK_DT);
      if (i === 400) snap = { pos: { ...server.c.position }, vy: server.c.velocityY, grounded: server.c.grounded };
    });
    // Client was mispredicting, then receives the tick-400 snapshot and replays 401..599.
    run(client.mw, client.c, INPUT.FORWARD, 1, 300);
    setCharacterState(client.c, snap.pos, snap.vy, snap.grounded);
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

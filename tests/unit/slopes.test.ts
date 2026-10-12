import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVEMENT_STATS,
  INPUT,
  TICK_DT,
  createCharacter,
  createInputFrame,
  createMovementWorld,
  initPhysics,
  quantizeAngle,
  stepCharacter,
  type ArenaDef,
  type Rapier,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

/** Flat floor with a slab tilted by `deg` ahead (-Z) of the start. */
function rampArena(deg: number): ArenaDef {
  const a = (deg * Math.PI) / 180;
  const half = 10;
  return {
    name: 'ramp',
    boxes: [
      { x: 0, y: -0.5, z: 0, hx: 30, hy: 0.5, hz: 30, kind: 'floor' },
      // Rises towards -Z: rotated about X so its top face climbs as z decreases.
      { x: 0, y: Math.sin(a) * half, z: -2 - Math.cos(a) * half, hx: 4, hy: 0.2, hz: half, rotX: a, kind: 'ramp' },
    ],
    meshes: [],
    spawnPoints: [{ x: 0, y: 0.1, z: 0 }],
    mobSpawns: [],
  };
}

/** Runs forward (and jumping now and then) into the slab for 10 s; returns the highest point. */
function climb(deg: number): number {
  const mw = createMovementWorld(rapier, rampArena(deg));
  const c = createCharacter(mw, { x: 0, y: 0.1, z: 0 });
  let top = 0;
  for (let t = 0; t < 200; t++) {
    const f = createInputFrame();
    f.flags = INPUT.FORWARD | (t % 25 === 0 ? INPUT.JUMP : 0);
    f.yaw = quantizeAngle(0);
    stepCharacter(mw, c, f, DEFAULT_MOVEMENT_STATS, TICK_DT);
    top = Math.max(top, c.position.y);
  }
  return top;
}

describe('slopes', () => {
  it('a walkable ramp is climbed', () => {
    expect(climb(30)).toBeGreaterThan(5);
  });

  it('a steep slope is not: no standing on it, no stepping up it past a jump', () => {
    // A jump reaches ~4.3 m; on 70 degrees the character must not get higher than that.
    expect(climb(70)).toBeLessThan(4.6);
  });
});

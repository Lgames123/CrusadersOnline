import type { ArenaDef, BoxDef } from './types.ts';

const SIZE = 40; // arena is SIZE x SIZE metres, centred on the origin
const WALL_H = 4;
const WALL_T = 0.5;

function rampBox(x: number, z: number, length: number, rise: number, width: number): BoxDef {
  const angle = Math.atan2(rise, length);
  const slopeLen = Math.hypot(length, rise);
  const thickness = 0.2;
  return {
    kind: 'ramp',
    x,
    // centre the slab so its top surface runs from y=0 at the low end to y=rise at the high end
    y: rise / 2 - (thickness / 2) * Math.cos(angle),
    z,
    hx: width / 2,
    hy: thickness / 2,
    hz: slopeLen / 2,
    rotX: -angle,
  };
}

/** Greybox test arena used by the vertical slice: floor, perimeter walls, pillars, a ramp up to a platform. */
export function createSyntheticArena(): ArenaDef {
  const half = SIZE / 2;
  const boxes: BoxDef[] = [
    { kind: 'floor', x: 0, y: -0.5, z: 0, hx: half, hy: 0.5, hz: half },
    { kind: 'wall', x: 0, y: WALL_H / 2, z: -half - WALL_T / 2, hx: half + WALL_T, hy: WALL_H / 2, hz: WALL_T / 2 },
    { kind: 'wall', x: 0, y: WALL_H / 2, z: half + WALL_T / 2, hx: half + WALL_T, hy: WALL_H / 2, hz: WALL_T / 2 },
    { kind: 'wall', x: -half - WALL_T / 2, y: WALL_H / 2, z: 0, hx: WALL_T / 2, hy: WALL_H / 2, hz: half },
    { kind: 'wall', x: half + WALL_T / 2, y: WALL_H / 2, z: 0, hx: WALL_T / 2, hy: WALL_H / 2, hz: half },
  ];

  for (const [px, pz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]] as const) {
    boxes.push({ kind: 'pillar', x: px, y: 2, z: pz, hx: 0.75, hy: 2, hz: 0.75 });
  }

  // Ramp along +Z rising 1.5 m over 6 m (~14°), leading onto a platform.
  const rampLen = 6;
  const rise = 1.5;
  boxes.push(rampBox(12, 6, rampLen, rise, 3));
  boxes.push({ kind: 'platform', x: 12, y: rise / 2, z: 6 + rampLen / 2 + 2, hx: 3, hy: rise / 2, hz: 2 });

  return {
    name: 'synthetic-arena',
    boxes,
    meshes: [],
    spawnPoints: [
      { x: 0, y: 1, z: 0 },
      { x: 3, y: 1, z: 3 },
      { x: -3, y: 1, z: 3 },
      { x: 3, y: 1, z: -3 },
    ],
    // The vertical slice's representative enemy, beyond aggro range of the player spawns.
    mobSpawns: [{ archetype: 'skeleton_warrior', x: 0, y: 0.5, z: -15 }],
  };
}

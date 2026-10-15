import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { packCollision } from '@crusaders/converter/emit/gltf_level';
import {
  LEVEL_UNIT_METRES,
  buildLevelArena,
  arrivalPoint,
  inPortal,
  type LevelPlacements,
  type PortalDef,
} from '@crusaders/shared';

describe('Citadel and Corantha portal network', () => {
  it('triggers Citadel stairs going UP as well as down (yMin 872 to yMax 1040)', () => {
    const portal: PortalDef = {
      id: 0,
      target: 'level:ci1b',
      x: 2048 * LEVEL_UNIT_METRES,
      y: 869 * LEVEL_UNIT_METRES,
      z: -1336 * LEVEL_UNIT_METRES,
      trigger: {
        polygon: [
          [2036 * LEVEL_UNIT_METRES, -1338 * LEVEL_UNIT_METRES],
          [2036 * LEVEL_UNIT_METRES, -1362 * LEVEL_UNIT_METRES],
          [2060 * LEVEL_UNIT_METRES, -1362 * LEVEL_UNIT_METRES],
          [2060 * LEVEL_UNIT_METRES, -1338 * LEVEL_UNIT_METRES],
        ],
        yMin: 872 * LEVEL_UNIT_METRES,
        yMax: 1040 * LEVEL_UNIT_METRES,
      },
    };

    // Going UP the stairs above the balcony (e.g. y = 960 ft) is inside the trigger
    const upStairs = {
      x: 2048 * LEVEL_UNIT_METRES,
      y: 960 * LEVEL_UNIT_METRES,
      z: -1350 * LEVEL_UNIT_METRES,
    };
    expect(inPortal(portal, upStairs)).toBe(true);

    // Near the roof / top landing (y = 1030 ft) is also inside
    const topStairs = {
      x: 2048 * LEVEL_UNIT_METRES,
      y: 1030 * LEVEL_UNIT_METRES,
      z: -1350 * LEVEL_UNIT_METRES,
    };
    expect(inPortal(portal, topStairs)).toBe(true);

    // Below the staircase threshold (e.g. y = 860 ft) is outside
    const belowStairs = {
      x: 2048 * LEVEL_UNIT_METRES,
      y: 860 * LEVEL_UNIT_METRES,
      z: -1350 * LEVEL_UNIT_METRES,
    };
    expect(inPortal(portal, belowStairs)).toBe(false);

    // Out in the courtyard away from the tower is outside
    const courtyard = {
      x: 2020 * LEVEL_UNIT_METRES,
      y: 896 * LEVEL_UNIT_METRES,
      z: -1300 * LEVEL_UNIT_METRES,
    };
    expect(inPortal(portal, courtyard)).toBe(false);
  });

  it('picks the floor closest to the reference height on multi-level spiral staircases', () => {
    // A collision mesh with two stacked walkable floors over the same (x, z):
    // Floor A at y = 835 ft (lower landing)
    // Floor B at y = 875 ft (upper spiral step)
    const vertices = [
      // Floor A: (0, 835, 0) to (20, 835, -20)
      0, 835, 0,
      20, 835, 0,
      20, 835, -20,
      0, 835, -20,
      // Floor B: (0, 875, 0) to (20, 875, -20)
      0, 875, 0,
      20, 875, 0,
      20, 875, -20,
      0, 875, -20,
    ];
    const indices = [
      0, 1, 2, 0, 2, 3, // Floor A
      4, 5, 6, 4, 6, 7, // Floor B
    ];
    const col = packCollision(vertices, indices);

    const placements: LevelPlacements = {
      mesh: 'test',
      creatures: [],
      portals: [
        {
          exit: 0,
          target: 'origin',
          position: [10, 835, -10],
          trigger: {
            polygon: [
              [8, -8],
              [8, -12],
              [12, -12],
              [12, -8],
            ],
            yMin: 834,
            yMax: 840,
          },
        },
      ],
    };

    const arena = buildLevelArena('level:multi', col, placements);
    const arr = arrivalPoint(arena, 'level:origin');

    // Must select floor A near y = 835 ft, NOT the higher floor B at y = 875 ft
    expect(arr.y).toBeCloseTo(835 * LEVEL_UNIT_METRES + 0.1, 1);
  });

  it('triggers Corantha to Citadel gate inside the gate corridor volume', () => {
    const portal: PortalDef = {
      id: 1,
      target: 'level:ci1a',
      x: 2056 * LEVEL_UNIT_METRES,
      y: 1024 * LEVEL_UNIT_METRES,
      z: -1706 * LEVEL_UNIT_METRES,
      trigger: {
        polygon: [
          [2024 * LEVEL_UNIT_METRES, -1618 * LEVEL_UNIT_METRES],
          [2024 * LEVEL_UNIT_METRES, -1646 * LEVEL_UNIT_METRES],
          [2090 * LEVEL_UNIT_METRES, -1646 * LEVEL_UNIT_METRES],
          [2090 * LEVEL_UNIT_METRES, -1618 * LEVEL_UNIT_METRES],
        ],
        yMin: 1012 * LEVEL_UNIT_METRES,
        yMax: 1045 * LEVEL_UNIT_METRES,
      },
    };

    // Inside the gate arch
    const inGate = {
      x: 2050 * LEVEL_UNIT_METRES,
      y: 1025 * LEVEL_UNIT_METRES,
      z: -1630 * LEVEL_UNIT_METRES,
    };
    expect(inPortal(portal, inGate)).toBe(true);

    // Outside the gate before walking in
    const outsideBefore = {
      x: 2050 * LEVEL_UNIT_METRES,
      y: 1025 * LEVEL_UNIT_METRES,
      z: -1600 * LEVEL_UNIT_METRES,
    };
    expect(inPortal(portal, outsideBefore)).toBe(false);

    // Too high above the arch
    const tooHigh = {
      x: 2050 * LEVEL_UNIT_METRES,
      y: 1055 * LEVEL_UNIT_METRES,
      z: -1630 * LEVEL_UNIT_METRES,
    };
    expect(inPortal(portal, tooHigh)).toBe(false);
  });

  it('ensures converted Citadel and Corantha placement files carry verified trigger volumes', () => {
    const levelsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
    if (!fs.existsSync(levelsDir)) return;
    const checked = [
      { act: 'cs1a', target: 'ci1a' },
      { act: 'ci1a', target: 'cs1a' },
      { act: 'ci1a', target: 'ci1b' },
      { act: 'ci1b', target: 'ci1a' },
      { act: 'ci1b', target: 'ci2b' },
      { act: 'cs2a', target: 'ci2a' },
      { act: 'ci2a', target: 'cs2a' },
      { act: 'ci2a', target: 'ci2b' },
      { act: 'ci2b', target: 'ci9b' },
      { act: 'cs3a', target: 'ci3a' },
      { act: 'ci3a', target: 'ci3b' },
      { act: 'ci3b', target: 'ci4b' },
      { act: 'cs4a', target: 'ci4a' },
      { act: 'ci4a', target: 'cs4a' },
      { act: 'ci4a', target: 'ci4b' },
      { act: 'ci4b', target: 'ci3b' },
      { act: 'ci9a', target: 'ci9b' },
      { act: 'ci9b', target: 'ci1b' },
    ];

    for (const { act, target } of checked) {
      const pPath = path.join(levelsDir, `${act}.placements.json`);
      expect(fs.existsSync(pPath), `missing ${act}.placements.json`).toBe(true);
      const data = JSON.parse(fs.readFileSync(pPath, 'utf8')) as LevelPlacements;
      const portal = data.portals?.find((p) => p.target.toLowerCase() === target.toLowerCase());
      expect(portal, `portal ${act} -> ${target} not found`).toBeDefined();
      expect(portal!.trigger, `portal ${act} -> ${target} must have a trigger volume`).toBeDefined();
      expect(portal!.trigger!.yMin).toBeLessThan(portal!.trigger!.yMax);
      expect(portal!.trigger!.polygon.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('places player past return trigger facing into level for ci9a <-> ci9b without bounce loop', () => {
    const levelsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
    if (!fs.existsSync(levelsDir)) return;

    const ci9aCol = fs.readFileSync(path.join(levelsDir, 'ci_a.collision.bin'));
    const ci9bCol = fs.readFileSync(path.join(levelsDir, 'ci_b.collision.bin'));
    const ci9aPlacements = JSON.parse(fs.readFileSync(path.join(levelsDir, 'ci9a.placements.json'), 'utf8')) as LevelPlacements;
    const ci9bPlacements = JSON.parse(fs.readFileSync(path.join(levelsDir, 'ci9b.placements.json'), 'utf8')) as LevelPlacements;

    const ci9a = buildLevelArena('level:ci9a', ci9aCol, ci9aPlacements);
    const ci9b = buildLevelArena('level:ci9b', ci9bCol, ci9bPlacements);

    // 1. Arrival in ci9b from ci9a
    const arrB = arrivalPoint(ci9b, 'level:ci9a');
    const returnPortalB = ci9b.portals!.find((p) => p.target === 'level:ci9a')!;
    expect(inPortal(returnPortalB, arrB, 0.1), 'must land outside ci9b return trigger').toBe(false);

    // Walking forward 0.5m to 4m along spawn yaw in ci9b
    const fwdBx = -Math.sin(arrB.yaw), fwdBz = -Math.cos(arrB.yaw);
    for (let d = 0.5; d <= 4.0; d += 0.5) {
      const step = { x: arrB.x + fwdBx * d, y: arrB.y, z: arrB.z + fwdBz * d };
      expect(inPortal(returnPortalB, step, 0.05), `ci9b step forward ${d}m must not re-enter return trigger`).toBe(false);
    }

    // 2. Arrival in ci9a from ci9b
    const arrA = arrivalPoint(ci9a, 'level:ci9b');
    const returnPortalA = ci9a.portals!.find((p) => p.target === 'level:ci9b')!;
    expect(inPortal(returnPortalA, arrA, 0.1), 'must land outside ci9a return trigger').toBe(false);

    // Walking forward 0.5m to 4m along spawn yaw in ci9a
    const fwdAx = -Math.sin(arrA.yaw), fwdAz = -Math.cos(arrA.yaw);
    for (let d = 0.5; d <= 4.0; d += 0.5) {
      const step = { x: arrA.x + fwdAx * d, y: arrA.y, z: arrA.z + fwdAz * d };
      expect(inPortal(returnPortalA, step, 0.05), `ci9a step forward ${d}m must not re-enter return trigger`).toBe(false);
    }
  });

  it('guarantees forward walk along spawn yaw never enters return trigger across full portal network', () => {
    const levelsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
    if (!fs.existsSync(levelsDir)) return;

    const files = fs.readdirSync(levelsDir).filter((f) => f.endsWith('.placements.json'));
    const arenas = new Map<string, ReturnType<typeof buildLevelArena>>();

    for (const file of files) {
      const name = 'level:' + file.replace('.placements.json', '');
      const placements = JSON.parse(fs.readFileSync(path.join(levelsDir, file), 'utf8')) as LevelPlacements;
      const meshFile = placements.mesh ? path.join(levelsDir, `${placements.mesh}.collision.bin`) : null;
      if (!meshFile || !fs.existsSync(meshFile)) continue;
      arenas.set(name, buildLevelArena(name, fs.readFileSync(meshFile), placements));
    }

    let tested = 0;
    for (const [originName, originArena] of arenas) {
      for (const portal of originArena.portals ?? []) {
        const destArena = arenas.get(portal.target);
        if (!destArena) continue;
        const returnPortal = destArena.portals?.find((p) => p.target === originName);
        if (!returnPortal) continue;

        tested++;
        const arr = arrivalPoint(destArena, originName);
        expect(inPortal(returnPortal, arr, 0.1), `${originName} -> ${portal.target}: arrived inside return trigger`).toBe(false);

        const fwdX = -Math.sin(arr.yaw), fwdZ = -Math.cos(arr.yaw);
        for (let d = 0.5; d <= 3.5; d += 0.5) {
          const step = { x: arr.x + fwdX * d, y: arr.y, z: arr.z + fwdZ * d };
          expect(inPortal(returnPortal, step, 0.05), `${originName} -> ${portal.target}: step ${d}m re-entered return trigger`).toBe(false);
        }
      }
    }
    expect(tested).toBeGreaterThanOrEqual(150);
  });

  it('ci9a -> ci9b does NOT land at ci9b.starts[2] (starts-by-exit regression), but lands near stairs', () => {
    const levelsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
    if (!fs.existsSync(levelsDir)) return;

    const ci9bCol = fs.readFileSync(path.join(levelsDir, 'ci_b.collision.bin'));
    const ci9bPlacements = JSON.parse(fs.readFileSync(path.join(levelsDir, 'ci9b.placements.json'), 'utf8')) as LevelPlacements;
    const ci9b = buildLevelArena('level:ci9b', ci9bCol, ci9bPlacements);

    const arrB = arrivalPoint(ci9b, 'level:ci9a');
    // starts[2] was (2048 * s, 817.5 * s, -1456 * s) where z = -443.78 m
    expect(arrB.z).toBeGreaterThan(-420);
    expect(arrB.z).toBeLessThan(-405);
    // starts[2] had z = -443.78m (100 ft away in the basement)
    expect(Math.abs(arrB.z - -443.78)).toBeGreaterThan(20);
    // x is on the stairs landing (around 620..632m)
    expect(arrB.x).toBeGreaterThan(620);
    expect(arrB.x).toBeLessThan(632);
  });

  it('preserves continuity for shared-frame transfers (ci9a <-> ci9b and ci1a <-> ci1b)', () => {
    const levelsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
    if (!fs.existsSync(levelsDir)) return;

    const ci9bCol = fs.readFileSync(path.join(levelsDir, 'ci_b.collision.bin'));
    const ci9bPlacements = JSON.parse(fs.readFileSync(path.join(levelsDir, 'ci9b.placements.json'), 'utf8')) as LevelPlacements;
    const ci9b = buildLevelArena('level:ci9b', ci9bCol, ci9bPlacements);

    // Player crossing from ci9a walking south/upstairs at yaw = 0
    const crossing = {
      x: 2048 * LEVEL_UNIT_METRES,
      y: 845 * LEVEL_UNIT_METRES,
      z: -1340 * LEVEL_UNIT_METRES,
      yaw: 0,
      mesh: ci9b.mesh,
    };
    const arr = arrivalPoint(ci9b, 'level:ci9a', crossing);
    expect(arr.yaw).toBe(0);
    expect(arr.x).toBeCloseTo(crossing.x, 1);
    expect(arr.z).toBeLessThan(crossing.z); // advanced forward along yaw (towards -z)
  });

  it('different-frame transfer cs1a -> ci1a uses connectivity to arrive facing courtyard', () => {
    const levelsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
    if (!fs.existsSync(levelsDir)) return;

    const ci1aCol = fs.readFileSync(path.join(levelsDir, 'ci_a.collision.bin'));
    const ci1aPlacements = JSON.parse(fs.readFileSync(path.join(levelsDir, 'ci1a.placements.json'), 'utf8')) as LevelPlacements;
    const ci1a = buildLevelArena('level:ci1a', ci1aCol, ci1aPlacements);

    const arr = arrivalPoint(ci1a, 'level:cs1a');
    const returnPortal = ci1a.portals!.find((p) => p.target === 'level:cs1a')!;
    expect(inPortal(returnPortal, arr, 0.1)).toBe(false);

    // Walking forward 3m moves into the courtyard (away from the gate)
    const fwdX = -Math.sin(arr.yaw), fwdZ = -Math.cos(arr.yaw);
    for (let d = 0.5; d <= 3.5; d += 0.5) {
      expect(inPortal(returnPortal, { x: arr.x + fwdX * d, y: arr.y, z: arr.z + fwdZ * d }, 0.05)).toBe(false);
    }
  });

  it('rejects dead-end pocket behind trigger in favour of open floor', () => {
    // Portal at (0, 0, 0), trigger from x: -2..2, z: -1..1
    // Floor behind trigger (z: 1..2) is bounded by walls (pocket, 2 nodes)
    // Floor in front of trigger (z: -1..-10, x: -5..5) is open (wide hall, 50+ nodes)
    const vertices = [
      // Pocket behind (x: -2..2, z: 1.1..2)
      -2, 0, 1.1,
       2, 0, 1.1,
       2, 0, 2.0,
      -2, 0, 2.0,
      // Open hall in front (x: -5..5, z: -1.1..-10)
      -5, 0, -1.1,
       5, 0, -1.1,
       5, 0, -10.0,
      -5, 0, -10.0,
    ];
    const indices = [
      0, 1, 2, 0, 2, 3, // pocket
      4, 5, 6, 4, 6, 7, // open hall
    ];
    const col = packCollision(vertices, indices);
    const placements: LevelPlacements = {
      mesh: 'pocket_test',
      creatures: [],
      portals: [{
        target: 'level:origin',
        position: [0, 0, 0],
        trigger: {
          polygon: [
            [-2, -1],
            [-2,  1],
            [ 2,  1],
            [ 2, -1],
          ],
          yMin: -1,
          yMax: 2,
        },
      }],
    };
    const arena = buildLevelArena('level:pocket_test', col, placements);
    const arr = arrivalPoint(arena, 'level:origin');
    // Must pick the open hall (z < -1), NOT the pocket (z > 1)
    expect(arr.z).toBeLessThan(-1);
  });
});

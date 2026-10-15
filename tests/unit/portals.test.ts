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
});

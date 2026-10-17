import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { packCollision } from '@crusaders/converter/emit/gltf_level';
import {
  LEVEL_UNIT_METRES,
  buildLevelArena,
  arrivalPoint,
  exitArrival,
  floorAt,
  inPortal,
  respawnPoint,
  type LevelPlacements,
  type PortalDef,
} from '@crusaders/shared';

describe('Citadel and Corantha portal network', () => {
  it('touches a trigger with the body, not the feet (0x4394F0): a volume between two turns of a stair', () => {
    const ft = LEVEL_UNIT_METRES;
    // Ci1b's way back to Ci1a: 844-856 ft, over steps at 841 and 857 ft.
    const portal: PortalDef = {
      id: 0,
      target: 'level:ci1a',
      x: 2048 * ft,
      y: 833 * ft,
      z: -1352 * ft,
      trigger: {
        polygon: [
          [2056 * ft, -1350 * ft],
          [2056 * ft, -1354 * ft],
          [2068 * ft, -1354 * ft],
          [2068 * ft, -1350 * ft],
        ],
        yMin: 844 * ft,
        yMax: 856 * ft,
      },
    };
    expect(inPortal(portal, { x: 2060 * ft, y: 841 * ft, z: -1352 * ft })).toBe(true); // head above the bottom
    expect(inPortal(portal, { x: 2060 * ft, y: 836 * ft, z: -1352 * ft })).toBe(false); // head still below
    expect(inPortal(portal, { x: 2060 * ft, y: 857 * ft, z: -1352 * ft })).toBe(false); // feet above the top
    expect(inPortal(portal, { x: 2060 * ft, y: 850 * ft, z: -1348.9 * ft })).toBe(true); // within a body radius of the edge
    expect(inPortal(portal, { x: 2060 * ft, y: 850 * ft, z: -1346 * ft })).toBe(false);
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
          [1992 * LEVEL_UNIT_METRES, -1680 * LEVEL_UNIT_METRES],
          [1992 * LEVEL_UNIT_METRES, -1692 * LEVEL_UNIT_METRES],
          [2104 * LEVEL_UNIT_METRES, -1692 * LEVEL_UNIT_METRES],
          [2104 * LEVEL_UNIT_METRES, -1680 * LEVEL_UNIT_METRES],
        ],
        yMin: 1012 * LEVEL_UNIT_METRES,
        yMax: 1040 * LEVEL_UNIT_METRES,
      },
    };

    // Inside the gate arch
    expect(inPortal(portal, { x: 2050 * LEVEL_UNIT_METRES, y: 1024 * LEVEL_UNIT_METRES, z: -1686 * LEVEL_UNIT_METRES })).toBe(true);
    // Outside the gate before walking in
    expect(inPortal(portal, { x: 2050 * LEVEL_UNIT_METRES, y: 1024 * LEVEL_UNIT_METRES, z: -1660 * LEVEL_UNIT_METRES })).toBe(false);
    // Too high above the arch
    expect(inPortal(portal, { x: 2050 * LEVEL_UNIT_METRES, y: 1045 * LEVEL_UNIT_METRES, z: -1686 * LEVEL_UNIT_METRES })).toBe(false);
  });

  const levelsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
  const placementsOf = (act: string) => JSON.parse(fs.readFileSync(path.join(levelsDir, `${act}.placements.json`), 'utf8')) as LevelPlacements;
  const arenaOf = (act: string) => {
    const pl = placementsOf(act);
    return buildLevelArena(`level:${act}`, fs.readFileSync(path.join(levelsDir, `${pl.mesh}.collision.bin`)), pl);
  };

  it('keeps the original Citadel stair volumes; act changes within a mesh are scripted', () => {
    if (!fs.existsSync(levelsDir)) return;
    for (const act of ['ci1a', 'ci2a', 'ci3a', 'ci4a', 'ci9a']) {
      const p = placementsOf(act).portals!.find((q) => q.target === `${act.slice(0, 3)}b`)!;
      expect(p.trigger, act).toEqual({ polygon: [[2046, -1344], [2046, -1356], [2050, -1356], [2050, -1344]], yMin: 872, yMax: 888 });
      expect(p.scripted, act).toBeUndefined();
    }
    for (const [act, target] of [['ci1b', 'ci2b'], ['ci2b', 'ci9b'], ['ci3b', 'ci4b'], ['ci4b', 'ci3b'], ['ci9b', 'ci1b'], ['co1a', 'co8a']] as const) {
      const p = placementsOf(act).portals!.find((q) => q.target === target)!;
      expect(p.trigger, `${act} -> ${target}`).toBeUndefined();
      expect(p.scripted, `${act} -> ${target}`).toBe(true);
    }
    // The gates keep a volume (walking through is kept, see resolveLevelPortalTrigger).
    for (const [act, target] of [['cs1a', 'ci1a'], ['ci1a', 'cs1a'], ['cs2a', 'ci2a'], ['ci2a', 'cs2a'], ['cs3a', 'ci3a'], ['ci3a', 'cs3a']] as const) {
      expect(placementsOf(act).portals!.find((q) => q.target === target)!.trigger, `${act} -> ${target}`).toBeDefined();
    }
  });

  it('arrives as the original: the matching entry plus the crossing offset, heading kept (ci9a <-> ci9b)', () => {
    if (!fs.existsSync(levelsDir)) return;
    const ft = LEVEL_UNIT_METRES;
    const ci9a = arenaOf('ci9a');
    const ci9b = arenaOf('ci9b');
    // Down the ci9a tower: a step inside the exit's volume.
    const down = ci9a.portals!.find((p) => p.target === 'level:ci9b')!;
    const P = { x: 2048 * ft, z: -1346 * ft, y: floorAt(ci9a, 2048 * ft, -1346 * ft, 872 * ft, 1)! + 0.1 };
    expect(inPortal(down, P)).toBe(true);
    const arrB = exitArrival(ci9b, 'level:ci9a', { exit: down.exit!, offset: { x: P.x - down.x, y: P.y - down.y, z: P.z - down.z } });
    // The same step of the same stair in ci9b's frame: (0, -36, -16) ft away.
    expect(arrB.x).toBeCloseTo(P.x, 5);
    expect(arrB.z).toBeCloseTo(P.z - 16 * ft, 5);
    expect(arrB.y).toBeCloseTo(P.y - 36 * ft, 1);
    expect(arrB.yaw).toBeUndefined();
    for (const q of ci9b.portals!) if (!q.scripted) expect(inPortal(q, arrB), `ci9b -> ${q.target}`).toBe(false);
    // Not ci9b's start point 2 (the exit number of the way back is not a start index).
    expect(Math.hypot(arrB.x - ci9b.starts![2]!.x, arrB.z - ci9b.starts![2]!.z)).toBeGreaterThan(20);

    // Back up the ci9b tower.
    const up = ci9b.portals!.find((p) => p.target === 'level:ci9a')!;
    const Q = { x: 2060 * ft, z: -1352 * ft, y: floorAt(ci9b, 2060 * ft, -1352 * ft, 841 * ft, 1)! + 0.1 };
    expect(inPortal(up, Q)).toBe(true);
    const arrA = exitArrival(ci9a, 'level:ci9b', { exit: up.exit!, offset: { x: Q.x - up.x, y: Q.y - up.y, z: Q.z - up.z } });
    expect(arrA.z).toBeCloseTo(Q.z + 16 * ft, 5);
    expect(arrA.y).toBeCloseTo(Q.y + 36 * ft, 1);
    for (const q of ci9a.portals!) expect(inPortal(q, arrA), `ci9a -> ${q.target}`).toBe(false);
  });

  it('arrives at the start point named by an exit with flag 2, with its heading (Ci9a -> Cs1a)', () => {
    if (!fs.existsSync(levelsDir)) return;
    const ci9a = arenaOf('ci9a');
    const cs1a = arenaOf('cs1a');
    const gate = ci9a.portals!.find((p) => p.target === 'level:cs1a')!;
    expect(gate.toStart).toBe(true);
    const arr = exitArrival(cs1a, 'level:ci9a', { exit: gate.exit!, toStart: true, offset: { x: 0, y: 0, z: 0 } });
    const s = cs1a.starts![gate.exit!]!;
    expect(arr.x).toBeCloseTo(s.x, 5);
    expect(arr.z).toBeCloseTo(s.z, 5);
    expect(arr.yaw).toBeCloseTo(s.yaw, 5);
  });

  it('walking into any exit lands on its matching entry, heading kept', () => {
    if (!fs.existsSync(levelsDir)) return;
    const arenas = new Map<string, ReturnType<typeof buildLevelArena>>();
    for (const f of fs.readdirSync(levelsDir).filter((n) => n.endsWith('.placements.json'))) {
      const act = f.replace('.placements.json', '');
      if (fs.existsSync(path.join(levelsDir, `${placementsOf(act).mesh}.collision.bin`))) arenas.set(`level:${act}`, arenaOf(act));
    }
    let tested = 0;
    for (const [src, A] of arenas) {
      for (const portal of A.portals ?? []) {
        const B = arenas.get(portal.target);
        if (!B || portal.use || portal.scripted || !portal.trigger || portal.toStart) continue;
        const back = B.portals!.find((q) => q.target === src && q.entry === (portal.exit! & 0xff));
        if (!back) continue;
        // A step at the volume's centre, on the floor.
        const poly = portal.trigger.polygon;
        const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
        const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
        const fy = floorAt(A, cx, cz, portal.trigger.yMin, 2);
        if (fy === null || !inPortal(portal, { x: cx, y: fy + 0.1, z: cz })) continue;
        const arr = exitArrival(B, src, { exit: portal.exit!, offset: { x: cx - portal.x, y: fy + 0.1 - portal.y, z: cz - portal.z } });
        // No floor at the entry (the offset leaves the mesh) falls back to a search beside it.
        if (Math.hypot(arr.x - (back.x + cx - portal.x), arr.z - (back.z + cz - portal.z)) > 1e-6) continue;
        tested++;
        expect(arr.yaw, `${src} -> ${portal.target}: heading kept`).toBeUndefined();
      }
    }
    expect(tested).toBeGreaterThanOrEqual(20);
  });
  it('respawns a few metres past the trigger the player came in by, else at the level start', () => {
    if (!fs.existsSync(levelsDir)) return;
    let tested = 0;
    const report: string[] = [];
    const bad: string[] = [];
    for (const f of fs.readdirSync(levelsDir).filter((n) => n.endsWith('.placements.json'))) {
      const act = f.replace('.placements.json', '');
      if (!fs.existsSync(path.join(levelsDir, `${placementsOf(act).mesh}.collision.bin`))) continue;
      const A = arenaOf(act);
      const ways: [string | undefined, { exit: number; offset: { x: number; y: number; z: number } } | undefined][] = [[undefined, undefined]];
      for (const p of A.portals ?? []) if (p.entry !== undefined) ways.push([p.target, { exit: p.entry, offset: { x: 0, y: 0, z: 0 } }]);
      for (const [from, via] of ways) {
        const r = respawnPoint(A, from, via);
        const floor = floorAt(A, r.x, r.z, r.y, 0.5);
        const inside = (A.portals ?? []).filter((p) => !p.scripted && !p.use && inPortal(p, r));
        const way = `${act} <- ${from ?? 'start'}`;
        report.push(`${way}: ${r.x.toFixed(1)},${r.y.toFixed(1)},${r.z.toFixed(1)}`);
        if (floor === null) bad.push(`${way}: off the floor`);
        if (from && inside.length) bad.push(`${way}: inside ${inside.map((p) => p.target).join(',')}`);
        tested++;
      }
    }
    if (process.env.RESPAWN_REPORT) console.log(report.join('\n'));
    expect(bad).toEqual([]);
    expect(tested).toBeGreaterThan(80);
  });
});

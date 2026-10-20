import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  SC,
  WAYPOINT_CHAPTERS,
  buildLevelArena,
  emptyStoryState,
  initPhysics,
  isWaypointAct,
  waypointLabel,
  waypointSpot,
  type LevelPlacements,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const levelsDir = path.resolve(import.meta.dirname, '../../local/generated/levels');
const haveLevels = fs.existsSync(path.join(levelsDir, 'cs1a.placements.json'));

function level(act: string) {
  const placements = JSON.parse(fs.readFileSync(path.join(levelsDir, `${act}.placements.json`), 'utf8')) as LevelPlacements;
  const collision = fs.readFileSync(path.join(levelsDir, `${placements.mesh}.collision.bin`));
  return buildLevelArena(`level:${act}`, new Uint8Array(collision), placements);
}

describe('waypoints', () => {
  it('lists every act once', () => {
    const acts = WAYPOINT_CHAPTERS.flatMap((c) => c.acts);
    expect(new Set(acts).size).toBe(acts.length);
    expect(isWaypointAct('train')).toBe(false);
    expect(isWaypointAct('cs1b-inn')).toBe(false);
    expect(waypointLabel('ca1c')).toBe('The Catacombs — part 3');
    expect(waypointLabel('bs1a')).toBe("Necros's Battleship");
  });

  it.skipIf(!haveLevels)('covers every converted campaign act and finds a crystal spot in each', () => {
    const files = fs.readdirSync(levelsDir).filter((f) => f.endsWith('.placements.json'));
    const acts = files.map((f) => f.slice(0, -'.placements.json'.length)).filter((a) => a !== 'train' && !a.endsWith('-inn'));
    expect(acts.filter((a) => !isWaypointAct(a))).toEqual([]);
    const missing: string[] = [];
    for (const act of acts) {
      const spot = waypointSpot(level(act));
      if (!spot) missing.push(act);
      else expect(Math.hypot(spot.arrival.x - spot.crystal.x, spot.arrival.z - spot.crystal.z)).toBeCloseTo(1.8, 1);
    }
    expect(missing).toEqual([]);
  }, 120_000);

  it.skipIf(!haveLevels)('a finished character arrives beside the crystal and travels from it only', () => {
    const arena = level('cs2b');
    const spot = waypointSpot(arena)!;
    const sent: { conn: number; msg: ServerControlMsg }[] = [];
    const portals: { conn: number; target: string; waypoint?: boolean }[] = [];
    const zone = new WorldZone(rapier, arena.name, arena, {
      send: (conn, data) => { if (typeof data === 'string') sent.push({ conn, msg: JSON.parse(data) as ServerControlMsg }); },
      portal: (conn, target, _keep, _via, waypoint) => portals.push({ conn, target, ...(waypoint ? { waypoint } : {}) }),
      persist: () => {},
    }, { random: () => 0.5 });
    const done = { ...emptyStoryState(), completedAt: 1 };
    zone.join(1, { name: 'Done', characterId: 'c1', arrivingWaypoint: true, story: done });
    zone.join(2, { name: 'Fresh', characterId: 'c2', arrivingWaypoint: true });
    const enter = sent.find((s) => s.conn === 1 && s.msg.op === SC.WORLD_ENTER)!.msg as { d: { spawn: { x: number; z: number }; waypoint?: { x: number; y: number; z: number } } };
    expect(enter.d.waypoint).toEqual(spot.crystal);
    expect(Math.hypot(enter.d.spawn.x - spot.arrival.x, enter.d.spawn.z - spot.arrival.z)).toBeLessThan(0.05);
    // The story not finished: refused. Finished: sent on, marked as a waypoint teleport.
    zone.waypointTravel(2, 'gl3c');
    zone.waypointTravel(1, 'train');
    zone.waypointTravel(1, 'cs2b');
    expect(portals).toEqual([]);
    zone.waypointTravel(1, 'gl3c');
    expect(portals).toEqual([{ conn: 1, target: 'level:gl3c', waypoint: true }]);
  });
});

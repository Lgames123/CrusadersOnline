import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  INPUT,
  INPUT_PACKET_MAX_BYTES,
  LEVEL_UNIT_METRES,
  buildLevelArena,
  encodeInput,
  floorAt,
  initPhysics,
  quantizeAngle,
  type LevelPlacements,
  type Rapier,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const ft = LEVEL_UNIT_METRES;
const levelsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
const placementsOf = (act: string) => JSON.parse(fs.readFileSync(path.join(levelsDir, `${act}.placements.json`), 'utf8')) as LevelPlacements;
const arenaOf = (act: string) => {
  const pl = placementsOf(act);
  return buildLevelArena(`level:${act}`, fs.readFileSync(path.join(levelsDir, `${pl.mesh}.collision.bin`)), pl);
};

function setup(act: string, at: { x: number; y: number; z: number }) {
  const zone = new WorldZone(rapier, `level:${act}`, arenaOf(act), { send: () => {}, persist: () => {} }, { random: () => 0 });
  const id = zone.join(1, { name: 'Tester', characterId: 'c1', position: at, hp: 30 });
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let tick = 0;
  const run = (ticks: number, flags = 0, yaw = 0, each?: () => void) => {
    for (let i = 0; i < ticks; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++tick, flags, yaw: quantizeAngle(yaw), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
      each?.();
    }
  };
  const me = () => zone.inspect().find((a) => a.id === id)!;
  return { run, me };
}

describe("the Catacombs' pillar crossing (Ca*b)", () => {
  it('keeps the easy-only planks (cap +8 = 0x27) on every difficulty, solid as their faces', () => {
    if (!fs.existsSync(levelsDir)) return;
    for (const act of ['ca1b', 'ca2b', 'ca3b']) {
      const planks = placementsOf(act).brushes!.filter((b) => /^bWhiteMenCantJump[1-4]$/.test(b.name));
      expect(planks.map((b) => b.difficulty), act).toEqual([0x27, 0x27, 0x27, 0x27]);
      for (const d of ['easy', 'medium', 'hard'] as const) {
        const pl = placementsOf(act);
        const arena = buildLevelArena(`level:${act}`, fs.readFileSync(path.join(levelsDir, `${pl.mesh}.collision.bin`)), pl, d);
        const solid = arena.brushes!.filter((b) => /CantJump/.test(b.name) && b.solid && b.indices?.length);
        expect(solid, `${act} ${d}`).toHaveLength(4);
      }
    }
  });

  it('holds a player up on a plank over the pit', () => {
    if (!fs.existsSync(levelsDir)) return;
    const arena = arenaOf('ca1b');
    // On bWhiteMenCantJump2, between the first two pillars: the level mesh there is the pit floor.
    const x = 2828 * ft, z = -2656 * ft;
    expect(floorAt(arena, x, z, 1128 * ft, 4)).toBeNull();
    expect(floorAt(arena, x, z, 800 * ft, 60)! / ft).toBeLessThan(850);
    const t = setup('ca1b', { x, y: 1135 * ft, z });
    t.run(40);
    expect(t.me().y / ft).toBeGreaterThan(1130);
  });

  it('gives a player who falls into the pit back at the checkpoint before the planks, alive', () => {
    if (!fs.existsSync(levelsDir)) return;
    // The ledge before the first plank; running east (+X) beside the plank steps off into the pit.
    const spot = { x: 2620 * ft, y: 1128 * ft + 0.1, z: -2667 * ft };
    const t = setup('ca1b', spot);
    let lowest = Infinity;
    let back = false;
    t.run(200, INPUT.FORWARD, -Math.PI / 2, () => {
      const y = t.me().y / ft;
      lowest = Math.min(lowest, y);
      if (lowest < 1100 && Math.hypot(t.me().x - spot.x, t.me().z - spot.z) < 0.5) back = true;
    });
    expect(lowest).toBeLessThan(1100);
    expect(lowest).toBeGreaterThan(1000); // caught on the way down, long before the floor at ~800 ft
    expect(back).toBe(true);
    expect(t.me().alive).toBe(true); // not killed (Skeleton 13 on the ledge may have struck him meanwhile)
  });
});

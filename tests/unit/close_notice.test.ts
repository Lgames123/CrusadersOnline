import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { createSyntheticArena, initPhysics, type Rapier } from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

/**
 * Noticing (0x40D910): a hostile within 7 ft notices the player whatever lies between; farther
 * off it needs a clear ray. The skeleton faces -Z; the player stands behind it (out of its cone).
 */
function noticeZone(playerZ: number, wall: boolean) {
  const arena = createSyntheticArena();
  arena.mobSpawns = [{ archetype: 'skeleton_warrior', placement: 1, x: 0, y: 0.5, z: -4, hp: 25, yaw: 0 }];
  if (wall) arena.boxes.push({ kind: 'wall', x: 0, y: 2, z: -3.3, hx: 3, hy: 2, hz: 0.05 });
  const zone = new WorldZone(rapier, 'level:t1a', arena, { send: () => { }, portal: () => { }, persist: () => { } });
  zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 0, y: 0.5, z: playerZ } });
  for (let i = 0; i < 10; i++) zone.step();
  const actors = (zone as unknown as { actors: Map<number, { kind: string; state: string }> }).actors;
  return [...actors.values()].find((a) => a.kind === 'mob')!.state;
}

describe('noticing the player', () => {
  it('within 7 ft through a wall', () => {
    expect(noticeZone(-2.5, true)).not.toBe('idle');
  });

  it('not within 20 ft behind it through a wall', () => {
    expect(noticeZone(0.5, true)).toBe('idle');
  });

  it('within 20 ft behind it with nothing between', () => {
    expect(noticeZone(0.5, false)).not.toBe('idle');
  });
});

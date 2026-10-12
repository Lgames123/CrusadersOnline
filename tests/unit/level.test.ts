import { describe, expect, it } from 'vitest';
import { explode, DclError } from '@crusaders/converter/formats/dcl';
import { packCollision } from '@crusaders/converter/emit/gltf_level';
import { LEVEL_UNIT_METRES, MOB_ARCHETYPES, buildLevelArena, parseLevelCollision, type LevelPlacements } from '@crusaders/shared';

describe('PKWARE DCL explode', () => {
  it('decodes the published test vector', () => {
    // zlib contrib/blast test: 00 04 82 24 25 8f 80 7f -> "AIAIAIAIAIAIA"
    const { data, end } = explode(new Uint8Array([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]));
    expect(new TextDecoder().decode(data)).toBe('AIAIAIAIAIAIA');
    expect(end).toBe(8);
  });

  it('rejects malformed streams instead of reading past the input', () => {
    expect(() => explode(new Uint8Array([0x02, 0x04]))).toThrow(DclError); // bad literal flag
    expect(() => explode(new Uint8Array([0x00, 0x07]))).toThrow(DclError); // bad dictionary size
    expect(() => explode(new Uint8Array([0x00, 0x04, 0x82]))).toThrow(DclError); // truncated
  });
});

/** A 40 x 40 ft floor (two triangles) at height 100, original units, Z already mirrored. */
function floorCollision(): Uint8Array {
  return packCollision([0, 100, 0, 40, 100, 0, 40, 100, -40, 0, 100, -40], [0, 1, 2, 0, 2, 3]);
}

describe('original level arenas', () => {
  it('parses collision into metres and validates the data', () => {
    const mesh = parseLevelCollision(floorCollision());
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
    expect(mesh.vertices[1]).toBeCloseTo(100 * LEVEL_UNIT_METRES);
    const bad = floorCollision();
    bad[0] = 0;
    expect(() => parseLevelCollision(bad)).toThrow(/COL1/);
    const badIndex = floorCollision();
    new DataView(badIndex.buffer).setUint32(12 + 4 * 12, 9, true);
    expect(() => parseLevelCollision(badIndex)).toThrow(/out of range/);
  });

  it('spawns supported hostile creatures at their placements with their own stats', () => {
    const placements: LevelPlacements = {
      mesh: 'test',
      creatures: [
        { type: 145, name: 'SkeletonWarrior1', position: [20, 100, -20], hp: 80, xp: 60, disposition: 3, resist: [0.9, 1.1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.75] },
        { type: 145, name: 'SkeletonWarrior2', position: [10, 100, -10], hp: 1, xp: 40, disposition: 1, resist: [] }, // not hostile: a peaceful NPC
        { type: 999, name: 'Unknown', position: [5, 100, -5], hp: 50, xp: 10, disposition: 3, resist: [] }, // no archetype
      ],
    };
    const arena = buildLevelArena('level:test', floorCollision(), placements);
    expect(arena.mobSpawns).toHaveLength(2);
    expect(arena.mobSpawns[0]).toMatchObject({ archetype: 'skeleton_warrior', hp: 80, xp: 60 });
    expect(arena.mobSpawns[1]).toMatchObject({ archetype: 'npc_145' });
    expect(MOB_ARCHETYPES['npc_145']).toMatchObject({ passive: true, name: 'Skeleton Warrior' });
    expect(arena.mobSpawns[0]!.x).toBeCloseTo(20 * LEVEL_UNIT_METRES);
    expect(arena.spawnPoints.length).toBeGreaterThan(0);
    expect(arena.spawnPoints[0]!.y).toBeCloseTo(100 * LEVEL_UNIT_METRES + 0.1);
    // Identical inputs give identical arenas (server and client must agree).
    expect(buildLevelArena('level:test', floorCollision(), placements)).toEqual(arena);
  });
});

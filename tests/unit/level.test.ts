import { describe, expect, it } from 'vitest';
import { explode, DclError } from '@crusaders/converter/formats/dcl';
import { packCollision } from '@crusaders/converter/emit/gltf_level';
import { LEVEL_UNIT_METRES, MOB_ARCHETYPES, buildLevelArena, floorAt, parseLevelCollision, type LevelPlacements } from '@crusaders/shared';

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

  it('leaves the creatures a sequence kills to the sequence: no mob, a puppet at its place', () => {
    const skeleton = (name: string, x: number) => ({ type: 145, name, position: [x, 100, -20] as [number, number, number], hp: 100, xp: 10, disposition: 3, resist: [] });
    const placements: LevelPlacements = {
      mesh: 'test',
      creatures: [skeleton('Guard', 10), skeleton('Skeleton01', 20), skeleton('Skeleton02', 30)],
      story: {
        triggers: [],
        cameras: [],
        sequences: [{
          name: 'ssEscapeFromCell',
          trigger: 1,
          actors: [{ player: true }, { creature: 1 }, { creature: 2 }],
          tracks: [{ actor: 3, steps: [0] }, { actor: 4, steps: [1] }],
          steps: [
            { action: 'RunAnimation', when: null, args: { animation: 78, freeze_at_end: 0 } },
            { action: 'RunAnimation', when: null, args: { animation: 81 } },
          ],
        }],
      },
    };
    const arena = buildLevelArena('level:test', floorCollision(), placements);
    // Skeleton01 dies in the sequence; Skeleton02 only gestures there, and the guard is not cast.
    expect(arena.mobSpawns.map((m) => m.placement)).toEqual([0, 2]);
    expect(arena.puppets).toEqual([{ archetype: 'skeleton_warrior', placement: 1, x: 20 * LEVEL_UNIT_METRES, y: 100 * LEVEL_UNIT_METRES + 0.1, z: -20 * LEVEL_UNIT_METRES }]);
  });

  it('finds floors, never the ceiling above them', () => {
    // The floor of floorCollision() at 100 ft, and a ceiling at 115 ft facing down.
    const col = packCollision(
      [0, 100, 0, 40, 100, 0, 40, 100, -40, 0, 100, -40, 0, 115, 0, 40, 115, 0, 40, 115, -40, 0, 115, -40],
      [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6],
    );
    const arena = buildLevelArena('level:test', col, { mesh: 'test', creatures: [] });
    const at = (x: number, z: number, nearY: number) => floorAt(arena, x * LEVEL_UNIT_METRES, z * LEVEL_UNIT_METRES, nearY * LEVEL_UNIT_METRES);
    expect(at(20, -20, 114)).toBeCloseTo(100 * LEVEL_UNIT_METRES);
    expect(at(20, -20, 101)).toBeCloseTo(100 * LEVEL_UNIT_METRES);
  });

  it("keeps the act's start points in metres, the original's heading turned into a yaw", () => {
    const placements: LevelPlacements = {
      mesh: 'test',
      creatures: [],
      starts: [{ position: [20, 100, -20], heading: 90 }, { position: [5, 100, -5], heading: 0 }],
    };
    const [first, second] = buildLevelArena('level:test', floorCollision(), placements).starts!;
    expect(first!.x).toBeCloseTo(20 * LEVEL_UNIT_METRES);
    expect(first!.y).toBeCloseTo(100 * LEVEL_UNIT_METRES + 0.1);
    expect(first!.z).toBeCloseTo(-20 * LEVEL_UNIT_METRES);
    // Heading 90 faces +X in the original (D3D), still +X once mirrored: yaw -90° (0 = -Z).
    expect(first!.yaw).toBeCloseTo(-Math.PI / 2);
    expect(second!.yaw).toBeCloseTo(0);
    expect(buildLevelArena('level:test', floorCollision(), { mesh: 'test', creatures: [] }).starts).toBeUndefined();
  });
});

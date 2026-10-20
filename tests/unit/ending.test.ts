import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  ENDING_LOAD_SECONDS,
  NECROS_DEATH,
  SC,
  TICK_RATE,
  createSyntheticArena,
  emptyStoryState,
  inStoryVolume,
  initPhysics,
  necrosDeathShot,
  necrosDeathTimeScale,
  sanitizeStoryState,
  type ArenaDef,
  type ExitCrossing,
  type LevelPlacements,
  type Rapier,
  type ServerControlMsg,
  type StoryState,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const FT = 0.3048;
const LOAD_TICKS = Math.ceil(ENDING_LOAD_SECONDS * TICK_RATE);

interface Internals {
  players: Map<number, unknown>;
  actors: Map<number, { kind: string; hp: number; archetype?: { type?: number } }>;
  applyDamage(a: unknown, t: unknown, v: number[]): void;
}

/** A zone, every message by connection, its portals and the story states it saved. */
function world(arena: ArenaDef) {
  const sent: { conn: number; msg: ServerControlMsg }[] = [];
  const portals: { conn: number; target: string; via?: ExitCrossing }[] = [];
  const saved: { characterId: string; story?: StoryState }[] = [];
  const zone = new WorldZone(rapier, arena.name, arena, {
    send: (conn, data) => { if (typeof data === 'string') sent.push({ conn, msg: JSON.parse(data) as ServerControlMsg }); },
    portal: (conn, target, _keep, via) => portals.push({ conn, target, ...(via ? { via } : {}) }),
    persist: (records) => saved.push(...records.map((r) => ({ characterId: r.characterId, ...(r.story ? { story: r.story } : {}) }))),
  }, { random: () => 0.5 });
  const internals = zone as unknown as Internals;
  const of = (conn: number, op: number) => sent.filter((s) => s.conn === conn && s.msg.op === op).map((s) => s.msg);
  return { zone, internals, sent, portals, saved, of };
}

function necrosShip() {
  const arena = createSyntheticArena();
  arena.name = 'level:bs1a';
  arena.mobSpawns = [{ archetype: 'necros', x: 0, y: 0.5, z: -6, yaw: 0, hp: 10, placement: 23 }];
  return arena;
}

describe('the ending (ending.ts)', () => {
  it("Necros's death timeline as decompiled (0x0044F7B0)", () => {
    expect(necrosDeathShot(0).angle).toBeCloseTo(Math.PI / 3);
    expect(necrosDeathShot(1.2).angle).toBeCloseTo(-Math.PI / 3);
    expect(necrosDeathShot(2.4).angle).toBe(0);
    expect(necrosDeathShot(5)).toMatchObject({ angle: 0, rise: 10 });
    expect(necrosDeathTimeScale(0)).toBe(0.1);
    expect(necrosDeathTimeScale(4)).toBe(0.5);
    expect(NECROS_DEATH.fadeOut + NECROS_DEATH.fadeOutSeconds).toBe(ENDING_LOAD_SECONDS);
  });

  it('Necros falls: who hurt him gets the ending, the story marked done and saved at once; then the ending act at its start', () => {
    const t = world(necrosShip());
    t.zone.join(1, { name: 'Slayer', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 } });
    t.zone.join(2, { name: 'Onlooker', characterId: 'c2', position: { x: 4, y: 0.5, z: 0 } });
    const necros = [...t.internals.actors.values()].find((a) => a.kind === 'mob')!;
    const slayer = t.internals.players.get(1)!;
    t.internals.applyDamage(slayer, necros, new Array(11).fill(1000));
    expect(necros.hp).toBe(0);
    const ending = t.of(1, SC.ENDING);
    expect(ending).toHaveLength(1);
    expect(ending[0]).toMatchObject({ d: { first: true } });
    expect(t.of(2, SC.ENDING)).toHaveLength(0);
    expect(t.saved.find((r) => r.characterId === 'c1')?.story?.completedAt).toBeGreaterThan(0);
    expect(t.saved.some((r) => r.characterId === 'c2' && r.story?.completedAt)).toBe(false);
    // Out of every fight while it plays.
    const hp = (slayer as { hp: number }).hp;
    t.internals.applyDamage(necros, slayer, new Array(11).fill(1000));
    expect((slayer as { hp: number }).hp).toBe(hp);
    for (let i = 0; i < LOAD_TICKS - 1; i++) t.zone.step();
    expect(t.portals).toEqual([]);
    for (let i = 0; i < 2; i++) t.zone.step();
    expect(t.portals).toEqual([{ conn: 1, target: 'level:cs5b', via: { exit: 0, toStart: true, offset: { x: 0, y: 0, z: 0 } } }]);
  });

  it("seqNecros as the ship's data has it: Drake is put in the arena, Necros Before goes, Necros comes", () => {
    const arena = createSyntheticArena();
    arena.name = 'level:bs1a';
    arena.mobSpawns = [
      { archetype: 'npc_139', x: 0, y: 0.5, z: -8, yaw: 0, placement: 22 },
      { archetype: 'necros', x: 0, y: 0.5, z: -10, yaw: 0, hp: 1000, placement: 23, hidden: true },
    ];
    const square: [number, number][] = [[-2 / FT, -2 / FT], [2 / FT, -2 / FT], [2 / FT, 2 / FT], [-2 / FT, 2 / FT]];
    arena.story = {
      triggers: [{ id: 232876, kind: 'flag', activation: 1, volume: { polygon: square, yMin: -100, yMax: 100 } }],
      cameras: [],
      sequences: [{
        name: 'seqNecros', trigger: 232876, actors: [{ player: true }, { creature: 22 }, { creature: 23 }],
        tracks: [{ actor: 2, steps: [0] }, { actor: 3, steps: [1] }, { actor: 4, steps: [2, 3] }],
        steps: [
          { action: 'Appear', when: null, args: { appear: 1, appearpos: [0, 0.5 / FT, -5 / FT] } },
          { action: 'Appear', when: null, args: { appear: 0, no_collide: 1 } },
          { action: 'Appear', when: null, args: { appear: 0, no_collide: 1 } },
          { action: 'Appear', when: null, args: { appear: 1 } },
        ],
      }],
    };
    const t = world(arena);
    t.zone.join(1, { name: 'Slayer', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 } });
    t.zone.step();
    expect(t.of(1, SC.CUTSCENE)).toHaveLength(1);
    t.zone.cutsceneDone(1, 'seqNecros');
    t.zone.step();
    const actors = [...t.internals.actors.values()] as unknown as { kind: string; placement?: number; hidden?: boolean; character: { position: { x: number; y: number; z: number } } }[];
    expect(actors.find((a) => a.placement === 22)!.hidden).toBe(true);
    expect(actors.find((a) => a.placement === 23)!.hidden).toBe(false);
    expect(actors.find((a) => a.kind === 'player')!.character.position.z).toBeCloseTo(-5, 0);
  });

  it('a finished character back on the ship (left during the timeline) goes on to the ending act', () => {
    const t = world(necrosShip());
    t.zone.join(1, { name: 'Slayer', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 }, story: { ...emptyStoryState(), completedAt: 5 } });
    t.zone.step();
    t.zone.step();
    expect(t.portals.map((p) => p.target)).toEqual(['level:cs5b']);
    expect(t.of(1, SC.ENDING)).toHaveLength(0);
  });

  it('the last scene (exit "end") loads nothing: Drake stays, the story complete', () => {
    const arena = createSyntheticArena();
    arena.name = 'level:cs5b';
    const square: [number, number][] = [[-10 * FT, -10 * FT], [10 * FT, -10 * FT], [10 * FT, 10 * FT], [-10 * FT, 10 * FT]];
    arena.story = {
      triggers: [{ id: 231582, kind: 'flag', activation: 1, volume: { polygon: square.map(([x, z]) => [x / FT, z / FT] as [number, number]), yMin: -100, yMax: 100 } }],
      cameras: [],
      sequences: [{
        name: 'Seq24', trigger: 231582, actors: [{ player: true }],
        tracks: [{ actor: 2, steps: [0] }],
        steps: [{ action: 'ScriptedSequenceDone', when: null, args: { seq: { sequence: 'Seq24' }, loadlevel: { exit: 'end', exitNumber: 1 } } }],
      }],
    };
    const t = world(arena);
    t.zone.join(1, { name: 'Slayer', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 } });
    t.zone.step();
    expect(t.of(1, SC.CUTSCENE)).toHaveLength(1);
    t.zone.cutsceneDone(1, 'Seq24');
    t.zone.step();
    expect(t.portals).toEqual([]);
    expect(t.saved.at(-1)?.story?.completedAt).toBeGreaterThan(0);
    expect(t.of(1, SC.CHAT_BROADCAST).some((m) => /finished the story/.test(JSON.stringify(m)))).toBe(true);
    expect(t.of(1, SC.PLAYER_STATS).at(-1)).toMatchObject({ d: { storyComplete: true } });
  });

  /** Cs5b in small: Aerin, a citizen and a guard; the inn door east, the road west; Seq24 around the start. */
  function endingAct() {
    const arena = createSyntheticArena();
    arena.name = 'level:cs5b';
    arena.mobSpawns = [
      { archetype: 'npc_152', x: 0, y: 0.5, z: -2, yaw: 0, placement: 0 },
      { archetype: 'npc_154', x: 1, y: 0.5, z: -2, yaw: 0, placement: 4 },
      { archetype: 'npc_113', x: -1, y: 0.5, z: -2, yaw: 0, placement: 12 },
    ];
    arena.portals = [
      { id: 0, target: 'level:cs2b-inn', x: 4, y: 0.5, z: -2, use: true },
      { id: 1, target: 'level:ws2a', x: -6, y: 0.5, z: -2 },
    ];
    const square: [number, number][] = [[-3 / FT, -3 / FT], [3 / FT, -3 / FT], [3 / FT, 3 / FT], [-3 / FT, 3 / FT]];
    arena.story = {
      triggers: [{ id: 231582, kind: 'flag', activation: 1, volume: { polygon: square, yMin: -100, yMax: 100 } }],
      cameras: [],
      sequences: [{
        name: 'Seq24', trigger: 231582, actors: [{ player: true }, { creature: 0 }],
        tracks: [{ actor: 2, steps: [0] }],
        steps: [{ action: 'ScriptedSequenceDone', when: null, args: { seq: { sequence: 'Seq24' }, loadlevel: { exit: 'end', exitNumber: 1 } } }],
      }],
    };
    return world(arena);
  }

  it("the ending act's cast is the arriving player's alone: the others see none of it, and it plays his scene", () => {
    const t = endingAct();
    expect(t.zone.inspect().filter((a) => a.kind === 'mob')).toHaveLength(0); // nobody spawns for the world
    t.zone.join(1, { name: 'Slayer', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 } });
    t.zone.join(2, { name: 'Veteran', characterId: 'c2', position: { x: 0.5, y: 0.5, z: 0.5 }, story: { ...emptyStoryState(), flags: ['cs5b:231582'], completedAt: 5 } });
    t.zone.step();
    t.zone.step();
    const mobs = t.zone.inspect().filter((a) => a.kind === 'mob');
    expect(mobs).toHaveLength(3); // one cast: the veteran has seen the scene
    const spawnedFor = (conn: number) => t.of(conn, SC.ENTITY_SPAWN).filter((m) => m.op === SC.ENTITY_SPAWN && m.d.kind === 'mob').length;
    expect(spawnedFor(1)).toBe(3);
    expect(spawnedFor(2)).toBe(0);
    const scene = t.of(1, SC.CUTSCENE)[0] as Extract<ServerControlMsg, { op: typeof SC.CUTSCENE }>;
    expect(scene.d.actors[1]).toBe(mobs.find((m) => m.x === 0)!.id);
    expect(t.of(2, SC.CUTSCENE)).toHaveLength(0);
  });

  it('when the last scene ends the cast walks off, citizens to the door, the others to the road, and is gone', () => {
    const t = endingAct();
    t.zone.join(1, { name: 'Slayer', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 } });
    t.zone.step();
    t.zone.cutsceneDone(1, 'Seq24');
    const at = () => Object.fromEntries(t.zone.inspect().filter((a) => a.kind === 'mob').map((a) => [a.id, a.x]));
    const start = at();
    for (let i = 0; i < 20; i++) t.zone.step();
    const later = at();
    const ids = Object.keys(start).map(Number).sort((a, b) => start[a]! - start[b]!); // guard, Aerin, citizen by x
    expect(later[ids[0]!]!).toBeLessThan(start[ids[0]!]!); // the guard heads west, to the road
    expect(later[ids[2]!]!).toBeGreaterThan(start[ids[2]!]!); // the citizen east, to the inn door
    for (let i = 0; i < 20 * 21; i++) t.zone.step();
    expect(t.zone.inspect().filter((a) => a.kind === 'mob')).toHaveLength(0);
  });

  it("a player leaving takes his cast with him", () => {
    const t = endingAct();
    t.zone.join(1, { name: 'Slayer', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 } });
    expect(t.zone.inspect().filter((a) => a.kind === 'mob')).toHaveLength(3);
    t.zone.leave(1);
    expect(t.zone.inspect().filter((a) => a.kind === 'mob')).toHaveLength(0);
  });

  it('the completion date is kept with the story, anything malformed dropped', () => {
    expect(sanitizeStoryState({ flags: [], quests: {}, completedAt: 1_760_000_000_000 }).completedAt).toBe(1_760_000_000_000);
    expect(sanitizeStoryState({ flags: [], quests: {}, completedAt: 'yesterday' }).completedAt).toBeUndefined();
    expect('completedAt' in sanitizeStoryState({ flags: [], quests: {} })).toBe(false);
  });

  it("the original's data: Necros on the ship, Cs5b's first start inside Seq24's trigger, Seq24 ends the game", () => {
    const levelsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../../local/generated/levels');
    if (!fs.existsSync(path.join(levelsDir, 'cs5b.placements.json'))) return;
    const read = (act: string) => JSON.parse(fs.readFileSync(path.join(levelsDir, `${act}.placements.json`), 'utf8')) as LevelPlacements;
    const ship = read('bs1a');
    expect(ship.creatures.some((c) => c.type === 150 && c.name === 'Necros')).toBe(true);
    expect(ship.portals ?? []).toEqual([]); // no way out but the ending
    const end = read('cs5b');
    const seq = end.story!.sequences.find((s) => s.name === 'Seq24')!;
    const trigger = end.story!.triggers.find((u) => u.id === seq.trigger)!;
    const [x, y, z] = end.starts![0]!.position;
    expect(inStoryVolume(trigger.volume!, x, y + 1, z)).toBe(true);
    expect(seq.steps.some((s) => s.action === 'ScriptedSequenceDone' && JSON.stringify(s.args['loadlevel']).includes('"end"'))).toBe(true);
    // Nothing else leads to Cs5b.
    for (const f of fs.readdirSync(levelsDir).filter((n) => n.endsWith('.placements.json'))) {
      const l = JSON.parse(fs.readFileSync(path.join(levelsDir, f), 'utf8')) as LevelPlacements;
      expect((l.portals ?? []).some((p) => p.target === 'cs5b'), f).toBe(false);
    }
  });
});

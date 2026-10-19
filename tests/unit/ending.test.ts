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

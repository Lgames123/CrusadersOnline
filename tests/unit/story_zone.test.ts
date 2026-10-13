import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone, type PersistRecord } from '@crusaders/server/simulation/world_zone';
import {
  INPUT,
  INPUT_PACKET_MAX_BYTES,
  LEVEL_UNIT_METRES,
  MAIN_QUESTS,
  QUEST_ACTION,
  QUEST_STATE,
  SC,
  createSyntheticArena,
  encodeInput,
  initPhysics,
  quantizeAngle,
  type LevelStory,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const FT = 1 / LEVEL_UNIT_METRES;

/**
 * A synthetic act: a flag trigger 4-8 m ahead of the spawn starts a sequence with one creature
 * actor; the sequence completes quest 1 (assigned before by a walk-in quest trigger at the
 * spawn), walks the stand-in to z = -10 m and loads another act.
 */
function storyZone(load = true) {
  const arena = createSyntheticArena();
  arena.name = 'level:t1a';
  arena.mesh = 't_a';
  arena.mobSpawns = [{ archetype: 'npc_118', x: 3, y: 0.5, z: -6, hp: 20, placement: 7 }];
  const square = (z0: number, z1: number): [number, number][] => [[-3 * FT, z0 * FT], [3 * FT, z0 * FT], [3 * FT, z1 * FT], [-3 * FT, z1 * FT]];
  const story: LevelStory = {
    triggers: [
      { id: 100, kind: 'flag', activation: 1, volume: { polygon: square(-8, -4), yMin: -10, yMax: 20 * FT } },
      { id: 200, kind: 'quest', activation: 1, volume: { polygon: square(-1, 1), yMin: -10, yMax: 20 * FT }, quest: { index: 1, main: true, actions: QUEST_ACTION.ASSIGN | QUEST_ACTION.JOURNAL_START, bit: 0 } },
      { id: 300, kind: 'quest', activation: 0x10, quest: { index: 1, main: true, actions: QUEST_ACTION.COMPLETE, bit: 0 } },
    ],
    cameras: [],
    sequences: [{
      name: 'Seq1',
      trigger: 100,
      actors: [{ player: true }, { creature: 7 }],
      tracks: [{ actor: 2, steps: [0, 1, 2] }],
      steps: [
        { action: 'TriggerFlag', when: null, args: { flag: { trigger: 300 }, triggerstate: 1 } },
        { action: 'MoveToPos', when: null, args: { pos: [0, 0.5 * FT, -10 * FT], movestate: 2 } },
        { action: 'ScriptedSequenceDone', when: { event: 4, track: 0, step: 1, key: 0 }, args: load ? { loadlevel: { exit: 'T2a', exitNumber: 0 } } : {} },
      ],
    }],
  };
  arena.story = story;
  const messages: ServerControlMsg[] = [];
  const portals: { target: string; keep?: { mesh: string } }[] = [];
  const saves: PersistRecord[] = [];
  const zone = new WorldZone(rapier, arena.name, arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
    portal: (_c, target, keep) => portals.push({ target, ...(keep ? { keep } : {}) }),
    persist: (records) => saves.push(...records),
  }, { random: () => 0.5 });
  zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 } });
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let tick = 0;
  const run = (ticks: number, flags = 0) => {
    for (let i = 0; i < ticks; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++tick, flags, yaw: quantizeAngle(0), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
    }
  };
  return { zone, run, messages, portals, saves };
}

describe('story triggers and sequences (server)', () => {
  it('walking into a trigger starts its sequence once; the outcome applies when it is done', () => {
    const t = storyZone();
    t.run(2);
    // The quest trigger at the spawn assigned quest 1.
    const logs = t.messages.filter((m) => m.op === SC.QUEST_LOG);
    expect(logs.at(-1)?.d).toMatchObject({ news: { assigned: [1] } });
    // Walk forward into the flag trigger.
    for (let i = 0; i < 200 && !t.messages.some((m) => m.op === SC.CUTSCENE); i++) t.run(1, INPUT.FORWARD);
    const cut = t.messages.find((m) => m.op === SC.CUTSCENE);
    expect(cut?.d).toMatchObject({ sequence: 'Seq1' });
    const actors = (cut!.d as { actors: (number | null)[] }).actors;
    expect(actors[0]).toBeNull();
    expect(actors[1]).toBeGreaterThan(0);
    // Inputs are ignored while it plays.
    const before = t.zone.characterOf(1)!.position.z;
    t.run(10, INPUT.FORWARD);
    expect(t.zone.characterOf(1)!.position.z).toBeCloseTo(before, 1);
    t.zone.cutsceneDone(1, 'Seq1');
    const done = t.messages.filter((m) => m.op === SC.QUEST_LOG).at(-1)!.d as { log: { main: number[] }; news: { completed: number[] } };
    expect(done.news.completed).toEqual([1]);
    expect(done.log.main[1]).toBe(QUEST_STATE.DONE);
    // Drake ends where the stand-in walked; the next act keeps that position (same mesh).
    expect(t.zone.characterOf(1)!.position.z).toBeCloseTo(-10, 0);
    expect(t.portals).toEqual([{ target: 'level:t2a', keep: expect.objectContaining({ mesh: 't_a' }) }]);
    // The reward is paid and the story saved.
    const last = t.saves.at(-1)!;
    expect(last.experience).toBe(MAIN_QUESTS[1]!.xp);
    expect(last.story.flags).toEqual(expect.arrayContaining(['t1a:100', 't1a:200', 't1a:300']));
  });

  it('the server finishes a sequence the client never reports', () => {
    const t = storyZone(false);
    for (let i = 0; i < 200 && !t.messages.some((m) => m.op === SC.CUTSCENE); i++) t.run(1, INPUT.FORWARD);
    expect(t.messages.some((m) => m.op === SC.CUTSCENE)).toBe(true);
    t.run(20 * 40);
    expect(t.zone.characterOf(1)!.position.z).toBeCloseTo(-10, 0);
    expect(t.portals).toEqual([]);
    // Walking back in does not play it again.
    const n = t.messages.filter((m) => m.op === SC.CUTSCENE).length;
    t.run(60, INPUT.BACK);
    t.run(60, INPUT.FORWARD);
    expect(t.messages.filter((m) => m.op === SC.CUTSCENE).length).toBe(n);
  });

  it('story progress comes back with the character', () => {
    const t = storyZone(false);
    t.run(2);
    const record = t.zone.leave(1)!;
    const again = storyZone(false);
    again.zone.leave(1);
    again.zone.join(2, { name: 'Tester', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 }, story: record.story });
    const log = again.messages.filter((m) => m.op === SC.QUEST_LOG).at(-1)!.d as { log: { main: number[]; journal: number[] } };
    expect(log.log.main[1]).toBe(QUEST_STATE.ACTIVE);
    expect(log.log.journal).toEqual([MAIN_QUESTS[1]!.journalStart]);
  });
});

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
  TICK_MS,
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
function storyZone(load = true, extra: Partial<LevelStory> = {}) {
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
  arena.story = { ...story, ...extra };
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

describe('start points', () => {
  it("a character with nowhere to resume begins at the act's first start point, facing its way", () => {
    const arena = createSyntheticArena();
    arena.starts = [{ x: 2, y: 0.5, z: -3, yaw: -Math.PI / 2 }, { x: 9, y: 0.5, z: 9, yaw: 0 }];
    const messages: ServerControlMsg[] = [];
    const zone = new WorldZone(rapier, arena.name, arena, {
      send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
      portal: () => { },
      persist: () => { },
    });
    zone.join(1, { name: 'New', characterId: 'c1', position: null, yaw: 1234 });
    zone.join(2, { name: 'Saved', characterId: 'c2', position: { x: 0, y: 0.5, z: 0 }, yaw: quantizeAngle(1) });
    const enters = messages.flatMap((m) => (m.op === SC.WORLD_ENTER ? [m.d] : []));
    expect(enters[0]!.spawn).toMatchObject({ x: 2, z: -3 });
    expect(enters[0]!.yaw).toBeCloseTo((3 * Math.PI) / 2, 3); // -90°, as [0, 2π)
    expect(enters[1]!.spawn).toMatchObject({ x: 0, z: 0 });
    expect(enters[1]!.yaw).toBeCloseTo(1, 3);
  });
});

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

  it('a walk-in sound trigger plays its line on entering: a 0x200 one once, others each time', () => {
    const square = (z0: number, z1: number): [number, number][] => [[-3 * FT, z0 * FT], [3 * FT, z0 * FT], [3 * FT, z1 * FT], [-3 * FT, z1 * FT]];
    const sound = (id: number) => ({ id, positions: [[0, 0, -3 * FT]] as [number, number, number][], volume: 1 });
    const t = storyZone(false, {
      triggers: [],
      sequences: [],
      soundTriggers: [
        { id: 500, activation: 0x201, volume: { polygon: square(-4, -2), yMin: -10, yMax: 20 * FT }, sound: sound(721) },
        { id: 501, activation: 0x001, volume: { polygon: square(-4, -2), yMin: -10, yMax: 20 * FT }, sound: sound(871) },
      ],
    });
    const played = () => t.messages.flatMap((m) => (m.op === SC.STORY_SOUND ? [m.d.sound] : []));
    t.run(2);
    expect(played()).toEqual([]);
    for (let i = 0; i < 60 && !played().length; i++) t.run(1, INPUT.FORWARD);
    expect(played().sort()).toEqual([721, 871]);
    // Out and back in: only the one without 0x200 plays again.
    t.run(60, INPUT.BACK);
    for (let i = 0; i < 60 && played().length < 3; i++) t.run(1, INPUT.FORWARD);
    expect(played().sort()).toEqual([721, 871, 871]);
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

describe('script-fired message triggers (relays, deaths)', () => {
  /** A hostile at placement 4 whose death fires relay 500; a walk-in relay 600 with a timer. */
  function messageZone() {
    const arena = createSyntheticArena();
    arena.name = 'level:t1a';
    arena.mobSpawns = [{ archetype: 'ogre_outlaw', x: 6, y: 0.5, z: 6, hp: 10, placement: 4 }];
    const square = (z0: number, z1: number): [number, number][] => [[-3 * FT, z0 * FT], [3 * FT, z0 * FT], [3 * FT, z1 * FT], [-3 * FT, z1 * FT]];
    arena.story = {
      triggers: [
        // Du2a's OgreOutlaw7: quest progress and "Got Dain's Scepter…", with a 100 ms timer that a death skips.
        { id: 500, kind: 'relay', activation: 0x12, delay: 100, targets: [{ trigger: 510 }, { message: 520 }, { exit: 'du9a', exitNumber: 111 }] },
        { id: 510, kind: 'quest', activation: 0x10, quest: { index: 1, main: true, actions: QUEST_ACTION.ASSIGN, bit: 0 } },
        // Cs4b: walking over the line shows "Got Talisman of True Sight" 7 s later, once.
        { id: 600, kind: 'relay', activation: 0x201, volume: { polygon: square(-1, 1), yMin: -10, yMax: 20 * FT }, delay: 7000, targets: [{ message: 620 }] },
      ],
      messages: [
        { id: 520, activation: 0x12, message: 18, text: "Got Dain's Scepter and Dasher Necklace" },
        { id: 620, activation: 1, message: 25, text: 'Got Talisman of True Sight' },
      ],
      deaths: [{ creature: 4, trigger: 500 }],
      cameras: [],
      sequences: [],
    };
    const messages: ServerControlMsg[] = [];
    const zone = new WorldZone(rapier, arena.name, arena, {
      send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
      portal: () => { },
      persist: () => { },
    }, { random: () => 0.5 });
    zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 0, y: 0.5, z: 20 } });
    const internals = zone as unknown as {
      players: Map<number, unknown>;
      actors: Map<number, { kind: string; placement?: number; hp: number }>;
      applyDamage(a: unknown, t: unknown, v: number[]): void;
    };
    const shown = () => messages.flatMap((m) => (m.op === SC.STORY_MESSAGE ? [m.d.message] : []));
    return { zone, internals, messages, shown };
  }

  it("a creature's death fires its relay at once: the killer sees the message and gets the quest", () => {
    const t = messageZone();
    const ogre = [...t.internals.actors.values()].find((a) => a.kind === 'mob' && a.placement === 4)!;
    t.internals.applyDamage(t.internals.players.get(1), ogre, new Array(11).fill(1000));
    expect(ogre.hp).toBe(0);
    expect(t.shown()).toEqual([520]);
    expect(t.messages.some((m) => m.op === SC.QUEST_LOG && m.d.news?.assigned.includes(1))).toBe(true);
  });

  it("a walked-into relay shows its message after its timer, once per character", () => {
    const t = messageZone();
    t.zone.leave(1);
    t.zone.join(2, { name: 'Tester', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 } });
    t.zone.step();
    expect(t.shown()).toEqual([]);
    for (let i = 0; i < Math.ceil(7000 / TICK_MS) + 1; i++) t.zone.step();
    expect(t.shown()).toEqual([620]);
    for (let i = 0; i < Math.ceil(8000 / TICK_MS); i++) t.zone.step();
    expect(t.shown()).toEqual([620]);
  });
});

describe('relay ops (0x463CC0)', () => {
  /**
   * A hostile at placement 3 behind the player's back and 30 m away (unnoticed); relays: a
   * death-style one with a sound and an exit, Ws5a's creature ops, and a use-key one (bit 3)
   * whose volume is around the player.
   */
  function opsZone() {
    const arena = createSyntheticArena();
    arena.name = 'level:t1a';
    arena.mobSpawns = [{ archetype: 'skeleton_warrior', x: 0, y: 0.5, z: -15, placement: 3 }];
    arena.portals = [{ id: 0, target: 'level:du9a', x: 2, y: 0.5, z: 10, exit: 111, scripted: true }];
    const square = (z0: number, z1: number): [number, number][] => [[-3 * FT, z0 * FT], [3 * FT, z0 * FT], [3 * FT, z1 * FT], [-3 * FT, z1 * FT]];
    arena.story = {
      triggers: [
        { id: 700, kind: 'relay', activation: 0x12, targets: [{ exit: 'Du9a', exitNumber: 111 }], sounds: [{ id: 517, positions: [[10 * FT, 0, -20 * FT]], volume: 1 }] },
        { id: 710, kind: 'relay', activation: 0x301, targets: [], creatureOps: [{ op: 'targetPlayer', creature: 3 }] },
        { id: 720, kind: 'relay', activation: 0x301, targets: [], creatureOps: [{ op: 'fightNearest', creature: 3 }, { op: 'attackTarget', creature: 3, other: 9 }] },
        { id: 730, kind: 'relay', activation: 8, volume: { polygon: square(14, 16), yMin: -10, yMax: 20 * FT }, targets: [], sounds: [{ id: 513, positions: [[0, 0, 0]], volume: 0.5 }] },
      ],
      cameras: [],
      sequences: [],
    };
    const messages: { conn: number; msg: ServerControlMsg }[] = [];
    const portals: { target: string; crossing?: unknown }[] = [];
    const zone = new WorldZone(rapier, arena.name, arena, {
      send: (c, data) => { if (typeof data === 'string') messages.push({ conn: c, msg: JSON.parse(data) as ServerControlMsg }); },
      portal: (_c, target, _keep, crossing) => portals.push({ target, ...(crossing ? { crossing } : {}) }),
      persist: () => { },
    }, { random: () => 0.5 });
    zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 0, y: 0.5, z: 15 } });
    const internals = zone as unknown as {
      players: Map<number, unknown>;
      actors: Map<number, { kind: string; placement?: number; state?: string; threat?: Map<number, number>; entityId: number }>;
      fireTrigger(p: unknown, t: unknown): void;
    };
    const fire = (id: number, conn = 1) => internals.fireTrigger(internals.players.get(conn), arena.story!.triggers.find((t) => t.id === id));
    const mob = () => [...internals.actors.values()].find((a) => a.kind === 'mob' && a.placement === 3)!;
    const sounds = (conn: number) => messages.flatMap((m) => (m.conn === conn && m.msg.op === SC.STORY_SOUND ? [m.msg.d] : []));
    return { zone, fire, mob, sounds, portals, internals };
  }

  it('an exit target takes the player to its level, through the matching exit, after the other ops', () => {
    const t = opsZone();
    t.zone.join(2, { name: 'Other', characterId: 'c2', position: { x: 4, y: 0.5, z: 15 } });
    t.fire(700);
    expect(t.portals).toEqual([{ target: 'level:du9a', crossing: expect.objectContaining({ exit: 111 }) }]);
    // Its sound trigger plays for everyone in the zone, at its position in metres.
    for (const conn of [1, 2]) {
      expect(t.sounds(conn)).toHaveLength(1);
      expect(t.sounds(conn)[0]).toMatchObject({ sound: 517, volume: 1 });
      expect(t.sounds(conn)[0]!.positions[0]![0]).toBeCloseTo(10, 3);
      expect(t.sounds(conn)[0]!.positions[0]![2]).toBeCloseTo(-20, 3);
    }
  });

  it('targetPlayer sends a hostile creature after the player at once, unseen', () => {
    const t = opsZone();
    for (let i = 0; i < 20; i++) t.zone.step();
    expect(t.mob().state).toBe('idle');
    t.fire(710);
    expect(t.mob().state).toBe('chase');
    expect(t.mob().threat!.has([...t.internals.actors.values()].find((a) => a.kind === 'player')!.entityId)).toBe(true);
  });

  it('fightNearest makes a hostile creature notice a player in sight at any range and angle', () => {
    const t = opsZone();
    for (let i = 0; i < 20; i++) t.zone.step();
    expect(t.mob().state).toBe('idle');
    t.fire(720); // its attackTarget names a creature the act lacks: nothing
    t.zone.step();
    expect(t.mob().state).toBe('chase');
  });

  it('a use-key relay fires when the player presses use inside its volume, not by walking in', () => {
    const t = opsZone();
    for (let i = 0; i < 5; i++) t.zone.step();
    expect(t.sounds(1)).toEqual([]);
    t.zone.interact(1, 123456); // whatever the use key aims at
    expect(t.sounds(1)).toEqual([{ sound: 513, positions: [[0, 0, 0]], volume: 0.5 }]);
    // Outside the volume the use key does nothing.
    const away = opsZone();
    away.zone.leave(1);
    away.zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 0, y: 0.5, z: 5 } });
    away.zone.interact(1, 123456);
    expect(away.sounds(1)).toEqual([]);
  });
});

describe('an exit fired by learning a spell (activation 0x10000, Gl3c)', () => {
  /** Gl3c: the Revelation book lies on the exit pad; relay 72827 (0x10000) fires the exit to Gl4c. */
  function padZone() {
    const arena = createSyntheticArena();
    arena.name = 'level:gl3c';
    const pad: [number, number][] = [[-3, -3], [3, -3], [3, 3], [-3, 3]];
    arena.portals = [{ id: 0, target: 'level:gl4c', x: 0, y: 0.5, z: 0, exit: 119, onLearn: true, trigger: { polygon: pad, yMin: -1, yMax: 3 } }];
    arena.story = {
      triggers: [{ id: 72827, kind: 'relay', activation: 0x10000, volume: { polygon: pad.map(([x, z]) => [x * FT, z * FT] as [number, number]), yMin: -10, yMax: 10 * FT }, targets: [{ exit: 'gl4c', exitNumber: 119 }] }],
      cameras: [],
      sequences: [],
    };
    const portals: string[] = [];
    const zone = new WorldZone(rapier, arena.name, arena, { send: () => {}, portal: (_c, target) => portals.push(target), persist: () => {} }, { random: () => 0.5 });
    zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 0, y: 0.5, z: 5 } });
    const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
    let tick = 0;
    const run = (ticks: number, flags = 0, yaw = 0) => {
      for (let i = 0; i < ticks; i++) {
        const len = encodeInput(buf, 0, [{ clientTick: ++tick, flags, yaw: quantizeAngle(yaw), pitch: 0 }]);
        zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
        zone.step();
      }
    };
    const internals = zone as unknown as { players: Map<number, unknown>; learnSpell(p: unknown, spell: string): boolean };
    return { zone, portals, run, learn: () => internals.learnSpell(internals.players.get(1), 'revelation') };
  }

  it('walking onto the pad does nothing; learning the spell there takes the exit', () => {
    const t = padZone();
    t.run(30, INPUT.FORWARD); // onto the pad and past it
    t.run(20, INPUT.FORWARD, Math.PI); // back onto it
    expect(t.portals).toEqual([]);
    t.learn();
    expect(t.portals).toEqual(['level:gl4c']);
  });

  it('who already learned it there walks in again (a way back)', () => {
    const t = padZone();
    t.run(13, INPUT.FORWARD);
    t.learn();
    t.portals.length = 0;
    t.run(40, INPUT.FORWARD); // off the pad
    t.run(30, INPUT.FORWARD, Math.PI); // and back onto it
    expect(t.portals).toContain('level:gl4c');
  });
});

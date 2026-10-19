import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { INPUT_PACKET_MAX_BYTES, SC, createSyntheticArena, encodeInput, initPhysics, quantizeAngle, type CustomSpawnSpec, type Rapier, type ServerControlMsg } from '@crusaders/shared';

/** The zone side of the admin panel: event rates on kills, custom creatures (not original). */
let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

function setup() {
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'test', createSyntheticArena(), {
    send: (_conn, data) => {
      if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg);
    },
    persist: () => {},
  }, { random: () => 0 });
  const me = zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 5, y: 0.5, z: 5 } });
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let tick = 0;
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++tick, flags: 0, yaw: quantizeAngle(0), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
    }
  };
  const notices = () => messages.filter((m) => m.op === SC.CHAT_BROADCAST).map((m) => (m.d as { text: string }).text);
  // The zone's private combat, to kill and to weigh a blow without a fight.
  const internals = zone as unknown as {
    actors: Map<number, unknown>;
    loseHp(a: unknown, t: unknown, damage: number): void;
    rollDamage(a: unknown, combo: number): number[];
  };
  const kill = (id: number) => internals.loseHp(internals.actors.get(me), internals.actors.get(id), 1e6);
  return { zone, run, notices, kill, internals };
}

const spec = (over: Partial<CustomSpawnSpec> = {}): CustomSpawnSpec => ({
  id: 'spawn-1', archetype: 'skeleton_warrior', count: 3, at: { player: 'Tester' }, scale: 1, damage: 1, speed: 1, respawn: false, minutes: 60,
  aggressive: false, expiresAt: Date.now() + 60_000, ...over,
});

describe('admin panel in the zone', () => {
  it('pays kills at the event rates', () => {
    const t = setup();
    const [a] = t.zone.spawnCustom(spec({ count: 1, xp: 100, goldMin: 7, goldMax: 7 }));
    t.zone.setRates({ xp: 2, gold: 3, drops: 1, respawn: 1 });
    t.kill(a!);
    expect(t.notices()).toEqual(expect.arrayContaining(['You gain 200 experience.', 'You receive 21 gold.']));
  });

  it('spawns named custom creatures that leave once killed, on removal or when they run out', () => {
    const t = setup();
    const ids = t.zone.spawnCustom(spec({ name: 'Big Bones', hp: 10, damage: 0.5 }));
    expect(ids).toHaveLength(3);
    expect(t.zone.adminReport().spawns).toEqual([{ id: 'spawn-1', total: 3, alive: 3 }]);
    // Half the blow of a plain skeleton warrior.
    const plain = t.zone.spawnCustom(spec({ id: 'plain', count: 1 }))[0]!;
    const sum = (v: number[]) => v.reduce((x, y) => x + y, 0);
    expect(sum(t.internals.rollDamage(t.internals.actors.get(ids[0]!), 1))).toBeCloseTo(sum(t.internals.rollDamage(t.internals.actors.get(plain), 1)) / 2);
    t.zone.despawnCustom('plain');

    t.kill(ids[0]!);
    t.run(1);
    expect(t.zone.adminReport().spawns).toEqual([{ id: 'spawn-1', total: 3, alive: 2 }]);
    // Its corpse time over, it does not come back.
    t.run(20 * 60);
    expect(t.zone.adminReport().spawns).toEqual([{ id: 'spawn-1', total: 2, alive: 2 }]);
    expect(t.zone.despawnCustom('spawn-1')).toBe(2);
    expect(t.zone.adminReport().spawns).toEqual([]);

    t.zone.spawnCustom(spec({ id: 'old', expiresAt: Date.now() - 1 }));
    t.run(20);
    expect(t.zone.adminReport().spawns).toEqual([]);
  });

  it('refuses a creature type or a player it does not know', () => {
    const t = setup();
    expect(() => t.zone.spawnCustom(spec({ archetype: 'dragon' }))).toThrow(/Unknown creature type/);
    expect(() => t.zone.spawnCustom(spec({ at: { player: 'Nobody' } }))).toThrow(/Nobody is not in test/);
  });
});

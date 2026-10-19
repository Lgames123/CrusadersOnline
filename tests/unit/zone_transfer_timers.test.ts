import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  INPUT_PACKET_MAX_BYTES,
  SC,
  SPELL_CONJURE_TICKS,
  createSyntheticArena,
  encodeInput,
  initPhysics,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

type Msg<O> = Extract<ServerControlMsg, { op: O }>;

function zone(name: string) {
  const messages: ServerControlMsg[] = [];
  const z = new WorldZone(rapier, name, createSyntheticArena(), {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { random: () => 0 });
  const last = <O extends ServerControlMsg['op']>(op: O) => messages.filter((m) => m.op === op).at(-1) as Msg<O> | undefined;
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let clientTick = 0;
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++clientTick, flags: 0, yaw: 0, pitch: 0 }]);
      z.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      z.step();
    }
  };
  return { zone: z, last, run };
}

/** A player with heroism up, Torch Light lit and a healing potion just drunk, handed over by a transfer. */
function transferred() {
  const a = zone('a');
  a.zone.join(1, {
    name: 'Drake', characterId: null, position: { x: 0, y: 0.5, z: 0 }, experience: 100_000,
    spells: [{ spell: 'torch_light', level: 1 }, { spell: 'heroism', level: 1 }], selectedSpell: 'heroism',
    inventory: [
      { slot: 0, itemId: 'long_sword', equipped: true },
      { slot: 1, itemId: 'wooden_shield', equipped: true },
      { slot: 2, itemId: 'healing_potion', equipped: false, quantity: 2, x: 0, y: 0 },
    ],
  });
  a.run(5);
  a.zone.castSpell(1);
  a.run(SPELL_CONJURE_TICKS + 50);
  a.zone.selectSpell(1, 'torch_light');
  a.zone.castSpell(1);
  a.run(SPELL_CONJURE_TICKS + 50);
  a.zone.useItem(1, 2);
  a.run(2);
  const before = a.last(SC.PLAYER_STATS)!.d;
  expect(before.statuses?.map((s) => s.tag).sort()).toEqual(['HERO', 'SPED']);
  expect(before.light).toBeGreaterThan(0);
  const r = a.zone.leaveForTransfer(1)!;
  return { before, state: r.state };
}

describe('zone transfers keep running timers', () => {
  it('spell effects, the torch light and potion cooldowns carry on in the next zone', () => {
    const { before, state } = transferred();
    const b = zone('b');
    b.zone.join(1, { ...state, position: { x: 0, y: 0.5, z: 0 } });
    const stats = b.last(SC.PLAYER_STATS)!.d;
    expect(stats.statuses?.map((s) => s.tag).sort()).toEqual(['HERO', 'SPED']);
    const hero = (d: typeof stats) => d.statuses!.find((s) => s.tag === 'HERO')!.seconds;
    expect(hero(stats)).toBeGreaterThan(hero(before) - 1);
    expect(hero(stats)).toBeLessThanOrEqual(hero(before));
    expect(stats.speed).toBeCloseTo(before.speed!, 5);
    expect(stats.light).toBeCloseTo(before.light!, 5);
    const potion = b.last(SC.INVENTORY_UPDATE)!.d.items.find((i) => i.itemId === 'healing_potion')!;
    expect(potion.cooldownLeft).toBeGreaterThan(0);
  });

  it('time spent between zones counts: what ran out meanwhile is gone', () => {
    const { state } = transferred();
    state.carried!.at -= 10 * 60_000;
    const b = zone('b');
    b.zone.join(1, { ...state, position: { x: 0, y: 0.5, z: 0 } });
    const stats = b.last(SC.PLAYER_STATS)!.d;
    expect(stats.statuses ?? []).toEqual([]);
    expect(stats.light).toBe(0);
    expect(b.last(SC.INVENTORY_UPDATE)!.d.items.find((i) => i.itemId === 'healing_potion')!.cooldownLeft).toBeUndefined();
  });
});

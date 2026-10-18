import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  INPUT_PACKET_MAX_BYTES,
  MANA_REGEN_TICKS,
  SC,
  SPELL_CONJURE_TICKS,
  catalogFromItemRules,
  createSyntheticArena,
  decodeSpells,
  encodeInput,
  encodeSpells,
  initPhysics,
  spellTableFromRules,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

type StatsMsg = Extract<ServerControlMsg, { op: typeof SC.PLAYER_STATS }>['d'];

/** A zone with a Torch Light spell book on the ground next to the spawn (the skeleton is far away). */
function setup() {
  const arena = createSyntheticArena();
  arena.objects = [{ id: 0, kind: 'item', x: 1, y: 0.5, z: 0, item: { name: 'Torch Light Spell Book', quantity: 1 } }];
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'spells', arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { random: () => 0 });
  zone.join(1, { name: 'Caster', characterId: null, position: { x: 0, y: 0.5, z: 0 } });
  const stats = (): StatsMsg => (messages.filter((m) => m.op === SC.PLAYER_STATS).at(-1) as Extract<ServerControlMsg, { op: typeof SC.PLAYER_STATS }>).d;
  // One empty input per tick (the character only steps - and lands - on its inputs).
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let clientTick = 0;
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++clientTick, flags: 0, yaw: 0, pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
    }
  };
  return { zone, stats, run };
}

describe('spells', () => {
  it('Drake starts with Torch Light at level 1; it conjures 1.54 s, costs mana and lights', () => {
    const t = setup();
    t.run(10); // land on the floor
    expect(t.stats().spells).toEqual([{ spell: 'torch_light', level: 1 }]); // 0x004BC980
    expect(t.stats().spell).toBe('torch_light');
    const mana = t.stats().mana;
    expect(mana).toBe(t.stats().maxMana);

    t.zone.castSpell(1);
    t.run(SPELL_CONJURE_TICKS + 2);
    expect(t.stats().light).toBe(0); // still conjuring, then the clip up to its SPELL event (PK01 frame 9)
    t.run(6);
    expect(t.stats().mana).toBe(mana - 1); // S0 level 1 costs 1
    expect(t.stats().light).toBeCloseTo(15 * 0.3048, 3);

    // Recasting while the light is on spends nothing (logged in the original).
    t.run(20);
    t.zone.castSpell(1);
    t.run(SPELL_CONJURE_TICKS + 30);
    expect(t.stats().mana).toBe(mana - 1);

    // One mana point comes back 5 s after it was spent (0x004BCFC0).
    t.run(MANA_REGEN_TICKS);
    expect(t.stats().mana).toBe(mana);
  });

  it('a Torch Light book raises the known spell to level 2, which costs 2 mana and lights 30 ft', () => {
    const t = setup();
    t.run(10);
    t.zone.interact(1, 0);
    t.run(1);
    expect(t.stats().spells).toEqual([{ spell: 'torch_light', level: 2 }]); // 0x004BCD10
    const mana = t.stats().mana;
    t.zone.castSpell(1);
    t.run(SPELL_CONJURE_TICKS + 8);
    expect(t.stats().mana).toBe(mana - 2); // S0 level 2 costs 2
    expect(t.stats().light).toBeCloseTo(30 * 0.3048, 3);
  });

  it('reads the spell table and spell books from the converted rules, and stores known spells', () => {
    const table = spellTableFromRules({ '1': [[2, 10, 20, 12, 0], [1, 5, 10, 10, 0]] });
    expect(table.fireball?.[0]).toEqual({ mana: 5, duration: 10, value1: 10, value2: 0 });
    expect(table.torch_light?.length).toBe(3); // the slice values stay
    const catalog = catalogFromItemRules({
      items: [
        { name: 'Torch Light Spell Book', fields: { Type: 'SPELLBOOK', Use: 'GRANT_SPELL', Price: 100 }, damage: {}, protection: {}, calls: [{ name: 'UseParameters', args: ['TORCH_LIGHT'] }] },
        { name: 'Revelation Spell Book', fields: { Type: 'SPELLBOOK', Use: 'GRANT_SPELL', Price: 100 }, damage: {}, protection: {}, calls: [{ name: 'UseParameters', args: ['SOLIDIFY'] }] },
      ],
    });
    expect(catalog.get('revelation_spell_book')).toMatchObject({ type: 'spellbook', spell: 'revelation' });
    expect(decodeSpells(encodeSpells([{ spell: 'torch_light', level: 2 }, { spell: 'fireball', level: 1 }]))).toEqual([
      { spell: 'torch_light', level: 2 },
      { spell: 'fireball', level: 1 },
    ]);
    expect(decodeSpells('bogus:3,torch_light:9')).toEqual([{ spell: 'torch_light', level: 3 }]);
  });
});

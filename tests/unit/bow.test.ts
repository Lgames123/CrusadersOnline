import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  BOOMER_THROW,
  INPUT_PACKET_MAX_BYTES,
  SC,
  TICK_DT,
  catalogFromItemRules,
  createSyntheticArena,
  encodeInput,
  initPhysics,
  quantizeAngle,
  type InventoryEntry,
  type Rapier,
  type ServerControlMsg,
  type SpellEventMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

type Projectile = NonNullable<SpellEventMsg['d']['projectile']>;

describe('the Dasher Hand Bow shoots arrows (Use SHOOT)', () => {
  const RULES: Parameters<typeof catalogFromItemRules>[0] = { items: [
    { name: 'Axe', parent: null, fields: { Type: 'WEAPON', SubType: 'MELEE', Model: 71, Width: 1, Height: 3, Price: 100, Speed: 1.1 }, damage: { SLASH: 5, BASH: 5 }, protection: {}, calls: [] },
    { name: 'Dasher Hand Bow', parent: 'Axe', fields: { Type: 'WEAPON', SubType: 'MISSILE', Model: 79, Width: 1, Height: 3, Price: 200, Speed: 1, Use: 'SHOOT' }, damage: { SLASH: 18, BASH: 0 }, protection: {}, calls: [{ name: 'UseParameters', args: ['ARROW'] }] },
  ] };
  const items = catalogFromItemRules(RULES);

  it('reads Use SHOOT', () => {
    expect(items.get('dasher_hand_bow')!.shoot).toBe(true);
    expect(items.get('axe')!.shoot).toBeUndefined();
  });

  /** A player at the origin facing -z (holding `weapon`); a skeleton `mobZ` metres off, with `mobWeapon`. */
  function zoneWith(mobZ: number | null, weapon: string, mobWeapon?: string) {
    const arena = createSyntheticArena();
    arena.mobSpawns = mobZ === null ? [] : [{ x: 0, y: 0.5, z: mobZ, yaw: Math.PI, archetype: 'skeleton_warrior', shield: null, ...(mobWeapon ? { weapon: mobWeapon } : {}) }];
    const messages: ServerControlMsg[] = [];
    const zone = new WorldZone(rapier, 'bow', arena, {
      send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
    }, { random: () => 0, items });
    const inventory: InventoryEntry[] = [{ slot: 0, itemId: weapon, equipped: true }];
    const me = zone.join(1, { name: 'Tester', characterId: null, position: { x: 0, y: 0.5, z: 0 }, experience: 0, inventory });
    const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
    let clientTick = 0;
    const step = () => {
      const len = encodeInput(buf, 0, [{ clientTick: ++clientTick, flags: 0, yaw: quantizeAngle(0), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
    };
    const arrows = () => messages.flatMap((m) => (m.op === SC.SPELL_EVENT ? [(m as SpellEventMsg).d.projectile] : [])).filter((p): p is Projectile => p?.spell === 'arrow');
    const hits = (attacker: number) => messages.flatMap((m) => (m.op === SC.COMBAT_EVENT && m.d.attacker === attacker && m.d.damage > 0 ? [m.d] : []));
    const swings = () => zone.inspect().find((a) => a.id === me)!.swinging;
    for (let i = 0; i < 10; i++) step();
    return { zone, me, messages, step, arrows, hits, swings };
  }

  it('an attack looses an arrow at the throw clip release, no swing; it strikes a creature 8 m off', () => {
    const z = zoneWith(-8, 'dasher_hand_bow');
    z.zone.attack(1);
    let loosedAt = -1;
    let swung = false;
    for (let i = 0; i < 60; i++) {
      z.step();
      swung ||= z.swings();
      if (loosedAt < 0 && z.arrows().length) loosedAt = i + 1;
    }
    expect(swung).toBe(false);
    expect(loosedAt * TICK_DT).toBeCloseTo(BOOMER_THROW.release, 1);
    expect(z.arrows().at(-1)!.end).toBe(true);
    // Its own direction: along the view (-z).
    expect(z.arrows()[0]!.vel[2]).toBeLessThan(0);
    expect(z.hits(z.me).length).toBe(1);
  });

  it('a creature holding the bow shoots the player from range', () => {
    const z = zoneWith(-9, 'axe', 'dasher_hand_bow');
    const mob = z.zone.inspect().find((a) => a.id !== z.me)!.id;
    for (let i = 0; i < 200 && !z.hits(mob).length; i++) z.step();
    expect(z.arrows().length).toBeGreaterThan(0);
    expect(z.hits(mob).length).toBeGreaterThan(0);
  });
});

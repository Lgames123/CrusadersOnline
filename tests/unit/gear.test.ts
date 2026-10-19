import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  DAMAGE_TYPES,
  INPUT,
  INPUT_PACKET_MAX_BYTES,
  SC,
  USE_MASK,
  catalogFromItemRules,
  createSyntheticArena,
  encodeInput,
  equipmentOf,
  initPhysics,
  quantizeAngle,
  type ArenaDef,
  type InventoryEntry,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const FT = 0.3048;
const t = (name: string) => DAMAGE_TYPES.indexOf(name as (typeof DAMAGE_TYPES)[number]);

/** items.ctx rows as the converter writes them: calls only on the item that makes them. */
const RULES: Parameters<typeof catalogFromItemRules>[0] = { items: [
  { name: 'Axe', parent: null, fields: { Type: 'WEAPON', SubType: 'MELEE', Model: 71, Width: 1, Height: 3, Price: 100, Speed: 1.1 }, damage: { SLASH: 5, BASH: 5 }, protection: {}, calls: [] },
  { name: 'Soul Sucker', parent: 'Axe', fields: { Type: 'WEAPON', SubType: 'MELEE', Model: 117, Width: 1, Height: 3, Price: 1000, Speed: 0.95, Name: 'Blade of Hunger', Use: 'DRINK_SOUL' }, damage: { SLASH: 10, BASH: 0 }, protection: {}, calls: [{ name: 'UseParameters', args: [1] }, { name: 'UseParameters', args: ['GIANTS'] }] },
  { name: 'Rod of Necros', parent: 'Axe', fields: { Type: 'WEAPON', SubType: 'MELEE', Model: 244, Texture: 1, Width: 1, Height: 3, Price: 10, Speed: 0.9, Use: 'DRINK_SOUL' }, damage: { BASH: 20, DARK: 20 }, protection: {}, calls: [{ name: 'UseParameters', args: [5] }] },
  { name: 'Fist of Necros', parent: 'Axe', fields: { Type: 'WEAPON', SubType: 'MELEE', Model: 76, Width: 1, Height: 3, Price: 10, Speed: 0.9, Equip: 'BOOST_PROTECTION' }, damage: { BASH: 10, DARK: 15 }, protection: {}, calls: [{ name: 'EquipParameters', args: [-1, 'LIGHT', 0.5] }] },
  { name: 'Boomer Axe', parent: 'Axe', fields: { Type: 'WEAPON', SubType: 'THROWABLE', Model: 71, Texture: 1, Width: 1, Height: 3, Price: 1600, Speed: 1, Permanent: 'true', Use: 'BOOMER' }, damage: { SLASH: 20 }, protection: {}, calls: [] },
  { name: 'Dasher Hand Bow', parent: 'Axe', fields: { Type: 'WEAPON', SubType: 'MISSILE', Model: 79, Width: 1, Height: 3, Price: 200, Speed: 1, Use: 'SHOOT' }, damage: { SLASH: 18 }, protection: {}, calls: [{ name: 'UseParameters', args: ['ARROW'] }] },
  { name: 'Wooden Shield', parent: null, fields: { Type: 'SHIELD', Model: 86, Width: 2, Height: 2, Price: 30, Use: 'BLOCK' }, damage: {}, protection: {}, calls: [] },
  { name: 'Shield of Mighty Deeds', parent: 'Wooden Shield', fields: { Type: 'SHIELD', Model: 86, Width: 2, Height: 2, Price: 650, Use: 'BLOCK', Equip: 'BOOST_ATTRIBUTE' }, damage: {}, protection: {}, calls: [{ name: 'EquipParameters', args: [-1, 'MIGHT', 5] }] },
  { name: 'Ice Shield', parent: 'Wooden Shield', fields: { Type: 'SHIELD', Model: 28, Texture: 3, Width: 2, Height: 2, Price: 500, Use: 'BLOCK' }, damage: {}, protection: { WATER: 0.6 }, calls: [] },
  { name: 'Fire Shield', parent: 'Wooden Shield', fields: { Type: 'SHIELD', Model: 28, Width: 2, Height: 2, Price: 500, Use: 'BLOCK' }, damage: {}, protection: { FIRE: 0.6 }, calls: [{ name: 'UseParameters', args: ['FIREBALL'] }] },
  { name: 'Reflective Shield', parent: 'Wooden Shield', fields: { Type: 'SHIELD', Model: 28, Texture: 1, Width: 2, Height: 2, Price: 800, Use: 'REFLECT' }, damage: {}, protection: {}, calls: [{ name: 'UseParameters', args: ['LIGHTNING'] }] },
  { name: 'Vampiric Shield', parent: 'Wooden Shield', fields: { Type: 'SHIELD', Model: 28, Texture: 2, Width: 2, Height: 2, Price: 1000, Use: 'DRINK_SOUL' }, damage: {}, protection: {}, calls: [{ name: 'UseParameters', args: [3] }] },
  { name: 'Giant Shield', parent: 'Wooden Shield', fields: { Type: 'SHIELD', Model: 86, Width: 2, Height: 2, Price: 1, Use: 'BLOCK' }, damage: {}, protection: {}, calls: [{ name: 'UseParameters', args: ['GIANTS'] }] },
  { name: 'Scale Armor', parent: null, fields: { Type: 'ARMOR', Model: 80, Width: 2, Height: 3, Price: 150 }, damage: {}, protection: { SLASH: 0.9, BASH: 0.9 }, calls: [{ name: 'SetArmorSkin', args: [121, 0] }] },
  { name: 'Heavy Plate Mail', parent: 'Scale Armor', fields: { Type: 'ARMOR', Model: 83, Width: 2, Height: 3, Price: 600 }, damage: {}, protection: { SLASH: 0.6, BASH: 0.6 }, calls: [{ name: 'SetArmorSkin', args: [124, 0] }] },
  { name: 'Enoch\'s Plate of Might', parent: 'Heavy Plate Mail', fields: { Type: 'ARMOR', Model: 83, Width: 2, Height: 3, Price: 2400, Equip: 'BOOST_ATTRIBUTE' }, damage: {}, protection: { SLASH: 0.6, BASH: 0.6 }, calls: [{ name: 'EquipParameters', args: [-1, 'MIGHT', 5] }] },
] };
const items = catalogFromItemRules(RULES);

describe('gear from items.ctx', () => {
  it('reads Equip boosts on weapons, shields and armour, and shield protection', () => {
    expect(items.get('fist_of_necros')!.protection![t('LIGHT')]).toBe(0.5);
    expect(items.get('shield_of_mighty_deeds')).toMatchObject({ attributes: { might: 5 } });
    expect(items.get('ice_shield')!.protection![t('WATER')]).toBe(0.6);
    const plate = items.get('enoch_s_plate_of_might')!;
    expect(plate.attributes).toEqual({ might: 5 });
    expect(plate.protection![t('SLASH')]).toBe(0.6);
    const inv: InventoryEntry[] = [
      { slot: 0, itemId: 'fist_of_necros', equipped: true },
      { slot: 1, itemId: 'ice_shield', equipped: true },
      { slot: 2, itemId: 'enoch_s_plate_of_might', equipped: true },
    ];
    const eq = equipmentOf(inv, items);
    expect(eq.protection[t('LIGHT')]).toBe(0.5);
    expect(eq.protection[t('WATER')]).toBe(0.6);
    expect(eq.protection[t('SLASH')]).toBe(0.6);
    expect(eq.attributes).toEqual({ might: 5 });
  });

  it("inherits a parent's calls the child does not make (SetArmorSkin)", () => {
    expect(items.get('enoch_s_plate_of_might')!.armorSkin).toEqual({ model: 124, texture: 0 });
    expect(items.get('scale_armor')!.armorSkin).toEqual({ model: 121, texture: 0 });
  });

  it('reads the shields\' use masks, reflection and soul drinking', () => {
    const base = USE_MASK.MELEE | USE_MASK.PROJECTILE;
    expect(items.get('wooden_shield')!.blocks).toBe(base);
    expect(items.get('fire_shield')!.blocks).toBe(base | USE_MASK.FIREBALL);
    expect(items.get('reflective_shield')).toMatchObject({ blocks: base | USE_MASK.LIGHTNING, reflects: true });
    expect(items.get('vampiric_shield')).toMatchObject({ blocks: base, soulDrink: { amount: 3, giants: false } });
    expect(items.get('soul_sucker')).toMatchObject({ name: 'Blade of Hunger', soulDrink: { amount: 1, giants: true } });
    expect(items.get('rod_of_necros')).toMatchObject({ soulDrink: { amount: 5, giants: false }, texture: 1 });
  });

  it('keeps the thrown and missile weapons as weapons Drake swings', () => {
    expect(items.get('boomer_axe')).toMatchObject({ type: 'weapon', price: 1600, texture: 1 });
    expect(items.get('boomer_axe')!.keyItem).toBeUndefined();
    expect(items.get('dasher_hand_bow')).toMatchObject({ type: 'weapon', price: 200 });
  });
});

/** A blocking-capable player and one skeleton `ft` feet in front of him, facing him. */
function setup(spawn: Partial<ArenaDef['mobSpawns'][number]>, inventory: InventoryEntry[], hp?: number, experience = 1_000_000) {
  const arena = createSyntheticArena();
  arena.mobSpawns = [{ x: 0, y: 0.5, z: -6 * FT, yaw: Math.PI, archetype: 'skeleton_warrior', ...spawn }];
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'gear', arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { random: () => 0, items });
  const id = zone.join(1, { name: 'Tester', characterId: null, position: { x: 0, y: 0.5, z: 0 }, experience, inventory, ...(hp !== undefined ? { hp } : {}) });
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let clientTick = 0;
  const run = (n: number, flags = 0, each?: (i: number) => void) => {
    for (let i = 0; i < n; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++clientTick, flags, yaw: quantizeAngle(0), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      each?.(i);
      zone.step();
    }
  };
  const me = () => zone.inspect().find((a) => a.id === id)!;
  const onMe = () => messages.filter((m) => m.op === SC.COMBAT_EVENT).map((m) => (m as Extract<ServerControlMsg, { op: typeof SC.COMBAT_EVENT }>).d).filter((d) => d.target === id);
  const fx = () => messages.filter((m) => m.op === SC.SPELL_EVENT).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.SPELL_EVENT }>).d.fx ?? []).map((f) => f.name);
  return { zone, run, me, onMe, fx };
}

const WITH_SHIELD = (shield: string): InventoryEntry[] => [{ slot: 0, itemId: 'axe', equipped: true }, { slot: 1, itemId: shield, equipped: true }];

describe('shields against the big creatures (0x401F20 GIANTS)', () => {
  it('a plain shield stops a normal skeleton but not one of scale 1.5 or more', () => {
    const small = setup({}, WITH_SHIELD('wooden_shield'));
    small.run(400, INPUT.BLOCK);
    expect(small.onMe().length).toBeGreaterThan(2);
    expect(small.onMe().every((e) => e.blocked)).toBe(true);

    const big = setup({ scale: 1.6 }, WITH_SHIELD('wooden_shield'));
    big.run(400, INPUT.BLOCK);
    expect(big.onMe().some((e) => !e.blocked && e.damage > 0)).toBe(true);
  });

  it('a shield with GIANTS stops the big one too', () => {
    const big = setup({ scale: 1.6 }, WITH_SHIELD('giant_shield'));
    big.run(400, INPUT.BLOCK);
    expect(big.onMe().length).toBeGreaterThan(2);
    expect(big.onMe().every((e) => e.blocked)).toBe(true);
  });
});

describe('soul drinking items (0x004014C0)', () => {
  it('Rod of Necros drinks 5 HP into its bearer on each landed blow', () => {
    const s = setup({ z: -4 * FT, shield: null }, [{ slot: 0, itemId: 'rod_of_necros', equipped: true }], 20, 0);
    const before = s.me().hp;
    s.run(200, 0, (i) => i % 25 === 0 && s.zone.attack(1));
    expect(s.fx()).toContain('SOULDRINKER_CAST');
    expect(s.fx()).toContain('SOULDRINKER_ENERGY');
    // Every landed blow drank; the skeleton's blows may have cost some of it back.
    const taken = s.onMe().filter((e) => !e.blocked).reduce((n, e) => n + e.damage, 0);
    expect(s.me().hp).toBeGreaterThan(before - taken);
  });

  it('a Vampiric Shield drinks from the blows it stops', () => {
    const s = setup({}, WITH_SHIELD('vampiric_shield'), 20);
    s.run(400, INPUT.BLOCK);
    expect(s.onMe().some((e) => e.blocked)).toBe(true);
    expect(s.fx()).toContain('SOULDRINKER_CAST');
    expect(s.me().hp).toBeGreaterThan(20);
  });
});

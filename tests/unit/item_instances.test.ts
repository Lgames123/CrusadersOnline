import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, migrateToLatest, type Database } from '@crusaders/server/persistence/db';
import { AccountRepository } from '@crusaders/server/persistence/accounts';
import { CharacterRepository } from '@crusaders/server/persistence/characters';
import { BUILTIN_ITEMS, sanitizeInventory, sanitizeMods } from '@crusaders/shared';

describe('item instances (MMO Stage 1)', () => {
  it('keeps only valid mods, never on stackable items', () => {
    expect(sanitizeMods({ rarity: 'tempered', plus: 14, failstacks: -2, affixes: [{ id: 'attr:might', value: 3 }, { id: 'evil', value: 9 }], bound: true }))
      .toEqual({ rarity: 'tempered', plus: 10, affixes: [{ id: 'attr:might', value: 3 }], bound: true });
    expect(sanitizeMods({ rarity: 'worn' })).toBeUndefined();
    const catalog = BUILTIN_ITEMS;
    const uid = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const inv = sanitizeInventory([
      { slot: 0, itemId: 'long_sword', equipped: true, uid, mods: { plus: 3 } },
      { slot: 1, itemId: 'healing_potion', equipped: false, quantity: 3, mods: { plus: 3 } },
      { slot: 2, itemId: 'axe', equipped: false, uid }, // a duplicate identity is dropped
    ], catalog);
    expect(inv[0]).toMatchObject({ uid, mods: { plus: 3 } });
    expect(inv[1]!.mods).toBeUndefined();
    expect(inv[2]!.uid).toBeUndefined();
  });

  let db: Database;
  beforeAll(async () => {
    db = await openDatabase('pglite:memory');
    await migrateToLatest(db.db);
  });
  afterAll(async () => db?.close());

  it('saves and loads an item with its identity and mods', async () => {
    const account = await new AccountRepository(db.db).register('instances', 'password123');
    const chars = new CharacterRepository(db.db);
    const made = await chars.create(account.id, 'Keeper');
    if (made === 'limit') throw new Error('limit');
    const uid = '11111111-2222-4333-8444-555555555555';
    const base = { characterId: made.id, x: 0, y: 0, z: 0, yaw: 0, level: 1, experience: 0, gold: 0, hp: 10, maxHp: 10, mana: 5, maxMana: 5, spells: [], selectedSpell: null };
    await chars.saveStates([{ ...base, inventory: [{ slot: 0, itemId: 'long_sword', equipped: true, uid, mods: { rarity: 'legendary', plus: 7, affixes: [{ id: 'dmg:FIRE', value: 4 }] } }] }]);
    await chars.saveStates([{ ...base, inventory: [{ slot: 3, itemId: 'long_sword', equipped: false, uid, mods: { rarity: 'legendary', plus: 8 } }] }]);
    const loaded = await chars.loadOwned(account.id, made.id);
    expect(loaded!.inventory).toEqual([{ slot: 3, itemId: 'long_sword', equipped: false, uid, mods: { rarity: 'legendary', plus: 8 } }]);
  });
});

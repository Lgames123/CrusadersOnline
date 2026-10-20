import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { settleTrade, type TradeOffer } from '@crusaders/server/simulation/trade';
import { BUILTIN_ITEMS, createSyntheticArena, initPhysics, type InventoryEntry, type Rapier } from '@crusaders/shared';

const U1 = '10000000-0000-4000-8000-000000000001';
const U2 = '10000000-0000-4000-8000-000000000002';
const offer = (uids: string[], gold = 0): TradeOffer => ({ uids, gold, locked: true, confirmed: true });

describe('trade settlement (MMO Stage 4)', () => {
  it('swaps items with their identity and gold, all or nothing', () => {
    const a = { connId: 1, name: 'Ann', gold: 100, inventory: [{ slot: 0, itemId: 'long_sword', equipped: false, uid: U1, mods: { plus: 5 } }] as InventoryEntry[] };
    const b = { connId: 2, name: 'Bob', gold: 50, inventory: [{ slot: 0, itemId: 'healing_potion', equipped: false, uid: U2, quantity: 3 }] as InventoryEntry[] };
    const r = settleTrade(a, b, offer([U1], 40), offer([U2]), BUILTIN_ITEMS);
    if ('error' in r) throw new Error(r.error);
    expect(r.a.gold).toBe(60);
    expect(r.b.gold).toBe(90);
    expect(r.b.inventory.find((e) => e.itemId === 'long_sword')).toMatchObject({ uid: U1, mods: { plus: 5 } });
    expect(r.a.inventory.find((e) => e.itemId === 'healing_potion')!.quantity).toBe(3);
    // The originals are untouched until the zone applies the result.
    expect(a.inventory[0]!.itemId).toBe('long_sword');
  });

  it('refuses worn, bound, missing items and too much gold', () => {
    const a = { connId: 1, name: 'Ann', gold: 10, inventory: [{ slot: 0, itemId: 'long_sword', equipped: true, uid: U1 }] as InventoryEntry[] };
    const b = { connId: 2, name: 'Bob', gold: 0, inventory: [{ slot: 0, itemId: 'axe', equipped: false, uid: U2, mods: { bound: true } }] as InventoryEntry[] };
    expect(settleTrade(a, b, offer([U1]), offer([]), BUILTIN_ITEMS)).toMatchObject({ error: expect.stringContaining('worn') });
    expect(settleTrade(a, b, offer([]), offer([U2]), BUILTIN_ITEMS)).toMatchObject({ error: expect.stringContaining('bound') });
    expect(settleTrade(a, b, offer(['nope']), offer([]), BUILTIN_ITEMS)).toMatchObject({ error: expect.any(String) });
    expect(settleTrade(a, b, offer([], 11), offer([]), BUILTIN_ITEMS)).toMatchObject({ error: expect.stringContaining('gold') });
  });
});

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

describe('trading in the zone', () => {
  it('request, accept, offer, lock, confirm; a change unlocks both; one save for both', () => {
    const saves: string[][] = [];
    const z = new WorldZone(rapier, 'trade', createSyntheticArena(), { send: () => {}, persist: (records) => saves.push(records.map((r) => r.characterId)) }, {});
    z.join(1, { name: 'Ann', characterId: 'ca', position: { x: 0, y: 0.5, z: 0 }, gold: 100, inventory: [{ slot: 0, itemId: 'long_sword', equipped: false, uid: U1 }] });
    z.join(2, { name: 'Bob', characterId: 'cb', position: { x: 1, y: 0.5, z: 0 }, gold: 0, inventory: [{ slot: 0, itemId: 'axe', equipped: false, uid: U2 }] });
    const players = (z as unknown as { players: Map<number, { inventory: InventoryEntry[]; gold: number }> }).players;
    z.trade(1, { action: 'request', name: 'bob' });
    z.trade(2, { action: 'accept' });
    z.trade(1, { action: 'offer', uids: [U1], gold: 30 });
    z.trade(1, { action: 'lock' });
    z.trade(2, { action: 'lock' });
    z.trade(2, { action: 'offer', uids: [U2] }); // unlocks both
    z.trade(1, { action: 'confirm' });
    expect(players.get(2)!.inventory.some((e) => e.uid === U1)).toBe(false);
    z.trade(1, { action: 'lock' });
    z.trade(2, { action: 'lock' });
    z.trade(1, { action: 'confirm' });
    saves.length = 0;
    z.trade(2, { action: 'confirm' });
    expect(players.get(2)!.inventory.some((e) => e.uid === U1)).toBe(true);
    expect(players.get(1)!.inventory.some((e) => e.uid === U2)).toBe(true);
    expect(players.get(1)!.gold).toBe(70);
    expect(players.get(2)!.gold).toBe(30);
    expect(saves).toEqual([['ca', 'cb']]);
    // A late confirm after the trade closed does nothing (no duplication).
    z.trade(2, { action: 'confirm' });
    expect(players.get(1)!.inventory.filter((e) => e.uid === U2)).toHaveLength(1);
  });
});

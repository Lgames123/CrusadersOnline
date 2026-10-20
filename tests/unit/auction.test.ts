import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, migrateToLatest, type Database } from '@crusaders/server/persistence/db';
import { AccountRepository } from '@crusaders/server/persistence/accounts';
import { CharacterRepository } from '@crusaders/server/persistence/characters';
import { AUCTION, EconomyRepository, auctionDeposit } from '@crusaders/server/persistence/economy';

let db: Database;
let eco: EconomyRepository;
let seller: { id: string; name: string };
let buyer: { id: string; name: string };
const UID = '20000000-0000-4000-8000-000000000001';

beforeAll(async () => {
  db = await openDatabase('pglite:memory');
  await migrateToLatest(db.db);
  eco = new EconomyRepository(db.db);
  const chars = new CharacterRepository(db.db);
  const make = async (name: string) => {
    const acc = await new AccountRepository(db.db).register(`acct_${name.toLowerCase()}`, 'password123');
    const c = await chars.create(acc.id, name);
    if (c === 'limit') throw new Error('limit');
    return { id: c.id, name };
  };
  seller = await make('Seller');
  buyer = await make('Buyer');
});
afterAll(async () => db?.close());

describe('auction house (MMO Stage 4)', () => {
  it('deposit: 5 % of the price by duration', () => {
    expect(auctionDeposit(1000, 12)).toBe(50);
    expect(auctionDeposit(1000, 48)).toBe(100);
    expect(auctionDeposit(3, 12)).toBe(1);
  });

  it('a sale mails the item to the buyer and the price less 10 % to the seller; a second buy finds it gone', async () => {
    const l = await eco.list(seller, { itemId: 'long_sword', uid: UID, quantity: 1, mods: { rarity: 'tempered', plus: 3 } }, 1000, 24);
    if (l === 'limit') throw new Error('limit');
    const found = await eco.search(['long_sword'], buyer.id);
    expect(found.find((x) => x.id === l.id)).toMatchObject({ price: 1000, seller: 'Seller', mods: { rarity: 'tempered', plus: 3 } });
    expect(await eco.buy(l.id, seller, 1000)).toBe('gone'); // not one's own
    expect(await eco.buy(l.id, buyer, 999)).toBe('gone'); // the price must match what was paid
    const [a, b] = await Promise.all([eco.buy(l.id, buyer, 1000), eco.buy(l.id, buyer, 1000)]);
    expect([a, b].sort()).toEqual(['gone', 'ok']);
    expect(await eco.mailFor(buyer.id)).toEqual([expect.objectContaining({ item: { itemId: 'long_sword', uid: UID, quantity: 1, mods: { rarity: 'tempered', plus: 3 } } })]);
    expect((await eco.mailFor(seller.id)).map((m) => m.gold)).toEqual([900]);
    const claimed = await eco.claimAll(buyer.id);
    expect(claimed).toHaveLength(1);
    expect(await eco.mailFor(buyer.id)).toEqual([]);
  });

  it('cancel and expiry return the item to the seller', async () => {
    const a = await eco.list(seller, { itemId: 'axe', quantity: 1 }, 50, 12);
    const b = await eco.list(seller, { itemId: 'mace', quantity: 1 }, 50, 12);
    if (a === 'limit' || b === 'limit') throw new Error('limit');
    expect(await eco.cancel(a.id, buyer.id)).toBe(false);
    expect(await eco.cancel(a.id, seller.id)).toBe(true);
    expect(await eco.expireDue(new Date(Date.now() + 13 * 3_600_000))).toBe(1);
    const items = (await eco.claimAll(seller.id)).map((m) => m.item?.itemId).filter(Boolean).sort();
    expect(items).toEqual(['axe', 'mace']);
  });

  it(`at most ${AUCTION.maxActivePerSeller} open listings per seller`, async () => {
    for (let i = 0; i < AUCTION.maxActivePerSeller; i++) expect(await eco.list(buyer, { itemId: 'club', quantity: 1 }, 10, 12)).not.toBe('limit');
    expect(await eco.list(buyer, { itemId: 'club', quantity: 1 }, 10, 12)).toBe('limit');
  });
});

import { WorldZone, type EconomyEvent } from '@crusaders/server/simulation/world_zone';
import { createSyntheticArena, initPhysics, type InventoryEntry, type Rapier } from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

describe('auction custody in the zone', () => {
  const setup = () => {
    const events: EconomyEvent[] = [];
    const z = new WorldZone(rapier, 'ah', createSyntheticArena(), { send: () => {}, persist: () => {}, economy: (e) => events.push(e) }, {});
    z.join(1, { name: 'Seller', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 }, gold: 100, inventory: [{ slot: 0, itemId: 'long_sword', equipped: true }, { slot: 1, itemId: 'axe', equipped: false, uid: UID, mods: { plus: 2 } }] });
    const p = (z as unknown as { players: Map<number, { inventory: InventoryEntry[]; gold: number; shop: unknown }> }).players.get(1)!;
    return { z, p, events };
  };

  it('escrows the item and the deposit only at a merchant; a worn item stays', () => {
    const t = setup();
    t.z.auctionEscrow(1, 1, 'axe', 400, 24);
    expect(t.events).toEqual([]);
    t.p.shop = { id: 1, stock: [], openedAt: 0, gift: false };
    t.z.auctionEscrow(1, 0, 'long_sword', 400, 24);
    expect(t.events).toEqual([]);
    t.z.auctionEscrow(1, 1, 'axe', 400, 24);
    expect(t.events).toEqual([{ kind: 'escrowed', connId: 1, characterId: 'c1', name: 'Seller', item: { itemId: 'axe', quantity: 1, uid: UID, mods: { plus: 2 } }, price: 400, hours: 24 }]);
    expect(t.p.gold).toBe(70);
    expect(t.p.inventory.some((e) => e.itemId === 'axe')).toBe(false);
  });

  it('charges a buyer with the gold; delivers mail and sends back what does not fit', () => {
    const t = setup();
    t.p.shop = { id: 1, stock: [], openedAt: 0, gift: false };
    t.z.auctionCharge(1, 500, 'r1');
    t.z.auctionCharge(1, 60, 'r2');
    expect(t.events).toEqual([{ kind: 'charged', connId: 1, ref: 'r1', ok: false }, { kind: 'charged', connId: 1, ref: 'r2', ok: true }]);
    expect(t.p.gold).toBe(40);
    t.events.length = 0;
    const many = Array.from({ length: 30 }, () => ({ itemId: 'scale_armor', quantity: 1 }));
    t.z.deliverMail(1, 25, [{ itemId: 'mace', quantity: 1, mods: { rarity: 'mundane' } }, ...many]);
    expect(t.p.gold).toBe(65);
    expect(t.p.inventory.find((e) => e.itemId === 'mace')!.mods).toEqual({ rarity: 'mundane' });
    expect(t.events[0]!.kind).toBe('undelivered');
    expect((t.events[0] as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });
});

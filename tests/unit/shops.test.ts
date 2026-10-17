import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  BUILTIN_ITEMS,
  LEVEL_UNIT_METRES,
  SC,
  createSyntheticArena,
  initPhysics,
  tradePrice,
  type InventoryEntry,
  type Rapier,
  type ServerControlMsg,
  type StoryShop,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

interface Internal {
  players: Map<number, { inventory: InventoryEntry[]; gold: number }>;
}

const FT = 1 / LEVEL_UNIT_METRES;
const SHOP = 7000;

/** A level act with one shop (cap type 0x1C) whose volume holds the player at the origin. */
function shopZone(gold: number, inventory: InventoryEntry[] = [], at = { x: 0, z: 0 }) {
  const arena = createSyntheticArena();
  arena.name = 'level:t1a';
  arena.mobSpawns = [];
  const shop: StoryShop = {
    id: SHOP,
    activation: 8,
    volume: { polygon: [[-3 * FT, -3 * FT], [3 * FT, -3 * FT], [3 * FT, 3 * FT], [-3 * FT, 3 * FT]], yMin: -10, yMax: 20 * FT },
    greeting: 1466,
    stock: [{ name: 'Long Sword', quantity: 1 }, { name: 'Healing Potion', quantity: 1 }, { name: 'Healing Potion', quantity: 1 }],
  };
  arena.story = { triggers: [], cameras: [], sequences: [], shops: [shop] };
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, arena.name, arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { items: new Map(BUILTIN_ITEMS) });
  zone.join(1, { name: 'Buyer', characterId: null, position: { x: at.x, y: 0.5, z: at.z }, gold, inventory });
  const me = (zone as unknown as Internal).players.get(1)!;
  const shops = () => messages.filter((m) => m.op === SC.SHOP).map((m) => m.d);
  const errors = () => messages.filter((m) => m.op === SC.ERROR).map((m) => m.d.code);
  return { zone, me, shops, errors };
}

const price = (id: string) => tradePrice(BUILTIN_ITEMS.get(id)!);

describe('shops (cap type 0x1C)', () => {
  it('the use key in its volume opens it: the greeting and a copy of its items at items.ctx prices', () => {
    const t = shopZone(0);
    t.zone.shopOpen(1, SHOP);
    const shop = t.shops()[0]!;
    expect(shop).toMatchObject({ shop: SHOP, greeting: 1466 });
    expect(shop.stock.map((s) => s.itemId)).toEqual(['long_sword', 'healing_potion', 'healing_potion']);
    expect(shop.stock[0]!.price).toBe(price('long_sword'));
    // Outside the volume nothing opens.
    const away = shopZone(0, [], { x: 10, z: 10 });
    away.zone.shopOpen(1, SHOP);
    expect(away.shops()).toEqual([]);
  });

  it('buying takes the entry for its price; without the gold it is refused', () => {
    const t = shopZone(price('healing_potion') * 2 - 1, [{ slot: 0, itemId: 'long_sword', equipped: true }]);
    t.zone.shopOpen(1, SHOP);
    t.zone.shopBuy(1, SHOP, 1, 'healing_potion');
    expect(t.me.gold).toBe(price('healing_potion') - 1);
    const potions = () => t.me.inventory.filter((e) => e.itemId === 'healing_potion').reduce((n, e) => n + (e.quantity ?? 1), 0);
    const before = potions();
    expect(before).toBeGreaterThan(0);
    // The visit's copy lost that entry: one potion left in the offer.
    expect(t.shops().at(-1)!.stock.map((s) => s.itemId)).toEqual(['long_sword', 'healing_potion']);
    t.zone.shopBuy(1, SHOP, 1, 'healing_potion');
    expect(t.errors()).toContain('shop_gold');
    expect(potions()).toBe(before);
  });

  it('selling pays the full price, and what was sold can be bought back until it is reopened', () => {
    const t = shopZone(0, [{ slot: 0, itemId: 'scale_armor', equipped: true }]);
    t.zone.shopOpen(1, SHOP);
    t.zone.shopSell(1, SHOP, 0, 'scale_armor');
    expect(t.me.gold).toBe(price('scale_armor'));
    expect(t.me.inventory).toEqual([]);
    expect(t.shops().at(-1)!.stock.map((s) => s.itemId)).toContain('scale_armor');
    t.zone.step();
    for (let i = 0; i < 20; i++) t.zone.step(); // past the 500 ms between openings
    t.zone.shopOpen(1, SHOP);
    expect(t.shops().at(-1)!.stock.map((s) => s.itemId)).toEqual(['long_sword', 'healing_potion', 'healing_potion']);
  });
});

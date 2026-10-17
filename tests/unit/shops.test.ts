import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  BUILTIN_ITEMS,
  SC,
  createSyntheticArena,
  initPhysics,
  merchantKindOf,
  sellPrice,
  type InventoryEntry,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';
import { parseFeatures } from '@crusaders/server/config';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

interface Internal {
  players: Map<number, { inventory: InventoryEntry[]; gold: number }>;
}

/** A player with `gold` beside a human merchant 1.5 m ahead (merchantShops on unless `off`). */
function shopZone(gold: number, inventory: InventoryEntry[] = [], off = false) {
  const arena = createSyntheticArena();
  arena.mobSpawns = [{ archetype: 'npc_117', x: 0, y: 0.5, z: -1.5, hp: 20, placement: 0, merchant: 'human' }];
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'shop', arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { items: new Map(BUILTIN_ITEMS), features: off ? {} : { merchantShops: true } });
  zone.join(1, { name: 'Buyer', characterId: null, position: { x: 0, y: 0.5, z: 0 }, gold, inventory });
  const me = (zone as unknown as Internal).players.get(1)!;
  const merchant = zone.inspect().find((a) => a.kind === 'mob')!.id;
  const shops = () => messages.filter((m) => m.op === SC.SHOP).map((m) => m.d);
  const errors = () => messages.filter((m) => m.op === SC.ERROR).map((m) => m.d.code);
  return { zone, me, merchant, shops, errors };
}

describe('merchant shops (merchantShops feature)', () => {
  it('knows merchants by their placement name and people', () => {
    expect(merchantKindOf(117, 'eMerchant1')).toBe('human');
    expect(merchantKindOf(127, 'DwarfMerchant3')).toBe('dwarf');
    expect(merchantKindOf(132, 'DasherMerchant1')).toBe('dasher');
    expect(merchantKindOf(117, 'StockyHumanMaleCitizen')).toBeNull();
  });

  it('is on by default; GAME_FEATURES=-merchantShops keeps the original', () => {
    expect(parseFeatures('')).toContain('merchantShops');
    expect(parseFeatures('-merchantShops,diagonalMoves')).toEqual(['diagonalMoves']);
  });

  it('the use key opens the shop: stock with items.ctx prices', () => {
    const t = shopZone(0);
    t.zone.shopOpen(1, t.merchant);
    const shop = t.shops()[0]!;
    expect(shop.entity).toBe(t.merchant);
    expect(shop.stock.length).toBeGreaterThan(0);
    const potion = shop.stock.find((s) => s.itemId === 'healing_potion')!;
    expect(potion.price).toBe(BUILTIN_ITEMS.get('healing_potion')!.price);
    // The original (feature off): merchants do not trade.
    const off = shopZone(0, [], true);
    off.zone.shopOpen(1, off.merchant);
    expect(off.shops()).toEqual([]);
  });

  it('buys for gold, refuses without enough, stacks potions', () => {
    const price = BUILTIN_ITEMS.get('healing_potion')!.price;
    const t = shopZone(price * 3);
    t.zone.shopBuy(1, t.merchant, 'healing_potion', 2);
    expect(t.me.gold).toBe(price);
    expect(t.me.inventory.find((e) => e.itemId === 'healing_potion')?.quantity).toBe(2);
    t.zone.shopBuy(1, t.merchant, 'healing_potion', 2);
    expect(t.errors()).toContain('shop_gold');
    expect(t.me.gold).toBe(price);
    // Not stocked: nothing happens.
    t.zone.shopBuy(1, t.merchant, 'heavy_plate_mail', 1);
    expect(t.me.gold).toBe(price);
  });

  it('sells a bag item for half its price, worn ones too; not from afar', () => {
    const sword = BUILTIN_ITEMS.get('long_sword')!;
    const t = shopZone(0, [{ slot: 0, itemId: 'long_sword', equipped: true }, { slot: 1, itemId: 'healing_potion', equipped: false, quantity: 3 }]);
    t.zone.shopSell(1, t.merchant, 0, 'long_sword');
    expect(t.me.gold).toBe(sellPrice(sword));
    expect(sellPrice(sword)).toBe(Math.floor(sword.price / 2));
    t.zone.shopSell(1, t.merchant, 1);
    expect(t.me.gold).toBe(sellPrice(sword) + 3 * sellPrice(BUILTIN_ITEMS.get('healing_potion')!));
    expect(t.me.inventory).toEqual([]);
  });
});

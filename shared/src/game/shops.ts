import type { ItemCatalog, ItemDef } from './items.ts';
import { itemSlug } from './items.ts';
import type { StoryShop } from './story.ts';

/**
 * The original's shops (executable-analysis.md §19). A shop is a level trigger (cap type 0x1C)
 * by a merchant: the use key in its volume plays the merchant's greeting and opens the inventory
 * screen in trade mode with a fresh copy of the shop's items (each act has its own, so the stock
 * changes as the story goes on). Dropping one of its items into the bag costs its items.ctx Price
 * times its count, taken from the gold (0x46E290; refused without enough); dropping a bag item
 * into the shop pays that same price back (× −1.0 at 0x4DE87C). The copy lasts the visit: what
 * was bought is gone and what was sold can be bought back until the shop is opened again.
 */

/** One item on offer this visit (an items.ctx item and its count). */
export interface ShopEntry {
  itemId: string;
  quantity: number;
}

/** The use key opens a shop at most this often (0x464170: 500 ms since the last). */
export const SHOP_REOPEN_MS = 500;

/** What a shop entry costs, and what the merchant pays for it: Price × count. */
export function tradePrice(def: ItemDef, quantity = 1): number {
  return Math.max(0, Math.round(def.price)) * Math.max(1, quantity);
}

/**
 * Whether a merchant takes this item. The original takes anything, paying 0 for an item without
 * a price (it plays 0x199 and the item is gone); here those (keys, quest items) are refused.
 */
export function merchantBuys(def: ItemDef): boolean {
  return def.type !== 'key' && def.price > 0;
}

/** A fresh copy of a shop's stock (0x46D3D0), its items resolved in the catalogue. */
export function shopStock(shop: StoryShop, catalog: ItemCatalog): ShopEntry[] {
  return shop.stock.flatMap((s) => {
    const def = catalog.get(s.name) ?? catalog.get(itemSlug(s.name));
    return def ? [{ itemId: def.id, quantity: Math.max(1, s.quantity) }] : [];
  });
}

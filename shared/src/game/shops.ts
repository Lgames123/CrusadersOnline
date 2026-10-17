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
  /** A gift shop's entry: its index in the shop's own list (its once-per-character flag). */
  gift?: number;
}

/** The merchants' lines a shop greets with (Sound.ctx mm_ci_01..mm_to_01). */
const MERCHANT_GREETINGS = new Set([1466, 1467, 1468, 1469, 1470, 1471, 1472]);

/**
 * Whether a shop is someone giving the player a reward rather than a merchant: its greeting is
 * not a merchant's line (the hermit lady in Cs2b, HL_13_02, hands over the Torch Light Spell
 * Book). The original trades it at the item's Price like any shop and refills it on every
 * opening; here (a deviation) each of its items is free and taken once per character.
 */
export function isGiftShop(shop: StoryShop): boolean {
  return !MERCHANT_GREETINGS.has(shop.greeting);
}

/** The story flag of a gift shop's entry once taken (a valid `STORY_FLAG`, saved with the story). */
export function giftFlag(act: string, shop: number, index: number): string {
  return `${act.toLowerCase()}-gift${index}:${shop}`;
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

/**
 * A fresh copy of a shop's stock (0x46D3D0), its items resolved in the catalogue. A gift shop's
 * entries carry their index, and those `taken(index)` says the character has had are left out.
 */
export function shopStock(shop: StoryShop, catalog: ItemCatalog, taken: (index: number) => boolean = () => false): ShopEntry[] {
  const gift = isGiftShop(shop);
  return shop.stock.flatMap((s, i) => {
    const def = catalog.get(s.name) ?? catalog.get(itemSlug(s.name));
    if (!def || (gift && taken(i))) return [];
    return [{ itemId: def.id, quantity: Math.max(1, s.quantity), ...(gift ? { gift: i } : {}) }];
  });
}

/** What a visit's entry costs: nothing for a gift, else Price × count. */
export function entryPrice(def: ItemDef, entry: ShopEntry): number {
  return entry.gift !== undefined ? 0 : tradePrice(def, entry.quantity);
}

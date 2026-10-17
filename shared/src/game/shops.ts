import type { ItemCatalog, ItemDef } from './items.ts';

/**
 * Merchant shops (non-original: the `merchantShops` gameplay feature). The original places
 * merchants (eMerchant1 in the Citadel and Cador Sul, DwarfMerchant* in Corantha, DasherMerchant1
 * in Duskwood) but they neither speak nor trade (executable-analysis.md §18). Here the use key on
 * one opens its shop: items.ctx prices to buy, half of them back when selling.
 */
export type MerchantKind = 'human' | 'dwarf' | 'dasher';

export interface MerchantStock {
  title: string;
  /** Item ids (itemSlug of items.ctx names); ones the server's catalogue lacks are left out. */
  items: readonly string[];
}

/** What each merchant people sells (slice choice: the original has no stock lists). */
export const MERCHANT_STOCK: Readonly<Record<MerchantKind, MerchantStock>> = {
  human: {
    title: 'Merchant',
    items: [
      'healing_potion', 'greater_healing_potion', 'mana_potion', 'speed_potion',
      'long_sword', 'broad_sword', 'mace', 'morning_star',
      'wooden_shield', 'metal_shield', 'scale_armor', 'banded_armor',
    ],
  },
  dwarf: {
    title: 'Dwarf Merchant',
    items: [
      'healing_potion', 'greater_healing_potion', 'mana_potion',
      'axe', 'battle_axe', 'heavy_mace', 'war_hammer', 'pick_axe',
      'metal_shield', 'banded_armor', 'light_plate_mail', 'heavy_plate_mail',
    ],
  },
  dasher: {
    title: 'Dasher Merchant',
    items: [
      'healing_potion', 'greater_healing_potion', 'mana_potion', 'speed_potion',
      'fire_resistance_potion', 'air_resistance_potion', 'earth_resistance_potion', 'water_resistance_potion',
      'dasher_weapon', 'axe', 'wooden_shield', 'scale_armor',
    ],
  },
};

/** Merchants are placements named "…Merchant…": the people by creature type (dwarf 127, dasher 132). */
export function merchantKindOf(type: number, name: string): MerchantKind | null {
  if (!/merchant/i.test(name)) return null;
  return type === 127 ? 'dwarf' : type === 132 ? 'dasher' : 'human';
}

/** Selling pays this share of the price. */
export const SELL_RATE = 0.5;

/** Use-key reach to a merchant (metres): the talk reach, 12 ft (0x40DEB0). */
export const SHOP_REACH = 12 * 0.3048;

/** Most of one item bought at once (a stack of potions). */
export const MAX_BUY = 20;

export function buyPrice(def: ItemDef): number {
  return Math.max(1, Math.round(def.price));
}

/** What the merchant pays for one; 0 = it will not buy it (no price: quest items, keys). */
export function sellPrice(def: ItemDef): number {
  if (def.type === 'key' || !(def.price > 0)) return 0;
  return Math.max(1, Math.floor(def.price * SELL_RATE));
}

/** A merchant's offer: its stock that the catalogue knows, with prices. */
export function shopOffer(kind: MerchantKind, catalog: ItemCatalog): { itemId: string; price: number }[] {
  return MERCHANT_STOCK[kind].items.flatMap((id) => {
    const def = catalog.get(id);
    return def && def.id === id ? [{ itemId: id, price: buyPrice(def) }] : [];
  });
}

import { damageVector, type DamageType, type DamageVector } from './ruleset.ts';
import { SPELL_BOOK_PARAMS, type SpellId } from './spells.ts';

/**
 * Equipment items. The built-in catalog holds the numbers of the items the slice uses, recorded
 * as facts from items.ctx (gameplay-mechanics.md); a converted installation's
 * `rules/items.json` (converter/src/formats/items_ctx.ts) can replace it with the full table via
 * catalogFromItemRules().
 */
export type ItemType = 'weapon' | 'shield' | 'armor' | 'potion' | 'spellbook' | 'key';

export interface ItemDef {
  /** Stable slug, e.g. "long_sword" (stored in inventory_items.item_id). */
  id: string;
  name: string;
  type: ItemType;
  /** Weapons: damage per type (items.ctx `SetDamage`). */
  damage?: DamageVector;
  /** Weapons: swing-rate multiplier (items.ctx `Speed`). */
  speed?: number;
  /** Armour: damage-taken multipliers (items.ctx `SetProtection`), 1 = none. */
  protection?: DamageVector;
  /** Potions with `Use HEAL`: hit points restored (items.ctx `UseParameters`). */
  heal?: number;
  /** Spell books (items.ctx `Use GRANT_SPELL`): the spell learned when picked up. */
  spell?: SpellId;
  /** Several of the same item share one inventory slot. */
  stackable?: boolean;
  price: number;
}

export type ItemCatalog = ReadonlyMap<string, ItemDef>;

export function itemSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 64);
}

const weapon = (name: string, dmg: Partial<Record<DamageType, number>>, speed: number, price: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'weapon', damage: damageVector(dmg), speed, price });
const shield = (name: string, price: number): ItemDef => ({ id: itemSlug(name), name, type: 'shield', price });
const armor = (name: string, prot: Partial<Record<DamageType, number>>, price: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'armor', protection: damageVector(prot, 1), price });
const potion = (name: string, heal: number, price: number): ItemDef => ({ id: itemSlug(name), name, type: 'potion', heal, stackable: true, price });
const spellBook = (name: string, spell: SpellId, price: number): ItemDef => ({ id: itemSlug(name), name, type: 'spellbook', spell, price });
const key = (name: string, price: number): ItemDef => ({ id: itemSlug(name), name, type: 'key', price });

export const BUILTIN_ITEMS: ItemCatalog = new Map(
  [
    weapon('Axe', { SLASH: 5, BASH: 5 }, 1.1, 100),
    weapon('Long Sword', { SLASH: 10 }, 1, 120),
    weapon('Mace', { BASH: 10 }, 1.1, 100),
    weapon('Heavy Mace', { BASH: 14 }, 1, 150),
    weapon('Morning Star', { SLASH: 5, BASH: 10 }, 0.98, 200),
    // The creatures' template weapons (items.ctx values).
    weapon('Battle Axe', { SLASH: 8, BASH: 5 }, 1, 150),
    weapon('War Hammer', { BASH: 16 }, 0.95, 200),
    weapon('Broad Sword', { SLASH: 10, BASH: 5 }, 0.95, 150),
    weapon('Dasher Weapon', { SLASH: 6, BASH: 6 }, 1.1, 220),
    weapon('Club', { BASH: 8 }, 1.05, 50),
    shield('Wooden Shield', 30),
    shield('Metal Shield', 50),
    armor('Scale Armor', { SLASH: 0.9, BASH: 0.9 }, 150),
    armor('Banded Armor', { SLASH: 0.8, BASH: 0.8 }, 250),
    potion('Healing Potion', 10, 100),
    potion('Greater Healing Potion', 50, 300),
    spellBook('Torch Light Spell Book', 'torch_light', 100),
  ].map((d) => [d.id, d]),
);

/** Shape of one entry in the converter's rules/items.json. */
interface ItemRule {
  name: string;
  fields: Record<string, string | number>;
  damage: Partial<Record<string, number>>;
  protection: Partial<Record<string, number>>;
  calls?: { name: string; args: (string | number)[] }[];
}

/**
 * Builds a catalog from converted items.json (melee weapons, shields, body armour), layered over
 * the built-in items. Entries with other types (potions, rings, quest items...) are ignored.
 */
export function catalogFromItemRules(rules: { items: readonly ItemRule[] }): ItemCatalog {
  const out = new Map(BUILTIN_ITEMS);
  for (const r of rules.items) {
    const type = String(r.fields['Type'] ?? '');
    const price = Number(r.fields['Price'] ?? 0) || 0;
    let def: ItemDef | null = null;
    if (type === 'WEAPON' && r.fields['SubType'] === 'MELEE') {
      def = weapon(r.name, r.damage as Partial<Record<DamageType, number>>, Number(r.fields['Speed'] ?? 1) || 1, price);
    } else if (type === 'SHIELD') {
      def = shield(r.name, price);
    } else if (type === 'ARMOR') {
      def = armor(r.name, r.protection as Partial<Record<DamageType, number>>, price);
    } else if (type === 'SPELLBOOK' && r.fields['Use'] === 'GRANT_SPELL') {
      // Inherited books keep the parent's Use; the spell is the book's own UseParameters.
      const spell = SPELL_BOOK_PARAMS[String(r.calls?.find((c) => c.name === 'UseParameters')?.args[0] ?? '')];
      if (spell) def = spellBook(r.name, spell, price);
    } else if (type === 'POTION' && r.fields['Use'] === 'HEAL') {
      const amount = Number(r.calls?.find((c) => c.name === 'UseParameters')?.args[0] ?? 0);
      if (amount > 0) def = potion(r.name, amount, price);
    } else if (type === 'USEABLE' && / Key$/.test(r.name)) {
      // Door keys (Stone Key, Fain's Key, Room 2 Key...): carried, used on a locked door.
      def = key(r.name, price);
    }
    if (def && def.id) out.set(def.id, def);
  }
  return out;
}

export const UNARMED: Readonly<ItemDef> = { id: 'unarmed', name: 'Unarmed', type: 'weapon', damage: damageVector({}), speed: 1, price: 0 };

/** One occupied inventory slot. */
export interface InventoryEntry {
  slot: number;
  itemId: string;
  equipped: boolean;
  /** Stack size for stackable items (absent = 1). */
  quantity?: number;
}

/** Engine name of the currency item; picked up as gold, never stored in the inventory. */
export const GOLD_ITEM = 'Gold Pieces';
export const MAX_STACK = 99;

export const INVENTORY_SLOTS = 32;

/** New characters: the slice's starting weapon and shield, equipped. */
export function startingInventory(): InventoryEntry[] {
  return [
    { slot: 0, itemId: 'long_sword', equipped: true },
    { slot: 1, itemId: 'wooden_shield', equipped: true },
  ];
}

export interface Equipment {
  weapon: ItemDef;
  shield: ItemDef | null;
  armor: ItemDef | null;
}

/** Removes one item from the stack in `slot` (the entry goes away at zero). Returns its definition. */
export function takeOne(inv: InventoryEntry[], slot: number, catalog: ItemCatalog): ItemDef | null {
  const i = inv.findIndex((e) => e.slot === slot);
  const e = inv[i];
  const def = e && catalog.get(e.itemId);
  if (!e || !def) return null;
  const q = (e.quantity ?? 1) - 1;
  if (q <= 0) inv.splice(i, 1);
  else if (q === 1) delete e.quantity;
  else e.quantity = q;
  return def;
}

export function equipmentOf(inv: readonly InventoryEntry[], catalog: ItemCatalog): Equipment {
  const eq: Equipment = { weapon: UNARMED, shield: null, armor: null };
  for (const e of inv) {
    if (!e.equipped) continue;
    const def = catalog.get(e.itemId);
    if (!def) continue;
    if (def.type === 'weapon') eq.weapon = def;
    else if (def.type === 'shield' || def.type === 'armor') eq[def.type] = def;
  }
  return eq;
}

/**
 * Adds an item: stackable items join an existing stack first (up to MAX_STACK), otherwise the
 * first free slot is used. Returns the slot, or null when the bag is full.
 */
export function addItem(inv: InventoryEntry[], itemId: string, quantity = 1, catalog?: ItemCatalog): number | null {
  if (catalog?.get(itemId)?.stackable) {
    const stack = inv.find((e) => e.itemId === itemId && (e.quantity ?? 1) + quantity <= MAX_STACK);
    if (stack) {
      stack.quantity = (stack.quantity ?? 1) + quantity;
      return stack.slot;
    }
  }
  const used = new Set(inv.map((e) => e.slot));
  for (let s = 0; s < INVENTORY_SLOTS; s++) {
    if (!used.has(s)) {
      inv.push(quantity > 1 ? { slot: s, itemId, equipped: false, quantity } : { slot: s, itemId, equipped: false });
      inv.sort((a, b) => a.slot - b.slot);
      return s;
    }
  }
  return null;
}

/**
 * Equips (unequipping whatever occupies the same equipment slot) or unequips the item in `slot`.
 * Returns false for an empty slot, an unknown item or a no-op.
 */
export function setEquipped(inv: InventoryEntry[], slot: number, equip: boolean, catalog: ItemCatalog): boolean {
  const entry = inv.find((e) => e.slot === slot);
  const def = entry && catalog.get(entry.itemId);
  if (!entry || !def || entry.equipped === equip || def.type === 'potion' || def.type === 'spellbook' || def.type === 'key') return false;
  if (equip) {
    for (const e of inv) {
      if (e.equipped && catalog.get(e.itemId)?.type === def.type) e.equipped = false;
    }
  }
  entry.equipped = equip;
  return true;
}

/** Drops unknown items and invalid / duplicate slots and keeps at most one equipped item per type. */
export function sanitizeInventory(inv: readonly InventoryEntry[], catalog: ItemCatalog): InventoryEntry[] {
  const out: InventoryEntry[] = [];
  const slots = new Set<number>();
  const equipped = new Set<ItemType>();
  for (const e of [...inv].sort((a, b) => a.slot - b.slot)) {
    const def = catalog.get(e.itemId);
    if (!def || !Number.isInteger(e.slot) || e.slot < 0 || e.slot >= INVENTORY_SLOTS || slots.has(e.slot)) continue;
    slots.add(e.slot);
    const eq = e.equipped && def.type !== 'potion' && def.type !== 'spellbook' && def.type !== 'key' && !equipped.has(def.type);
    if (eq) equipped.add(def.type);
    const q = Math.floor(e.quantity ?? 1);
    out.push(def.stackable && q > 1 ? { slot: e.slot, itemId: e.itemId, equipped: eq, quantity: Math.min(MAX_STACK, q) } : { slot: e.slot, itemId: e.itemId, equipped: eq });
  }
  return out;
}

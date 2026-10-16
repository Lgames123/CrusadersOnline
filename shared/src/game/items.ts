import { damageVector, type DamageType, type DamageVector } from './ruleset.ts';
import { SPELL_BOOK_PARAMS, type SpellId } from './spells.ts';
import { canPlaceGrid, firstFreeGridPosition, INVENTORY_GRID, layoutInventoryGrid } from './inventory_grid.ts';

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
  /** Width in inventory cells, taken from the resolved `Width` field in items.ctx. */
  width: number;
  /** Height in inventory cells, taken from the resolved `Height` field in items.ctx. */
  height: number;
  /** Original item model id when known; used by inventory previews. */
  model?: number;
  /** Weapons: damage per type (items.ctx `SetDamage`). */
  damage?: DamageVector;
  /** Weapons: swing-rate multiplier (items.ctx `Speed`). */
  speed?: number;
  /** Armour: damage-taken multipliers (items.ctx `SetProtection`), 1 = none. */
  protection?: DamageVector;
  /** Potions with `Use HEAL`: hit points restored (items.ctx `UseParameters`). */
  heal?: number;
  /** Potions with `Use RESTORE_MANA`: mana restored (items.ctx `UseParameters`). */
  mana?: number;
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

const weapon = (name: string, dmg: Partial<Record<DamageType, number>>, speed: number, price: number, model?: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'weapon', width: 1, height: 3, damage: damageVector(dmg), speed, price, ...(model !== undefined ? { model } : {}) });
const shield = (name: string, price: number, model?: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'shield', width: 2, height: 2, price, ...(model !== undefined ? { model } : {}) });
const armor = (name: string, prot: Partial<Record<DamageType, number>>, price: number, model?: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'armor', width: 2, height: 3, protection: damageVector(prot, 1), price, ...(model !== undefined ? { model } : {}) });
const potion = (name: string, heal: number, price: number, model?: number, mana?: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'potion', width: 1, height: 1, ...(heal ? { heal } : {}), ...(mana ? { mana } : {}), stackable: true, price, ...(model !== undefined ? { model } : {}) });
const spellBook = (name: string, spell: SpellId, price: number, model?: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'spellbook', width: 1, height: 1, spell, price, ...(model !== undefined ? { model } : {}) });
const key = (name: string, price: number, model?: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'key', width: 1, height: 1, price, ...(model !== undefined ? { model } : {}) });

export const BUILTIN_ITEMS: ItemCatalog = new Map(
  [
    weapon('Axe', { SLASH: 5, BASH: 5 }, 1.1, 100, 71),
    weapon('Long Sword', { SLASH: 10 }, 1, 120, 8),
    weapon('Mace', { BASH: 10 }, 1.1, 100, 73),
    weapon('Heavy Mace', { BASH: 14 }, 1, 150, 74),
    weapon('Morning Star', { SLASH: 5, BASH: 10 }, 0.98, 200, 75),
    // The creatures' template weapons (items.ctx values).
    weapon('Battle Axe', { SLASH: 8, BASH: 5 }, 1, 150, 72),
    weapon('War Hammer', { BASH: 16 }, 0.95, 200, 76),
    weapon('Broad Sword', { SLASH: 10, BASH: 5 }, 0.95, 150, 77),
    weapon('Dasher Weapon', { SLASH: 6, BASH: 6 }, 1.1, 220, 78),
    weapon('Club', { BASH: 8 }, 1.05, 50, 98),
    shield('Wooden Shield', 30, 86),
    shield('Metal Shield', 50, 28),
    armor('Scale Armor', { SLASH: 0.9, BASH: 0.9 }, 150, 80),
    armor('Banded Armor', { SLASH: 0.8, BASH: 0.8 }, 250, 81),
    potion('Healing Potion', 10, 100, 62),
    potion('Greater Healing Potion', 50, 300, 62),
    potion('Mana Crystals', 0, 20, 69, 5),
    potion('Mana Crystals 2', 0, 20, 198, 5),
    potion('Mana Crystals 3', 0, 20, 69, 5),
    potion('Mana Potion', 0, 100, 62, 25),
    spellBook('Torch Light Spell Book', 'torch_light', 100, 63),
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

/** Reads a positive integral inventory dimension, falling back safely for incomplete data. */
function itemDimension(value: string | number | undefined): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function withSourceShape(def: ItemDef, fields: ItemRule['fields']): ItemDef {
  const model = Number(fields['Model']);
  return {
    ...def,
    width: itemDimension(fields['Width']),
    height: itemDimension(fields['Height']),
    ...(Number.isInteger(model) && model >= 0 ? { model } : {}),
  };
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
    } else if (type === 'POTION') {
      const use = r.fields['Use'];
      const amount = Number(r.calls?.find((c) => c.name === 'UseParameters')?.args[0] ?? 0);
      def = potion(r.name, use === 'HEAL' ? amount : 0, price, undefined, use === 'RESTORE_MANA' ? amount : undefined);
    } else if ((type === 'USEABLE' && / Key$/.test(r.name)) || type === 'QUEST' || type === 'RING') {
      def = key(r.name, price);
    }
    if (def && def.id) {
      const shaped = withSourceShape(def, r.fields);
      out.set(shaped.id, shaped);
      out.set(r.name, shaped);
      if (typeof r.fields['Name'] === 'string' && r.fields['Name'].trim()) {
        out.set(itemSlug(r.fields['Name']), shaped);
        out.set(r.fields['Name'].trim(), shaped);
      }
    }
  }
  return out;
}

export const UNARMED: Readonly<ItemDef> = { id: 'unarmed', name: 'Unarmed', type: 'weapon', width: 1, height: 1, damage: damageVector({}), speed: 1, price: 0 };

/** One occupied inventory slot. */
export interface InventoryEntry {
  slot: number;
  /** Origin in the 8×4 bag grid; absent on a record saved before migration 005. */
  x?: number;
  y?: number;
  itemId: string;
  equipped: boolean;
  /** Stack size for stackable items (absent = 1). */
  quantity?: number;
}

/** Engine name of the currency item; picked up as gold, never stored in the inventory. */
export const GOLD_ITEM = 'Gold Pieces';
export const MAX_STACK = 99;

export const INVENTORY_SLOTS = 48;

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
  const def = catalog?.get(itemId);
  if (def?.stackable) {
    const stack = inv.find((e) => e.itemId === itemId && (e.quantity ?? 1) + quantity <= MAX_STACK);
    if (stack) {
      stack.quantity = (stack.quantity ?? 1) + quantity;
      return stack.slot;
    }
  }
  let at: { x: number; y: number } | null = null;
  if (catalog && def) {
    const occupied = [...layoutInventoryGrid(inv, catalog)].map(([, placement]) => placement);
    at = firstFreeGridPosition(INVENTORY_GRID, def, occupied);
    if (!at) return null;
  }
  const used = new Set(inv.map((e) => e.slot));
  for (let s = 0; s < INVENTORY_SLOTS; s++) {
    if (!used.has(s)) {
      inv.push({
        slot: s,
        itemId,
        equipped: false,
        ...(quantity > 1 ? { quantity } : {}),
        ...(at ? { x: at.x, y: at.y } : {}),
      });
      inv.sort((a, b) => a.slot - b.slot);
      return s;
    }
  }
  return null;
}

/** Item types worn on the character (one of each). */
export function isEquippable(type: ItemType): boolean {
  return type === 'weapon' || type === 'shield' || type === 'armor';
}

/**
 * Equips (unequipping whatever occupies the same equipment slot) or unequips the item in `slot`,
 * into the bag cell `to` when given (it must be free), else the first free area.
 * Returns false for an empty slot, an unknown item or a no-op.
 */
export function setEquipped(inv: InventoryEntry[], slot: number, equip: boolean, catalog: ItemCatalog, to?: { x: number; y: number }): boolean {
  const entry = inv.find((e) => e.slot === slot);
  const def = entry && catalog.get(entry.itemId);
  if (!entry || !def || entry.equipped === equip || !isEquippable(def.type)) return false;
  // Unequipping must reserve the item's complete rectangle before changing any state.
  if (!equip) {
    const occupied = [...layoutInventoryGrid(inv, catalog)].map(([, placement]) => placement);
    const at = to ? (canPlaceGrid(INVENTORY_GRID, { ...to, width: def.width, height: def.height }, occupied) ? to : null) : firstFreeGridPosition(INVENTORY_GRID, def, occupied);
    if (!at) return false;
    entry.x = at.x;
    entry.y = at.y;
    entry.equipped = false;
    return true;
  }
  const prev = inv.find((e) => e.equipped && catalog.get(e.itemId)?.type === def.type);
  if (prev) {
    const prevDef = catalog.get(prev.itemId);
    if (prevDef) {
      const bagWithoutEntry = inv.filter((e) => e.slot !== slot);
      const occupied = [...layoutInventoryGrid(bagWithoutEntry, catalog)].map(([, placement]) => placement);
      const at = firstFreeGridPosition(INVENTORY_GRID, prevDef, occupied);
      if (!at) return false;
      prev.equipped = false;
      prev.x = at.x;
      prev.y = at.y;
    } else {
      prev.equipped = false;
    }
  }
  delete entry.x;
  delete entry.y;
  entry.equipped = true;
  return true;
}

/** Combines two compatible stacks atomically. Returns false without changing either on failure. */
export function mergeInventoryStacks(inv: InventoryEntry[], fromSlot: number, toSlot: number, catalog: ItemCatalog): boolean {
  if (fromSlot === toSlot) return false;
  const from = inv.find((e) => e.slot === fromSlot);
  const to = inv.find((e) => e.slot === toSlot);
  const def = from && catalog.get(from.itemId);
  if (!from || !to || !def?.stackable || from.equipped || to.equipped || from.itemId !== to.itemId) return false;
  const total = (from.quantity ?? 1) + (to.quantity ?? 1);
  if (total > MAX_STACK) return false;
  to.quantity = total;
  inv.splice(inv.indexOf(from), 1);
  return true;
}

/** Splits a carried stack into a free legacy slot and a free grid origin, or leaves it intact. */
export function splitInventoryStack(inv: InventoryEntry[], slot: number, quantity: number, catalog: ItemCatalog): boolean {
  const source = inv.find((e) => e.slot === slot);
  const def = source && catalog.get(source.itemId);
  const available = source?.quantity ?? 1;
  if (!source || !def?.stackable || source.equipped || !Number.isInteger(quantity) || quantity < 1 || quantity >= available) return false;
  const usedSlots = new Set(inv.map((e) => e.slot));
  const freeSlot = Array.from({ length: INVENTORY_SLOTS }, (_, i) => i).find((i) => !usedSlots.has(i));
  if (freeSlot === undefined) return false;
  const occupied = [...layoutInventoryGrid(inv, catalog)].map(([, placement]) => placement);
  const at = firstFreeGridPosition(INVENTORY_GRID, def, occupied);
  if (!at) return false;
  source.quantity = available - quantity;
  inv.push({ slot: freeSlot, itemId: source.itemId, equipped: false, quantity, x: at.x, y: at.y });
  inv.sort((a, b) => a.slot - b.slot);
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
    const grid = !eq && Number.isInteger(e.x) && Number.isInteger(e.y) && e.x! >= 0 && e.y! >= 0 ? { x: e.x!, y: e.y! } : {};
    out.push(def.stackable && q > 1 ? { slot: e.slot, itemId: e.itemId, equipped: eq, quantity: Math.min(MAX_STACK, q), ...grid } : { slot: e.slot, itemId: e.itemId, equipped: eq, ...grid });
  }
  return out;
}

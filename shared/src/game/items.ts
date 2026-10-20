import { DAMAGE_TYPES, type Attributes } from './original_stats.ts';
import { damageVector, type DamageType, type DamageVector } from './ruleset.ts';
import { SPELL_BOOK_PARAMS, type SpellId } from './spells.ts';
import { canPlaceGrid, firstFreeGridPosition, INVENTORY_GRID, layoutInventoryGrid } from './inventory_grid.ts';
import { withMods } from './item_mods.ts';

/**
 * Equipment items. The built-in catalog holds the numbers of the items the slice uses, recorded
 * as facts from items.ctx (gameplay-mechanics.md); a converted installation's
 * `rules/items.json` (converter/src/formats/items_ctx.ts) can replace it with the full table via
 * catalogFromItemRules().
 */
export type ItemType = 'weapon' | 'shield' | 'armor' | 'potion' | 'spellbook' | 'key' | 'material' | AccessoryType;

/**
 * Worn pieces besides weapon, shield and armour. items.ctx has RING and BOOTS (rings with
 * `Equip BOOST_ATTRIBUTE / BOOST_PROTECTION`); helm, amulet, gloves and belt are not original
 * (the MU-style paper doll).
 */
export type AccessoryType = 'ring' | 'amulet' | 'helm' | 'gloves' | 'belt' | 'boots';
export const ACCESSORY_TYPES: readonly AccessoryType[] = ['ring', 'amulet', 'helm', 'gloves', 'belt', 'boots'];

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
  /** items.ctx `Texture`: index into the model's texture list in models.ctx (potion colours...). */
  texture?: number;
  /** Weapons: damage per type (items.ctx `SetDamage`). */
  damage?: DamageVector;
  /** Weapons: swing-rate multiplier (items.ctx `Speed`). */
  speed?: number;
  /** Armour, rings: damage-taken multipliers (items.ctx `SetProtection`, a ring's `Equip BOOST_PROTECTION`), 1 = none. */
  protection?: DamageVector;
  /** Worn: added to the attributes (a ring's `Equip BOOST_ATTRIBUTE`, the placeholder accessories). */
  attributes?: Partial<Attributes>;
  /** Worn, with MMO mods (item_mods.ts): extra maximum hit points / mana. */
  bonusHp?: number;
  bonusMana?: number;
  /** Potions with `Use HEAL`: hit points restored (items.ctx `UseParameters`). */
  heal?: number;
  /** Potions with `Use RESTORE_MANA`: mana restored (items.ctx `UseParameters`). */
  mana?: number;
  /** Potions with `Use BOOST_PROTECTION` / `BOOST_ATTRIBUTE`: the effect's seconds (`UseParameters` first argument). */
  duration?: number;
  /** Boost potions: what they do for `duration` seconds (`UseParameters` second and third arguments). */
  boost?: ItemBoost;
  /** Spell books (items.ctx `Use GRANT_SPELL`): the spell learned when picked up. */
  spell?: SpellId;
  /** Several of the same item share one inventory slot. */
  stackable?: boolean;
  /**
   * Key items: door keys, quest items and the story's quest trinkets. Kept on the inventory's
   * Key Items page (the original's "Quest Items" page, 0x472C20), not in the bag. They take no
   * bag cell and cannot be dropped, moved or sold.
   */
  keyItem?: boolean;
  /**
   * Handed out by the story, never picked up: items.ctx `Type QUEST` and the `Permanent` trinkets
   * (Scout's Message, War Plans...). Ground items and chests of these are left out.
   */
  questItem?: boolean;
  /**
   * items.ctx `Quest` of a QUEST item: its player bit (+0x1C1). A quest trigger with action 0x40
   * sets `1 << bit` (0x46435B), which gives the item: 0 Horn of Shattering ... 5 Message for Dain.
   */
  questBit?: number;
  /**
   * Shields: what the raised shield stops (its `Use` BLOCK / REFLECT / DRINK_SOUL behaviour's mask,
   * USE_MASK bits; 0x401F20). Default MELEE | PROJECTILE; `UseParameters(FIREBALL)` adds
   * explosions, `(LIGHTNING)` bolts, `(GIANTS)` blows of the big creatures.
   */
  blocks?: number;
  /** Shields with `Use REFLECT` (Reflective Shield): a stopped bolt goes back to its caster. */
  reflects?: boolean;
  /**
   * `Use DRINK_SOUL` (0x004014C0): a weapon on each landed blow, a shield on each stopped blow,
   * draws up to `amount` HP from the other creature into the bearer; the big creatures only with
   * the GIANTS bit (Blade of Hunger 1 + GIANTS, Rod of Necros 5, Vampiric Shield 3).
   */
  soulDrink?: { amount: number; giants: boolean };
  /**
   * `Use BOOMER` (Boomer Axe, 0x00401000): each landed blow throws the weapon itself as a magic
   * axe (0x0043EAE0) that flies back to the wielder's hand (executable-analysis §23).
   */
  boomer?: boolean;
  /** Armour: Drake's body while worn (items.ctx `SetArmorSkin(model, texture)`, models.ctx 121 / 124). */
  armorSkin?: { model: number; texture: number };
  price: number;
}

/** A shield's / soul drinker's target mask (0x4EA0F0 names → 0x4EA104 bits). */
export const USE_MASK = { MELEE: 1, PROJECTILE: 2, FIREBALL: 4, LIGHTNING: 8, GIANTS: 16 } as const;
/** BLOCK, REFLECT and DRINK_SOUL start with MELEE | PROJECTILE (0x0040253D, 0x004025C9, 0x0040271A). */
const DEFAULT_USE_MASK = USE_MASK.MELEE | USE_MASK.PROJECTILE;
/** DRINK_SOUL's amount before its `UseParameters` (10.0, 0x00402557). */
const DEFAULT_SOUL_DRINK = 10;

/**
 * A `UseParameters` list for BLOCK / REFLECT / DRINK_SOUL (0x00401700 / 0x00401990 / 0x00402030):
 * CLEAR empties the mask, a mask name adds its bit, a number (DRINK_SOUL only) is the amount.
 */
function useMask(params: readonly (string | number)[]): { mask: number; amount?: number } {
  let mask: number = DEFAULT_USE_MASK;
  let amount: number | undefined;
  for (const p of params) {
    if (typeof p === 'number') amount = p;
    else if (p.toUpperCase() === 'CLEAR') mask = 0;
    else mask |= USE_MASK[p.toUpperCase() as keyof typeof USE_MASK] ?? 0;
  }
  return { mask, ...(amount !== undefined ? { amount } : {}) };
}

/**
 * A boost potion's effect, a timed status (executable-analysis §20, 0x00401AB0 / 0x00401D10):
 * BOOST_PROTECTION multiplies the damage taken of one type (kind 6, 0.25 = a quarter taken);
 * BOOST_ATTRIBUTE adds to one attribute (kinds 9-12, capped at 50 with the base).
 */
export type ItemBoost =
  | { kind: 'protection'; type: DamageType; multiplier: number }
  | { kind: 'attribute'; attribute: keyof Attributes; amount: number };

/** BOOST_ATTRIBUTE's attribute names (0x0044E2D0: indexes 0-3 = kinds 9-12). */
const BOOST_ATTRIBUTES: Readonly<Record<string, keyof Attributes>> = { MIGHT: 'might', INTELLIGENCE: 'intellect', ENDURANCE: 'endurance', SPEED: 'speed' };

/** A boost potion's `Use` and `UseParameters` (duration, type or attribute, amount), or undefined. */
function itemBoost(use: unknown, args: readonly (string | number)[]): ItemBoost | undefined {
  const what = String(args[1] ?? '').trim().toUpperCase();
  const amount = Number(args[2]);
  if (!Number.isFinite(amount)) return undefined;
  if (use === 'BOOST_PROTECTION') {
    const type = DAMAGE_TYPES.find((t) => t === what);
    return type ? { kind: 'protection', type, multiplier: amount } : undefined;
  }
  if (use === 'BOOST_ATTRIBUTE') {
    const attribute = BOOST_ATTRIBUTES[what];
    // The status value is truncated to an integer when added (0x0047E800-0x0047E890, ftol).
    return attribute ? { kind: 'attribute', attribute, amount: Math.trunc(amount) } : undefined;
  }
  return undefined;
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
const potion = (name: string, heal: number, price: number, model?: number, mana?: number, duration?: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'potion', width: 1, height: 1, ...(heal ? { heal } : {}), ...(mana ? { mana } : {}), ...(duration ? { duration } : {}), stackable: true, price, ...(model !== undefined ? { model } : {}) });
const spellBook = (name: string, spell: SpellId, price: number, model?: number): ItemDef =>
  ({ id: itemSlug(name), name, type: 'spellbook', width: 1, height: 1, spell, price, ...(model !== undefined ? { model } : {}) });
const accessory = (name: string, type: AccessoryType, width: number, height: number, price: number, attributes?: Partial<Attributes>, model?: number): ItemDef =>
  ({ id: itemSlug(name), name, type, width, height, price, ...(attributes ? { attributes } : {}), ...(model !== undefined ? { model } : {}) });
const key = (name: string, price: number, model?: number, keyItem = false): ItemDef =>
  ({ id: itemSlug(name), name, type: 'key', width: 1, height: 1, price, ...(model !== undefined ? { model } : {}), ...(keyItem ? { keyItem } : {}) });

/**
 * Refinement materials (MMO): new catalogue items, stackable, drawn with existing models. They
 * drop from creatures with `mmoItems` on (item_mods.ts MATERIAL_DROPS).
 */
export const MATERIAL_ITEMS: readonly ItemDef[] = [
  { id: 'iron_scrap', name: 'Iron Scrap', type: 'material', width: 1, height: 1, price: 10, stackable: true, model: 105 },
  { id: 'polishing_stone', name: 'Polishing Stone', type: 'material', width: 1, height: 1, price: 25, stackable: true, model: 110 },
  { id: 'mithril_crystal', name: 'Mithril Crystal', type: 'material', width: 1, height: 1, price: 60, stackable: true, model: 69 },
  { id: 'enchanted_dust', name: 'Enchanted Dust', type: 'material', width: 1, height: 1, price: 120, stackable: true, model: 141, texture: 1 },
  { id: 'celestial_gem', name: 'Celestial Gem', type: 'material', width: 1, height: 1, price: 900, stackable: true, model: 198 },
  { id: 'divine_catalyst', name: 'Divine Catalyst', type: 'material', width: 1, height: 1, price: 2500, stackable: true, model: 138, texture: 3 },
];

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
    // Placeholders for the paper doll's other slots (not original): +1 Speed, +1 Might each.
    accessory('Leather Cap', 'helm', 2, 2, 50, { speed: 1, might: 1 }),
    accessory('Bone Amulet', 'amulet', 1, 1, 50, { speed: 1, might: 1 }, 67),
    accessory('Leather Gloves', 'gloves', 2, 2, 50, { speed: 1, might: 1 }),
    accessory('Leather Belt', 'belt', 2, 1, 50, { speed: 1, might: 1 }),
    accessory('Leather Boots', 'boots', 2, 2, 50, { speed: 1, might: 1 }),
    ...MATERIAL_ITEMS,
  ].map((d) => [d.id, d]),
);

/** Shape of one entry in the converter's rules/items.json. */
interface ItemRule {
  name: string;
  parent?: string | null;
  fields: Record<string, string | number>;
  damage: Partial<Record<string, number>>;
  protection: Partial<Record<string, number>>;
  calls?: { name: string; args: (string | number)[] }[];
}

type RuleCall = NonNullable<ItemRule['calls']>[number];

/**
 * An item's calls with its parents' (the engine copies the parent and runs the child's statements
 * after): a parent's call survives unless the child makes its own of that name. items.json only
 * keeps the child's when it has any (Enoch's Plate of Might loses Heavy Plate Mail's
 * SetArmorSkin), so the chain is walked here.
 */
function inheritedCalls(rule: ItemRule, byName: ReadonlyMap<string, ItemRule>, depth = 0): RuleCall[] {
  const own = rule.calls ?? [];
  const parent = rule.parent ? byName.get(rule.parent.toLowerCase()) : undefined;
  if (!parent || depth > 32) return [...own];
  const names = new Set(own.map((c) => c.name));
  return [...inheritedCalls(parent, byName, depth + 1).filter((c) => !names.has(c.name)), ...own];
}

/** `Equip BOOST_ATTRIBUTE / BOOST_PROTECTION` + `EquipParameters(-1, what, amount)` on any worn item. */
function withEquipBoost(def: ItemDef, equip: unknown, calls: readonly RuleCall[]): ItemDef {
  const boost = itemBoost(equip, calls.find((c) => c.name === 'EquipParameters')?.args ?? []);
  if (boost?.kind === 'attribute') return { ...def, attributes: { ...def.attributes, [boost.attribute]: (def.attributes?.[boost.attribute] ?? 0) + boost.amount } };
  if (boost?.kind === 'protection') {
    const base = def.protection ?? damageVector({}, 1);
    const extra = damageVector({ [boost.type]: boost.multiplier }, 1);
    return { ...def, protection: base.map((v, t) => v * (extra[t] ?? 1)) };
  }
  return def;
}

/** Reads a positive integral inventory dimension, falling back safely for incomplete data. */
function itemDimension(value: string | number | undefined): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function withSourceShape(def: ItemDef, fields: ItemRule['fields']): ItemDef {
  const model = Number(fields['Model']);
  const texture = Number(fields['Texture']);
  return {
    ...def,
    width: itemDimension(fields['Width']),
    height: itemDimension(fields['Height']),
    ...(Number.isInteger(model) && model >= 0 ? { model } : {}),
    ...(Number.isInteger(texture) && texture > 0 ? { texture } : {}),
  };
}

/**
 * Builds a catalog from converted items.json (melee weapons, shields, body armour), layered over
 * the built-in items (weapons, armour, potions, books, keys, quest items...). Other types are ignored.
 */
export function catalogFromItemRules(rules: { items: readonly ItemRule[] }): ItemCatalog {
  const out = new Map(BUILTIN_ITEMS);
  const byName = new Map(rules.items.map((r) => [r.name.toLowerCase(), r]));
  for (const r of rules.items) {
    const type = String(r.fields['Type'] ?? '');
    const price = Number(r.fields['Price'] ?? 0) || 0;
    const calls = inheritedCalls(r, byName);
    // Every UseParameters line, in order (Blade of Hunger has two: 1 and GIANTS).
    const useParams = calls.filter((c) => c.name === 'UseParameters').flatMap((c) => c.args);
    const use = String(r.fields['Use'] ?? '');
    let def: ItemDef | null = null;
    // THROWABLE (Boomer Axe) and MISSILE (Dasher Hand Bow, sold in Du9c) swing like the rest in
    // Drake's hand: he has no ASM_THROW_ITEM clip, so the throw / shot (0x0042C77F / 0x0042C7BE,
    // on that clip's event) never comes, and no level holds an Arrow.
    if (type === 'WEAPON' && ['MELEE', 'THROWABLE', 'MISSILE'].includes(String(r.fields['SubType']))) {
      def = weapon(r.name, r.damage as Partial<Record<DamageType, number>>, Number(r.fields['Speed'] ?? 1) || 1, price);
      if (use === 'DRINK_SOUL') {
        const { mask, amount } = useMask(useParams);
        def = { ...def, soulDrink: { amount: amount ?? DEFAULT_SOUL_DRINK, giants: (mask & USE_MASK.GIANTS) !== 0 } };
      }
      if (use === 'BOOMER') def = { ...def, boomer: true };
      def = withEquipBoost(def, r.fields['Equip'], calls);
    } else if (type === 'SHIELD') {
      def = shield(r.name, price);
      const { mask, amount } = useMask(useParams);
      def = { ...def, blocks: mask };
      if (Object.keys(r.protection).length) def = { ...def, protection: damageVector(r.protection as Partial<Record<DamageType, number>>, 1) };
      if (use === 'REFLECT') def = { ...def, reflects: true };
      if (use === 'DRINK_SOUL') def = { ...def, soulDrink: { amount: amount ?? DEFAULT_SOUL_DRINK, giants: (mask & USE_MASK.GIANTS) !== 0 } };
      def = withEquipBoost(def, r.fields['Equip'], calls);
    } else if (type === 'ARMOR') {
      def = armor(r.name, r.protection as Partial<Record<DamageType, number>>, price);
      const skin = calls.find((c) => c.name === 'SetArmorSkin')?.args;
      if (skin && Number.isInteger(Number(skin[0]))) def = { ...def, armorSkin: { model: Number(skin[0]), texture: Number(skin[1] ?? 0) || 0 } };
      def = withEquipBoost(def, r.fields['Equip'], calls);
    } else if (type === 'SPELLBOOK' && r.fields['Use'] === 'GRANT_SPELL') {
      // Inherited books keep the parent's Use; the spell is the book's own UseParameters.
      const spell = SPELL_BOOK_PARAMS[String(r.calls?.find((c) => c.name === 'UseParameters')?.args[0] ?? '')];
      if (spell) def = spellBook(r.name, spell, price);
    } else if (type === 'POTION') {
      const use = r.fields['Use'];
      const args = r.calls?.find((c) => c.name === 'UseParameters')?.args ?? [];
      const amount = Number(args[0] ?? 0);
      const boost = itemBoost(use, args);
      def = potion(r.name, use === 'HEAL' ? amount : 0, price, undefined, use === 'RESTORE_MANA' ? amount : undefined, boost && amount > 0 ? amount : undefined);
      // A duration of 0 or less is the permanent (equip) form; a potion's always has one.
      if (boost && amount > 0) def = { ...def, boost };
    } else if (type === 'USEABLE' && / Key$/.test(r.name)) {
      def = key(r.name, price, undefined, true);
    } else if (type === 'QUEST') {
      const bit = Number(r.fields['Quest']);
      def = { ...key(r.name, price, undefined, true), questItem: true, ...(Number.isInteger(bit) && bit >= 0 && bit < 8 ? { questBit: bit } : {}) };
    } else if (type === 'TRINKET' && String(r.fields['Permanent']).toLowerCase() === 'true') {
      def = { ...key(r.name, price, undefined, true), questItem: true };
    } else if (type === 'BOOTS' && String(r.fields['Permanent']).toLowerCase() === 'true') {
      // Dasher Boots: a story item like the Permanent trinkets.
      def = { ...key(r.name, price, undefined, true), questItem: true };
    } else if (type === 'RING' || type === 'BOOTS') {
      // `Equip` + `EquipParameters` (-1 = while worn, what, amount), the same arguments as a boost potion's.
      def = withEquipBoost(accessory(r.name, type === 'RING' ? 'ring' : 'boots', 1, 1, price), r.fields['Equip'], calls);
    }
    if (def && def.id) {
      // items.ctx `Name` is what the game shows (Soul Sucker reads "Blade of Hunger"); the id stays the engine name's.
      const shown = typeof r.fields['Name'] === 'string' ? r.fields['Name'].trim() : '';
      const shaped = { ...withSourceShape(def, r.fields), ...(shown ? { name: shown } : {}) };
      out.set(shaped.id, shaped);
      out.set(r.name, shaped);
      if (shown) {
        out.set(itemSlug(shown), shaped);
        out.set(shown, shaped);
      }
    }
  }
  return out;
}

/** The QUEST item a quest trigger's player bit gives (items.ctx `Quest`), if any. */
export function questItemForBit(catalog: ItemCatalog, bit: number): ItemDef | undefined {
  for (const def of catalog.values()) if (def.questBit === bit) return def;
  return undefined;
}

/** Every Mana Crystals item (Mana Crystals 2 / 3 are the same item on other models). */
export function isManaCrystals(def: Pick<ItemDef, 'id'>): boolean {
  return /^mana_crystals(_\d+)?$/.test(def.id);
}

/**
 * Potion cooldowns (not in the original): Greater
 * Healing 60 s, other healing and the Mana Potion 30 s, Mana Crystals 10 s; a boost potion
 * (resistances, speed) until its effect wears off. Each potion has its own; the crystals share one.
 */
export function potionCooldown(def: ItemDef): { group: string; seconds: number } | null {
  if (def.type !== 'potion') return null;
  if (isManaCrystals(def)) return { group: 'mana_crystals', seconds: 10 };
  if (def.duration) return { group: def.id, seconds: def.duration };
  if (def.id === 'greater_healing_potion') return { group: def.id, seconds: 60 };
  return { group: def.id, seconds: 30 };
}

export const UNARMED: Readonly<ItemDef> = { id: 'unarmed', name: 'Unarmed', type: 'weapon', width: 1, height: 1, damage: damageVector({}), speed: 1, price: 0 };

/**
 * Item rarity tiers (MMO, not original; docs/game-design/mmo/03): an item without mods is the
 * original's own, Battle-worn.
 */
export const RARITIES = ['worn', 'mundane', 'tempered', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

/** One rolled affix: a named bonus of a stat ("attr:might", "dmg:FIRE", "res:EARTH", "hp", "mana"). */
export interface ItemAffix {
  id: string;
  /** Rolled magnitude (attribute points, damage points, resist fraction, hit points). */
  value: number;
  /** Its tier 0..11 (item_mods.ts AFFIX_TIERS); absent on affixes rolled before tiers. */
  tier?: number;
}

/**
 * What makes one item instance differ from its catalogue entry (MMO, not original): rarity,
 * affixes, refinement (+0..+10) with its failstack pity, binding. Absent = the plain item.
 */
export interface ItemMods {
  rarity?: Rarity;
  affixes?: ItemAffix[];
  /** Refinement level 0..10 (docs/game-design/mmo/04). */
  plus?: number;
  /** Failed refinement attempts since the last success (pity). */
  failstacks?: number;
  /** Bound to its owner: cannot be traded or listed. */
  bound?: boolean;
  /** Item level 1..100: the level of the creature or area it came from; caps its affix tiers. */
  ilvl?: number;
}

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
  /** This instance's stable identity (a UUID; the inventory row's id since migration 007). */
  uid?: string;
  /** Its own rarity, affixes and refinement (MMO): never on stackable items. */
  mods?: ItemMods;
}

export const ITEM_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PLUS = 10;
const AFFIX_ID = /^(attr:(might|intelligence|endurance|speed)|dmg:[A-Z]{3,6}|res:[A-Z]{3,6}|hp|mana)$/;

/** Item mods from untrusted storage, or undefined when there is nothing valid. */
export function sanitizeMods(raw: unknown): ItemMods | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: ItemMods = {};
  if (typeof o.rarity === 'string' && (RARITIES as readonly string[]).includes(o.rarity) && o.rarity !== 'worn') out.rarity = o.rarity as Rarity;
  if (Array.isArray(o.affixes)) {
    const affixes = o.affixes
      .filter((a): a is ItemAffix => !!a && typeof a === 'object' && typeof (a as ItemAffix).id === 'string' && AFFIX_ID.test((a as ItemAffix).id) && Number.isFinite((a as ItemAffix).value))
      .slice(0, 6)
      .map((a) => ({ id: a.id, value: Math.round(a.value * 1000) / 1000, ...(Number.isInteger(a.tier) && a.tier! >= 0 && a.tier! <= 11 ? { tier: a.tier } : {}) }));
    if (affixes.length) out.affixes = affixes;
  }
  if (Number.isInteger(o.plus) && (o.plus as number) > 0) out.plus = Math.min(MAX_PLUS, o.plus as number);
  if (Number.isInteger(o.failstacks) && (o.failstacks as number) > 0) out.failstacks = Math.min(1000, o.failstacks as number);
  if (o.bound === true) out.bound = true;
  if (Number.isInteger(o.ilvl) && (o.ilvl as number) >= 1) out.ilvl = Math.min(100, o.ilvl as number);
  return Object.keys(out).length ? out : undefined;
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
  /** Rings, amulet, helm, gloves, belt, boots worn. */
  accessories: ItemDef[];
  /** Every worn item's damage-taken multipliers, multiplied (armour and rings). */
  protection: DamageVector;
  /** Every worn item's attribute bonus, summed. */
  attributes: Partial<Attributes>;
  /** MMO mods (item_mods.ts): extra maximum hit points and mana from worn items. */
  bonusHp: number;
  bonusMana: number;
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
  const eq: Equipment = { weapon: UNARMED, shield: null, armor: null, accessories: [], protection: damageVector({}, 1), attributes: {}, bonusHp: 0, bonusMana: 0 };
  for (const e of inv) {
    if (!e.equipped) continue;
    const base = catalog.get(e.itemId);
    if (!base) continue;
    // Its own rarity, affixes and refinement (MMO; the plain item without mods).
    const def = withMods(base, e.mods);
    eq.bonusHp += def.bonusHp ?? 0;
    eq.bonusMana += def.bonusMana ?? 0;
    if (def.type === 'weapon') eq.weapon = def;
    else if (def.type === 'shield' || def.type === 'armor') eq[def.type] = def;
    else if (isAccessory(def.type)) eq.accessories.push(def);
    else continue;
    if (def.protection) eq.protection = eq.protection.map((v, t) => v * (def.protection![t] ?? 1));
    for (const [k, v] of Object.entries(def.attributes ?? {}) as [keyof Attributes, number][]) eq.attributes[k] = (eq.attributes[k] ?? 0) + v;
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
  if (catalog && def && !def.keyItem) {
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

export function isAccessory(type: ItemType): type is AccessoryType {
  return (ACCESSORY_TYPES as readonly ItemType[]).includes(type);
}

/** Item types worn on the character. */
export function isEquippable(type: ItemType): boolean {
  return type === 'weapon' || type === 'shield' || type === 'armor' || isAccessory(type);
}

/** How many of a type can be worn at once: two rings, one of everything else. */
export function equipCapacity(type: ItemType): number {
  return type === 'ring' ? 2 : isEquippable(type) ? 1 : 0;
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
  // A full slot gives up its first worn item (both ring slots full: the first ring).
  const worn = inv.filter((e) => e.equipped && catalog.get(e.itemId)?.type === def.type);
  const prev = worn.length >= equipCapacity(def.type) ? worn[0] : undefined;
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

/** Drops unknown items and invalid / duplicate slots and keeps at most equipCapacity equipped items per type. */
export function sanitizeInventory(inv: readonly InventoryEntry[], catalog: ItemCatalog): InventoryEntry[] {
  const out: InventoryEntry[] = [];
  const slots = new Set<number>();
  const equipped = new Map<ItemType, number>();
  const uids = new Set<string>();
  for (const e of [...inv].sort((a, b) => a.slot - b.slot)) {
    const def = catalog.get(e.itemId);
    if (!def || !Number.isInteger(e.slot) || e.slot < 0 || e.slot >= INVENTORY_SLOTS || slots.has(e.slot)) continue;
    slots.add(e.slot);
    const eq = e.equipped && (equipped.get(def.type) ?? 0) < equipCapacity(def.type);
    if (eq) equipped.set(def.type, (equipped.get(def.type) ?? 0) + 1);
    const q = Math.floor(e.quantity ?? 1);
    const grid = !eq && !def.keyItem && Number.isInteger(e.x)
      && Number.isInteger(e.y) && e.x! >= 0 && e.y! >= 0 ? { x: e.x!, y: e.y! } : {};
    const uid = typeof e.uid === 'string' && ITEM_UID.test(e.uid) && !uids.has(e.uid.toLowerCase()) ? e.uid.toLowerCase() : undefined;
    if (uid) uids.add(uid);
    const mods = def.stackable ? undefined : sanitizeMods(e.mods);
    const extra = { ...(uid ? { uid } : {}), ...(mods ? { mods } : {}) };
    out.push(def.stackable && q > 1 ? { slot: e.slot, itemId: e.itemId, equipped: eq, quantity: Math.min(MAX_STACK, q), ...grid, ...extra } : { slot: e.slot, itemId: e.itemId, equipped: eq, ...grid, ...extra });
  }
  return out;
}

/**
 * Rarity, affixes and refinement (MMO Stage 3, not original; docs/game-design/mmo/03, 04).
 * Behind the server feature `mmoItems`: with it off nothing rolls, every item stays the
 * original's, and items rolled while it was on keep their mods.
 *
 * - Rarity: one uniform roll against cumulative thresholds (0.1 % legendary, 4.9 % tempered,
 *   25 % mundane, the rest the original's Battle-worn). Multiplier 1.2 / 1.5 / 2.0 on the base
 *   damage or protection, and 2 / 4 / 4 affixes.
 * - Refinement +1..+10: +4 % .. +50 % on top of the rarity, at a merchant, for gold and materials;
 *   never destroys or lowers the item; each failure adds the level's failstack bonus.
 * - Pipeline: (base × rarity × (1 + refinement)) + flat affixes; protection the same on the part
 *   it takes away; a resistance never above 75 %.
 */
import { DAMAGE_TYPES, type Attributes } from './original_stats.ts';
import type { InventoryEntry, ItemAffix, ItemCatalog, ItemDef, ItemMods, Rarity } from './items.ts';

export const RARITY_INFO: Readonly<Record<Rarity, { chance: number; mult: number; affixes: number; label: string; color: string }>> = {
  worn: { chance: 0.7, mult: 1, affixes: 0, label: 'Battle-worn', color: '#9e9e9e' },
  mundane: { chance: 0.25, mult: 1.2, affixes: 2, label: 'Mundane', color: '#4fa3f7' },
  tempered: { chance: 0.049, mult: 1.5, affixes: 4, label: 'Tempered', color: '#b052c8' },
  legendary: { chance: 0.001, mult: 2, affixes: 4, label: 'Legendary', color: '#ff9800' },
};

/** One uniform roll: legendary below 0.001, tempered below 0.05, mundane below 0.3. */
export function rollRarity(u: number): Rarity {
  if (u < 0.001) return 'legendary';
  if (u < 0.05) return 'tempered';
  if (u < 0.3) return 'mundane';
  return 'worn';
}

/** Items that can carry mods: what is worn or wielded. */
export function moddable(def: Pick<ItemDef, 'type' | 'stackable' | 'keyItem' | 'questItem'>): boolean {
  if (def.stackable || def.keyItem || def.questItem) return false;
  return def.type === 'weapon' || def.type === 'shield' || def.type === 'armor' || def.type === 'ring' || def.type === 'amulet' || def.type === 'helm' || def.type === 'gloves' || def.type === 'belt' || def.type === 'boots';
}

const ATTRS = ['might', 'intelligence', 'endurance', 'speed'] as const;
const ELEMENTS = ['FIRE', 'AIR', 'EARTH', 'WATER', 'LIGHT', 'DARK'] as const;

/** An affix pool entry: its id (or a family), the item kinds it rolls on, its range and weight. */
interface AffixKind {
  family: 'attr' | 'dmg' | 'res' | 'hp' | 'mana';
  on: 'weapon' | 'defence' | 'any';
  min: number;
  max: number;
  weight: number;
  integer: boolean;
}

const AFFIXES: readonly AffixKind[] = [
  { family: 'attr', on: 'any', min: 1, max: 5, weight: 60, integer: true },
  { family: 'dmg', on: 'weapon', min: 2, max: 12, weight: 80, integer: true },
  { family: 'res', on: 'defence', min: 0.03, max: 0.18, weight: 70, integer: false },
  { family: 'hp', on: 'defence', min: 10, max: 50, weight: 100, integer: true },
  { family: 'mana', on: 'any', min: 15, max: 60, weight: 100, integer: true },
];

/** Its rolled mods (rarity and affixes) for a new item instance, or undefined (Battle-worn). */
export function rollMods(def: ItemDef, random: () => number): ItemMods | undefined {
  if (!moddable(def)) return undefined;
  const rarity = rollRarity(random());
  if (rarity === 'worn') return undefined;
  const kind = def.type === 'weapon' ? 'weapon' : 'defence';
  const pool = AFFIXES.filter((a) => a.on === 'any' || a.on === kind);
  const total = pool.reduce((n, a) => n + a.weight, 0);
  const affixes: ItemAffix[] = [];
  for (let i = 0; i < RARITY_INFO[rarity].affixes; i++) {
    let pick = random() * total;
    const a = pool.find((x) => (pick -= x.weight) < 0) ?? pool[0]!;
    const raw = a.min + random() * (a.max - a.min);
    const value = a.integer ? Math.round(raw) : Math.round(raw * 100) / 100;
    const id =
      a.family === 'attr' ? `attr:${ATTRS[Math.floor(random() * ATTRS.length)]}`
      : a.family === 'dmg' ? `dmg:${weaponDamageType(def)}`
      : a.family === 'res' ? `res:${ELEMENTS[Math.floor(random() * ELEMENTS.length)]}`
      : a.family;
    // The same affix twice adds up.
    const same = affixes.find((x) => x.id === id);
    if (same) same.value = Math.round((same.value + value) * 100) / 100;
    else affixes.push({ id, value });
  }
  return { rarity, ...(affixes.length ? { affixes } : {}) };
}

/** The physical type a weapon mostly deals (its flat damage affix adds to it). */
function weaponDamageType(def: ItemDef): string {
  const d = def.damage ?? [];
  const slash = d[DAMAGE_TYPES.indexOf('SLASH')] ?? 0;
  const bash = d[DAMAGE_TYPES.indexOf('BASH')] ?? 0;
  return bash > slash ? 'BASH' : 'SLASH';
}

/** Refinement +1..+10 (04 §2.1): gold, materials, base chance, failstack bonus, power. */
export const REFINE_LEVELS: readonly { gold: number; material: string; count: number; chance: number; failBonus: number; power: number }[] = [
  { gold: 100, material: 'iron_scrap', count: 2, chance: 1, failBonus: 0, power: 0.04 },
  { gold: 250, material: 'iron_scrap', count: 4, chance: 1, failBonus: 0, power: 0.08 },
  { gold: 500, material: 'iron_scrap', count: 6, chance: 0.85, failBonus: 0.15, power: 0.12 },
  { gold: 1000, material: 'polishing_stone', count: 8, chance: 0.7, failBonus: 0.1, power: 0.16 },
  { gold: 2500, material: 'mithril_crystal', count: 10, chance: 0.55, failBonus: 0.075, power: 0.21 },
  { gold: 5000, material: 'mithril_crystal', count: 14, chance: 0.4, failBonus: 0.06, power: 0.26 },
  { gold: 9000, material: 'enchanted_dust', count: 18, chance: 0.3, failBonus: 0.05, power: 0.31 },
  { gold: 16000, material: 'enchanted_dust', count: 24, chance: 0.2, failBonus: 0.04, power: 0.36 },
  { gold: 30000, material: 'celestial_gem', count: 2, chance: 0.12, failBonus: 0.025, power: 0.42 },
  { gold: 60000, material: 'divine_catalyst', count: 5, chance: 0.06, failBonus: 0.015, power: 0.5 },
];

/** The next refinement of an item at `plus` (undefined at +10). */
export function nextRefine(plus = 0): (typeof REFINE_LEVELS)[number] | undefined {
  return REFINE_LEVELS[plus];
}

/** The chance of the next attempt: base + failstacks × bonus, at most 1. */
export function refineChance(plus = 0, failstacks = 0): number {
  const r = nextRefine(plus);
  return r ? Math.min(1, r.chance + failstacks * r.failBonus) : 0;
}

/** One attempt (u uniform in [0, 1)): the item's new mods. Never lower, never destroyed. */
export function refineOnce(mods: ItemMods | undefined, u: number): { mods: ItemMods; success: boolean } {
  const plus = mods?.plus ?? 0;
  const fail = mods?.failstacks ?? 0;
  const success = u < refineChance(plus, fail);
  const next: ItemMods = { ...mods };
  if (success) {
    next.plus = plus + 1;
    delete next.failstacks;
  } else next.failstacks = fail + 1;
  return { mods: next, success };
}

/** The refinement's bonus at +n (0 at +0). */
export function refinePower(plus = 0): number {
  return plus > 0 ? REFINE_LEVELS[Math.min(plus, REFINE_LEVELS.length) - 1]!.power : 0;
}

/** Highest resistance any item can give one damage type (03 §4.2): taken multiplier 0.25. */
export const MIN_PROTECTION = 0.25;

/**
 * An item as its mods make it: damage (weapons) and protection (armour, shields, rings) scaled by
 * rarity × (1 + refinement), then flat damage, attributes, resistances, hit points and mana.
 */
export function withMods(def: ItemDef, mods: ItemMods | undefined): ItemDef {
  if (!mods || (!mods.rarity && !mods.plus && !mods.affixes?.length)) return def;
  const m = RARITY_INFO[mods.rarity ?? 'worn'].mult * (1 + refinePower(mods.plus));
  const out: ItemDef = { ...def };
  if (def.damage) out.damage = def.damage.map((v) => Math.round(v * m * 100) / 100);
  if (def.protection) out.protection = def.protection.map((v) => Math.max(MIN_PROTECTION, 1 - (1 - v) * m));
  const attributes: Partial<Attributes> = { ...def.attributes };
  let hp = def.bonusHp ?? 0;
  let mana = def.bonusMana ?? 0;
  for (const a of mods.affixes ?? []) {
    const [family, what] = a.id.split(':') as [string, string | undefined];
    if (family === 'attr' && what) attributes[what as keyof Attributes] = (attributes[what as keyof Attributes] ?? 0) + a.value;
    else if (family === 'dmg' && what) {
      const t = DAMAGE_TYPES.indexOf(what as never);
      if (t >= 0) {
        const d = [...(out.damage ?? new Array(DAMAGE_TYPES.length).fill(0))];
        d[t] = (d[t] ?? 0) + a.value;
        out.damage = d;
      }
    } else if (family === 'res' && what) {
      const t = DAMAGE_TYPES.indexOf(what as never);
      if (t >= 0) {
        const p = [...(out.protection ?? new Array(DAMAGE_TYPES.length).fill(1))];
        p[t] = Math.max(MIN_PROTECTION, (p[t] ?? 1) * (1 - a.value));
        out.protection = p;
      }
    } else if (family === 'hp') hp += a.value;
    else if (family === 'mana') mana += a.value;
  }
  if (Object.keys(attributes).length) out.attributes = attributes;
  if (hp) out.bonusHp = hp;
  if (mana) out.bonusMana = mana;
  return out;
}

/** The item an inventory entry is, mods included (undefined: not in the catalogue). */
export function entryDef(e: Pick<InventoryEntry, 'itemId' | 'mods'>, catalog: ItemCatalog): ItemDef | undefined {
  const def = catalog.get(e.itemId);
  return def ? withMods(def, e.mods) : undefined;
}

/** "Tempered Long Sword +4" and its colour. */
export function modsTitle(name: string, mods: ItemMods | undefined): { title: string; color: string | null } {
  const rarity = mods?.rarity;
  const title = `${rarity ? `${RARITY_INFO[rarity].label} ` : ''}${name}${mods?.plus ? ` +${mods.plus}` : ''}`;
  return { title, color: rarity ? RARITY_INFO[rarity].color : null };
}

/** A tooltip line per affix ("+3 Might", "+12 % Fire resistance", "+30 hit points"). */
export function affixLines(mods: ItemMods | undefined): string[] {
  return (mods?.affixes ?? []).map((a) => {
    const [family, what] = a.id.split(':') as [string, string | undefined];
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    if (family === 'attr') return `+${a.value} ${cap(what ?? '')}`;
    if (family === 'dmg') return `+${a.value} ${cap(what ?? '')} damage`;
    if (family === 'res') return `+${Math.round(a.value * 100)} % ${cap(what ?? '')} resistance`;
    if (family === 'hp') return `+${a.value} hit points`;
    return `+${a.value} mana`;
  });
}

export const MATERIAL_DROPS: readonly { itemId: string; chance: number }[] = [
  { itemId: 'iron_scrap', chance: 0.2 },
  { itemId: 'polishing_stone', chance: 0.08 },
  { itemId: 'mithril_crystal', chance: 0.04 },
  { itemId: 'enchanted_dust', chance: 0.02 },
  { itemId: 'celestial_gem', chance: 0.005 },
  { itemId: 'divine_catalyst', chance: 0.002 },
];

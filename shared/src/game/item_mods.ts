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
 * - Affix tiers T0..T10 (T11 masterwork, never dropped): an item's level (its creature's or its
 *   act's, area_levels.ts) picks the window of four tiers it rolls in (tierWindow).
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

export type AffixFamily = 'attr' | 'dmg' | 'res' | 'hp' | 'mana';

/** An affix family: the item kinds it rolls on and its weight. */
interface AffixKind {
  family: AffixFamily;
  on: 'weapon' | 'defence' | 'any';
  weight: number;
}

const AFFIXES: readonly AffixKind[] = [
  { family: 'attr', on: 'any', weight: 60 },
  { family: 'dmg', on: 'weapon', weight: 80 },
  { family: 'res', on: 'defence', weight: 70 },
  { family: 'hp', on: 'defence', weight: 100 },
  { family: 'mana', on: 'any', weight: 100 },
];

/**
 * Affix tiers T0..T11 per family (area_levels_and_affix_tiers_plan.md §3): [min, max] in the
 * stat's units, resistances in whole percent. T5 is the old single range's top (50 HP, 60 mana,
 * 12 damage, 18 %, +5); T10 doubles it. T11 (masterwork) is never rolled by drops.
 */
export const AFFIX_TIERS: Readonly<Record<AffixFamily, readonly (readonly [number, number])[]>> = {
  hp: [[1, 5], [6, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 70], [71, 80], [81, 90], [91, 100], [101, 110]],
  mana: [[2, 6], [7, 12], [13, 24], [25, 36], [37, 48], [49, 60], [61, 72], [73, 84], [85, 96], [97, 108], [109, 120], [121, 132]],
  dmg: [[1, 1], [2, 2], [3, 4], [5, 6], [7, 9], [10, 12], [13, 15], [16, 18], [19, 21], [22, 24], [25, 27], [28, 30]],
  res: [[1, 2], [3, 4], [5, 7], [8, 10], [11, 14], [15, 18], [19, 22], [23, 26], [27, 30], [31, 34], [35, 38], [39, 42]],
  attr: [[1, 1], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10], [11, 12]],
};

/** Highest tier drops roll (T10); T11 is the masterwork overcap. */
export const MAX_ROLL_TIER = 10;
export const MAX_TIER = 11;
/** Tier an affix without one is shown against (the old single range's top). */
export const BASELINE_TIER = 5;
/** Item level of gear rolled with no level of its own. */
export const DEFAULT_ILVL = 50;

/** The tiers an item level rolls in: [max(0, top − 3), top], top = min(10, ⌊iLvl / 10⌋). */
export function tierWindow(ilvl: number): { min: number; max: number } {
  const max = Math.max(0, Math.min(MAX_ROLL_TIER, Math.floor(ilvl / 10)));
  return { min: Math.max(0, max - 3), max };
}

/** A family's [min, max] at a tier, in the stat's units (resistances as fractions); undefined for no such tier. */
export function tierRollRange(family: string, tier: number): { min: number; max: number } | undefined {
  const t = AFFIX_TIERS[family as AffixFamily]?.[tier];
  if (!t) return undefined;
  return family === 'res' ? { min: t[0] / 100, max: t[1] / 100 } : { min: t[0], max: t[1] };
}

/** The range an affix rolls in at its tier (no tier: the baseline T5), or undefined for an unknown id. */
export function affixRange(id: string, tier = BASELINE_TIER): { min: number; max: number } | undefined {
  return tierRollRange(id.split(':')[0]!, tier);
}

/**
 * Its rolled mods (rarity, item level and affixes) for a new item instance, or undefined
 * (Battle-worn). Each affix at most once (as in Path of Exile): a family's weight is shared among
 * its stats, and a stat rolled leaves the pool. Each affix rolls its tier uniformly in the item
 * level's window (tierWindow), then its value uniformly in that tier's range.
 */
export function rollMods(def: ItemDef, random: () => number, ilvl = DEFAULT_ILVL): ItemMods | undefined {
  if (!moddable(def)) return undefined;
  const rarity = rollRarity(random());
  if (rarity === 'worn') return undefined;
  const kind = def.type === 'weapon' ? 'weapon' : 'defence';
  const level = Math.max(1, Math.min(100, Math.round(ilvl)));
  const window = tierWindow(level);
  const pool = AFFIXES.filter((a) => a.on === 'any' || a.on === kind).flatMap((a) => {
    const ids = a.family === 'attr' ? ATTRS.map((x) => `attr:${x}`)
      : a.family === 'dmg' ? [`dmg:${weaponDamageType(def)}`]
      : a.family === 'res' ? ELEMENTS.map((x) => `res:${x}`)
      : [a.family];
    return ids.map((id) => ({ id, kind: a, weight: a.weight / ids.length }));
  });
  const affixes: ItemAffix[] = [];
  for (let i = 0; i < RARITY_INFO[rarity].affixes && pool.length; i++) {
    const total = pool.reduce((n, a) => n + a.weight, 0);
    let pick = random() * total;
    const at = Math.max(0, pool.findIndex((x) => (pick -= x.weight) < 0));
    const { id, kind: a } = pool.splice(at, 1)[0]!;
    const tier = window.min + Math.min(window.max - window.min, Math.floor(random() * (window.max - window.min + 1)));
    const [lo, hi] = AFFIX_TIERS[a.family][tier]!;
    const v = lo + Math.min(hi - lo, Math.floor(random() * (hi - lo + 1)));
    affixes.push({ id, value: a.family === 'res' ? v / 100 : v, tier });
  }
  return { rarity, ilvl: level, ...(affixes.length ? { affixes } : {}) };
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

/** The attribute an "attr:" affix raises (stored ids say "intelligence"; the stat is `intellect`). */
function attrKey(what: string): keyof Attributes {
  return what === 'intelligence' ? 'intellect' : (what as keyof Attributes);
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
    if (family === 'attr' && what) {
      const k = attrKey(what);
      attributes[k] = (attributes[k] ?? 0) + a.value;
    }
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

/**
 * A tooltip line per affix ("+3 Might", "+12 % Fire resistance", "+30 hit points"); with
 * `ranges`, each followed by its tier and that tier's range ("+45 hit points (T5: 41–50)").
 * An affix rolled before tiers shows the baseline T5 range without a tier, left out when the
 * value lies outside it.
 */
export function affixLines(mods: ItemMods | undefined, opts: { ranges?: boolean } = {}): string[] {
  return (mods?.affixes ?? []).map((a) => {
    const [family, what] = a.id.split(':') as [string, string | undefined];
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const r = opts.ranges ? affixRange(a.id, a.tier) : undefined;
    const pct = family === 'res';
    const span = r && (r.min === r.max ? `${pct ? Math.round(r.min * 100) : r.min}` : `${pct ? Math.round(r.min * 100) : r.min}–${pct ? Math.round(r.max * 100) : r.max}`);
    const range = !r ? ''
      : a.tier !== undefined ? ` (T${a.tier}: ${span})`
      : a.value >= r.min - 1e-9 && a.value <= r.max + 1e-9 ? ` (${span})` : '';
    if (family === 'attr') return `+${a.value} ${cap(what === 'intelligence' ? 'intellect' : what ?? '')}${range}`;
    if (family === 'dmg') return `+${a.value} ${cap(what ?? '')} damage${range}`;
    if (pct) return `+${Math.round(a.value * 100)} % ${cap(what ?? '')} resistance${range}`;
    if (family === 'hp') return `+${a.value} hit points${range}`;
    return `+${a.value} mana${range}`;
  });
}

/**
 * An item's own (implicit) numbers without what its affixes add: an inventory view carries them
 * summed (withMods), the tooltip shows the two apart. Damage and attributes subtract exactly; a
 * resistance divides back out unless the 75 % cap clipped it (then it stays as it is).
 */
export function withoutAffixes<T extends { damage?: number[]; protection?: number[]; attributes?: Partial<Attributes> }>(item: T, mods: ItemMods | undefined): T {
  if (!mods?.affixes?.length) return item;
  const out: T = { ...item };
  const damage = item.damage && [...item.damage];
  const protection = item.protection && [...item.protection];
  const attributes: Partial<Attributes> = { ...item.attributes };
  for (const a of mods.affixes) {
    const [family, what] = a.id.split(':') as [string, string | undefined];
    const t = what ? DAMAGE_TYPES.indexOf(what as never) : -1;
    if (family === 'dmg' && damage && t >= 0) damage[t] = Math.round(((damage[t] ?? 0) - a.value) * 100) / 100;
    else if (family === 'res' && protection && t >= 0 && (protection[t] ?? 1) > MIN_PROTECTION + 1e-9) protection[t] = Math.min(1, (protection[t] ?? 1) / (1 - a.value));
    else if (family === 'attr' && what) {
      const k = attrKey(what);
      attributes[k] = (attributes[k] ?? 0) - a.value;
    }
  }
  if (damage) out.damage = damage;
  if (protection) out.protection = protection.map((v) => Math.round(v * 1000) / 1000);
  if (item.attributes || Object.keys(attributes).length) out.attributes = attributes;
  return out;
}

export const MATERIAL_DROPS: readonly { itemId: string; chance: number }[] = [
  { itemId: 'iron_scrap', chance: 0.2 },
  { itemId: 'polishing_stone', chance: 0.08 },
  { itemId: 'mithril_crystal', chance: 0.04 },
  { itemId: 'enchanted_dust', chance: 0.02 },
  { itemId: 'celestial_gem', chance: 0.005 },
  { itemId: 'divine_catalyst', chance: 0.002 },
];

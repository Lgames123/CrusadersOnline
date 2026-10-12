import { TICK_RATE } from '../constants.ts';

/**
 * Drake's spells, indexed like `script/default.ctx`'s `S0`-`S10` rows (executable-analysis
 * §14.1b / §8): the server reads their per-level values from the converted rules
 * (rules/default.json, `drake.spells`) and falls back to the slice values below.
 */
export const SPELLS = [
  'torch_light',
  'fireball',
  'slow',
  'freeze',
  'stoneskin',
  'lightning',
  'heroism',
  'spectral_ally',
  'revelation',
  'holy_wrath',
  'soul_drinker',
] as const;
export type SpellId = (typeof SPELLS)[number];

export const SPELL_NAMES: Readonly<Record<SpellId, string>> = {
  torch_light: 'Torch Light',
  fireball: 'Fire Ball',
  slow: 'Slow',
  freeze: 'Fantastic Freeze',
  stoneskin: 'Stone Skin',
  lightning: 'Lightning',
  heroism: 'Heroism',
  spectral_ally: 'Spectral Ally',
  revelation: 'Revelation',
  holy_wrath: 'Holy Wrath',
  soul_drinker: 'Soul Drinker',
};

/** items.ctx spell books: `UseParameters(<name>)` of a `GRANT_SPELL` book -> spell. */
export const SPELL_BOOK_PARAMS: Readonly<Record<string, SpellId>> = {
  TORCH_LIGHT: 'torch_light',
  FIREBALL: 'fireball',
  SLOW: 'slow',
  FREEZE: 'freeze',
  STONESKIN: 'stoneskin',
  LIGHTNING: 'lightning',
  HEROISM: 'heroism',
  SPECTRAL_ALLY: 'spectral_ally',
  SOLIDIFY: 'revelation',
  HOLY_WRATH: 'holy_wrath',
  SOULDRINKER: 'soul_drinker',
};

/** One level of a spell (default.ctx: mana cost, duration in seconds, value1, value2). */
export interface SpellLevel {
  mana: number;
  duration: number;
  value1: number;
  value2: number;
}
export type SpellTable = Readonly<Partial<Record<SpellId, readonly SpellLevel[]>>>;

/** Slice values used without converted rules (torch light: radius in feet). */
export const BUILTIN_SPELLS: SpellTable = {
  torch_light: [
    { mana: 1, duration: 80, value1: 15, value2: 0 },
    { mana: 2, duration: 120, value1: 30, value2: 0 },
    { mana: 3, duration: 180, value1: 50, value2: 0 },
  ],
};

/** Builds the table from rules/default.json's `drake.spells` ({ index: [[level, mana, duration, v1, v2], ...] }). */
export function spellTableFromRules(spells: Readonly<Record<string, readonly (readonly number[])[]>>): SpellTable {
  const out: Partial<Record<SpellId, SpellLevel[]>> = { ...BUILTIN_SPELLS } as Partial<Record<SpellId, SpellLevel[]>>;
  for (const [index, rows] of Object.entries(spells)) {
    const id = SPELLS[Number(index)];
    if (!id || !rows.length) continue;
    out[id] = [...rows]
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
      .map((r) => ({ mana: r[1] ?? 0, duration: r[2] ?? 0, value1: r[3] ?? 0, value2: r[4] ?? 0 }));
  }
  return out;
}

/** Spells whose effect is implemented (others can be learned but not cast yet). */
export const CASTABLE_SPELLS: ReadonlySet<SpellId> = new Set<SpellId>(['torch_light']);

/** Highest spell level. */
export const MAX_SPELL_LEVEL = 3;

/** ASM_SPELL_CONJURE before the spell's own state: 1.54 s (logged live). */
export const SPELL_CONJURE_TICKS = Math.round(1.54 * TICK_RATE);

/**
 * Mana regeneration: one point every ~3.9 s (a single live sample, 29 -> 30 after a cast;
 * provisional until measured over a longer span).
 */
export const MANA_REGEN_TICKS = Math.round(3.9 * TICK_RATE);

/** A known spell and its level. */
export interface KnownSpell {
  spell: SpellId;
  level: number;
}

/** Serialises known spells for storage ("torch_light:1,fireball:2"). */
export function encodeSpells(spells: readonly KnownSpell[]): string {
  return spells.map((s) => `${s.spell}:${s.level}`).join(',');
}

/** Parses stored spells, dropping unknown names and clamping levels. */
export function decodeSpells(text: string | null | undefined): KnownSpell[] {
  const out: KnownSpell[] = [];
  for (const part of (text ?? '').split(',')) {
    const [name, lvl] = part.split(':');
    if (!name || !(SPELLS as readonly string[]).includes(name)) continue;
    const level = Math.min(MAX_SPELL_LEVEL, Math.max(1, Math.trunc(Number(lvl) || 1)));
    if (!out.some((s) => s.spell === name)) out.push({ spell: name as SpellId, level });
  }
  return out;
}

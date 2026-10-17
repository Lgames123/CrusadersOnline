import { TICK_RATE } from '../constants.ts';

/**
 * Drake's spells, indexed like `script/default.ctx`'s `S0`-`S10` rows and the spell book's
 * eleven spell objects (0x004BC720, slots by 0x004BD270; executable-analysis §20). The server
 * reads their per-level values from the converted rules (rules/default.json, `drake.spells`)
 * and falls back to BUILTIN_SPELLS (the same rows).
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

/** items.ctx spell books: `UseParameters(<name>)` of a `GRANT_SPELL` book -> spell (0x004BDEB0's names). */
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

const lv = (mana: number, duration: number, value1: number, value2: number): SpellLevel => ({ mana, duration, value1, value2 });

/** default.ctx S0-S10 (also used without converted rules). */
export const BUILTIN_SPELLS: SpellTable = {
  torch_light: [lv(1, 80, 15, 0), lv(2, 120, 30, 0), lv(3, 180, 50, 0)],
  fireball: [lv(5, 10, 10, 0), lv(10, 20, 12, 0), lv(15, 25, 12, 0)],
  slow: [lv(10, 30, 0.3, 0), lv(20, 30, 0.3, 0), lv(40, 5, 0.3, 0)],
  freeze: [lv(10, 10, 0, 0), lv(20, 20, 0, 0), lv(30, 30, 0, 0)],
  stoneskin: [lv(10, 20, 0.5, 0), lv(25, 30, 0.25, 0), lv(40, 40, 0, 0)],
  lightning: [lv(10, 10, 25, 0), lv(30, 30, 50, 0), lv(45, 50, 75, 0)],
  heroism: [lv(10, 25, 1.5, 1.1), lv(15, 35, 2, 1.2), lv(30, 45, 3, 1.5)],
  spectral_ally: [lv(10, 20, 0, 0), lv(20, 30, 0, 0), lv(40, 40, 0, 0)],
  revelation: [lv(1, 10, 0, 50), lv(1, 10, 0, 50), lv(1, 10, 0, 50)],
  holy_wrath: [lv(10, 10, 40, 20), lv(20, 20, 60, 30), lv(30, 30, 100, 40)],
  soul_drinker: [lv(15, 10, 15, 10), lv(35, 20, 25, 30), lv(50, 30, 45, 60)],
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

/** Every spell is castable (all eleven are implemented). */
export const CASTABLE_SPELLS: ReadonlySet<SpellId> = new Set<SpellId>(SPELLS);

/** Highest spell level (0x004BCD10 caps the level index at 2). */
export const MAX_SPELL_LEVEL = 3;

/** ASM_SPELL_CONJURE before the spell's own state: 1.54 s (logged live). */
export const SPELL_CONJURE_TICKS = Math.round(1.54 * TICK_RATE);

/**
 * Mana regeneration: one point every 5 s (0x004BCFC0: the spell book's frame-time accumulator,
 * +0x10, gives a point and drops 5000 ms each time it reaches 5000).
 */
export const MANA_REGEN_TICKS = 5 * TICK_RATE;

/**
 * How each spell is cast and shown. Self spells (torch, freeze, stone skin, heroism, ally,
 * revelation, holy wrath) conjure first (state 0x39, ASM_SPELL_CONJURE, then the spell's state
 * kept in +0xAC); fire ball, slow, lightning and soul drinker go straight to their state, on the
 * upper body while moving (input routines 0x0042B7A0 / 0x0042AFC0). The spell takes effect on
 * the clip's SPELL event (0x00457D20 -> 0x004BCF70). Clips: models.ctx B lines (Drake),
 * frames at 30 fps. Sounds: Sound.ctx ids by level (0x004F654C), played as the cast begins
 * (vtable +0x24) except fire ball and lightning (on release). Effects: effects.stg MULTI
 * names (0x004F35F8), variant = level - 1.
 */
export interface SpellInfo {
  /** The spell's ASM state (Drake's clip binding). */
  asm: string;
  conjure: boolean;
  /** SPELL event frame and clip length (30 fps frames). */
  eventFrame: number;
  clipFrames: number;
  sounds: readonly [number, number, number];
  /** Played with the cast sound at the hand (+0x24). */
  windup: string;
  /** At the hand / caster as it takes effect. */
  cast?: string;
}

export const SPELL_INFO: Readonly<Record<SpellId, SpellInfo>> = {
  torch_light: { asm: 'ASM_SPELL_TORCH_LIGHT', conjure: true, eventFrame: 9, clipFrames: 28, sounds: [313, 314, 315], windup: 'LIGHT_WINDUP', cast: 'LIGHT_CAST' },
  fireball: { asm: 'ASM_SPELL_FIRE_BALL', conjure: false, eventFrame: 12, clipFrames: 29, sounds: [316, 317, 318], windup: 'FIREBALL_WINDUP', cast: 'FIREBALL_CAST' },
  slow: { asm: 'ASM_SPELL_SLOW', conjure: false, eventFrame: 12, clipFrames: 29, sounds: [322, 322, 322], windup: 'SLOW_WINDUP', cast: 'SLOW_CAST' },
  freeze: { asm: 'ASM_SPELL_FANTASTIC_FREEZE', conjure: true, eventFrame: 9, clipFrames: 28, sounds: [325, 325, 325], windup: 'SNAPFREEZE_WINDUP', cast: 'SNAPFREEZE_CAST' },
  stoneskin: { asm: 'ASM_SPELL_STONE_SKIN', conjure: true, eventFrame: 12, clipFrames: 29, sounds: [324, 324, 324], windup: 'STONESKIN_WINDUP', cast: 'STONESKIN_CAST' },
  lightning: { asm: 'ASM_SPELL_LIGHTNING', conjure: false, eventFrame: 19, clipFrames: 33, sounds: [335, 522, 522], windup: 'LIGHTNING_WINDUP' },
  heroism: { asm: 'ASM_SPELL_HEROISM', conjure: true, eventFrame: 27, clipFrames: 48, sounds: [319, 319, 351], windup: 'HEROISM_WINDUP', cast: 'HEROISM_CAST' },
  spectral_ally: { asm: 'ASM_SPELL_SPECTRAL_ALLY', conjure: true, eventFrame: 27, clipFrames: 48, sounds: [323, 323, 323], windup: 'ALLY_WINDUP' },
  // Revelation plays the ally's state (0x36 for slots 7 and 8).
  revelation: { asm: 'ASM_SPELL_SPECTRAL_ALLY', conjure: true, eventFrame: 27, clipFrames: 48, sounds: [327, 327, 327], windup: 'SOLIDIFY_WINDUP' },
  holy_wrath: { asm: 'ASM_SPELL_HOLY_WRATH', conjure: true, eventFrame: 27, clipFrames: 48, sounds: [326, 326, 326], windup: 'HOLY_WRATH_WINDUP', cast: 'HOLY_WRATH_CAST' },
  soul_drinker: { asm: 'ASM_SPELL_SOUL_DRINKER', conjure: false, eventFrame: 27, clipFrames: 48, sounds: [321, 321, 321], windup: 'SOULDRINKER_WINDUP', cast: 'SOULDRINKER_CAST' },
};

/** One foot, metres (the engine's unit). */
const FT = 0.3048;

/**
 * Behaviour constants of the spell objects (object classes 0x0043D5E0-0x00440E70, components
 * 0x004BDFA0-0x004C1FF0). Distances in metres, times in seconds.
 */
export const SPELL_RULES = {
  /** Fire ball (0x004BAF80 / 0x004BB130): 100 ft/s; level 3 throws three at 0.6 x speed, ±0.2 sideways. */
  fireballSpeed: 100 * FT,
  fireballTripleSpeed: 60 * FT,
  fireballSpread: 0.2,
  /** Lifetime 50 s (+0x64 50000 ms). */
  projectileLife: 50,
  /** Levels 2-3 home (0x004BE010 / 0x004BE220): a target within cos 80° of the flight, turning 180°/s, lost past 80°. */
  homingCone: (80 * Math.PI) / 180,
  homingTurn: Math.PI,
  /** Explosion (0x004BE900 / 0x004BEA70): the radius grows 30 / 50 / 80 ft/s for 0.25 s; knock-back 15. */
  explosionLife: 0.25,
  explosionRate: [30 * FT, 50 * FT, 80 * FT] as readonly number[],
  explosionKnock: 15 * FT,
  /** Slow (0x004BDD60, 0x004C1570): its projectile flies as the fire ball; level 2 bursts (Slow Explosion). */
  slowSpeed: 100 * FT,
  /** Level 3: the world slows round the caster (SLTI, kind 8: x 4 for the caster, 0x0044C3F0). */
  slowTimeRate: 0.25,
  /** Freeze (0x0043EEC0, 0x004C1070): aimed at a creature within a 20° cone and 300 ft. */
  freezeCone: (20 * Math.PI) / 180,
  freezeRange: 300 * FT,
  /** The ice storm at the target (0x004C11C0): 5 ft radius for 5 s; each creature in it once. */
  iceStormRadius: 5 * FT,
  iceStormLife: 5,
  /** Frozen for duration x WATER resist; immune at a resist of 0.25 or less (0x004C1490 / 0x004C1FF0). */
  freezeImmuneResist: 0.25,
  /** Thaw (0x0047E9B0): a 0.8 s stun, glass sound 523, ice shards. */
  thawStun: 0.8,
  thawSound: 523,
  /** A snap freeze with no target flies 2 s and fizzles (0x004C1070 / 0x004C10D0). */
  freezeBoltLife: 2,
  /** Lightning (0x004BB910, 0x004BD320): the nearest creature within cos 0.8 of the aim and 64 ft; else 50 ft ahead. */
  lightningCos: 0.8,
  lightningRange: 64 * FT,
  lightningMiss: 50 * FT,
  /** Further strikes (0x004BB9F0 / 0x004BD470): 250 ms apart, the next creature within 64 ft of the last. */
  lightningChainDelay: 0.25,
  /** Strikes by level: one, two, four. */
  lightningStrikes: [1, 2, 4] as readonly number[],
  /** A bolt's own sound (0x004BF480: 0x20A) and light. */
  lightningSound: 522,
  /** Holy wrath (0x0043FD30): a ring growing for 0.5 s to value2 ft; LIGHT damage value1, knock-back 10 ft. */
  holyWrathLife: 0.5,
  holyWrathKnock: 10 * FT,
  /** Soul drinker (0x0043F950 / 0x004C17D0): a creature within a 12° cone and 100 ft; value1 HP over 5 s. */
  soulCone: (12 * Math.PI) / 180,
  soulRange: 100 * FT,
  soulDrainTime: 5,
  /** Spectral ally (0x00440230): 10 ft ahead, 3 ft up, needs 6 ft clear; type 155 (Long Sword, Wooden Shield). */
  allyAhead: 10 * FT,
  allyClear: 6 * FT,
  allyHp: [80, 100, 120] as readonly number[],
  /** Its weapon: SLASH / BASH (+ LIGHT at level 3), and its resist on every type. */
  allyDamage: [[15, 15, 0], [20, 20, 0], [20, 20, 50]] as readonly (readonly [number, number, number])[],
  allyResist: [1, 0.8, 0.6] as readonly number[],
  /** Revelation (0x00440D70): a pulse to value2 ft over 0.1 s. */
  revelationLife: 0.1,
  /** Explosion sound (0x004BE980: 0x210, random pitch). */
  explosionSound: 528,
} as const;

/**
 * Creatures holy wrath strikes and soul drinker turns against its caster (0x004586D0): Deceiver,
 * Greater Black Knight, Lich Arch Mage, Dark Mage / Master, the skeletons, Shadow, Necros (0x96)
 * and the spectral ally. Drake (the player) is type 142, not one of them.
 */
export const UNHOLY_TYPES: ReadonlySet<number> = new Set([0x74, 0x86, 0x8d, 0x8f, 0x90, 0x91, 0x92, 0x93, 0x96, 0x9b]);

/** Drake's creature type (the player's stats +0x34; Frida, 2026-10-17-drake-block-sounds). */
export const PLAYER_CREATURE_TYPE = 142;

/**
 * A creature's spell: one bit of its template's spell mask (creature template table, §9.1) and
 * what the creatures' own spell instances (0x630A50, 0x004BD760) cast for it: 0x004BD7C0 sets
 * the level and values before every cast (no mana). Durations in seconds; `cooldown` is the
 * wait before the next cast of any spell (brain +0xE0, 0x0040EBE0), from the start of this one.
 */
export interface CreatureSpell {
  spell: SpellId;
  level: number;
  values: SpellLevel;
  cooldown: number;
}

/**
 * By mask bit (0x004BD7C0, creatures other than Necros). Bit 0 (stone skin 0.75 for 2 s) is only
 * chosen by a brain branch nothing enters (0x0040AE40); bit 4 has no spell; bit 8 is Necros's
 * Force Globe (class 15, 0x00441110) and bit 9 his triple fire ball; bit 10 revelation is in no
 * creature's mask. Only these are cast here.
 */
export const CREATURE_SPELLS: Readonly<Partial<Record<number, CreatureSpell>>> = {
  1: { spell: 'lightning', level: 1, values: lv(0, 1, 3, 1), cooldown: 6 },
  2: { spell: 'soul_drinker', level: 1, values: lv(0, 1, 3, 100), cooldown: 6 },
  // Unholy wrath (the instance's +0x50 = 1, 0x004BDE80): DARK value1, on everyone but the unholy.
  3: { spell: 'holy_wrath', level: 1, values: lv(0, 0.02, 30, 20), cooldown: 6 },
  5: { spell: 'fireball', level: 1, values: lv(0, 1, 3, 0), cooldown: 3 },
  6: { spell: 'fireball', level: 2, values: lv(0, 2, 3, 0), cooldown: 3 },
  7: { spell: 'fireball', level: 3, values: lv(0, 2, 2, 0), cooldown: 3 },
};

/** Spell masks of the creature template table (the fourth dword of each 0x30-byte record). */
export const CREATURE_SPELL_MASKS: Readonly<Record<number, number>> = {
  134: 0x40, // Deceiver
  136: 0x20, // Ice Elemental
  137: 0x20, // Rock Elemental
  138: 0x80, // Lava Elemental
  139: 0x34c, // Necros Before
  143: 0x25, // Dark Mage
  144: 0x38, // Dark Master
  146: 0x02, // Skeleton Ghost
  150: 0x34c, // Necros
};

/**
 * The brain's spell choices (0x004096A0, before the melee ones; executable-analysis §20.1):
 * `close` spells (soul drinker, unholy wrath) at 8-20 ft when floor(rand x 1000) > 700;
 * `ranged` ones (lightning, fire balls) beyond 8 ft with a clear line. The cast (0x0040AA20)
 * waits for the cooldown and for the target within 45° of the heading, is dropped within 8 ft,
 * then the creature stands 2 s (Necros 0.2 s, 0x0040EC70).
 */
export const CREATURE_CAST = {
  closeMask: 0x0c,
  rangedMask: 0x2e2,
  closeRoll: 700,
  facing: (45 * Math.PI) / 180,
  pause: 2,
} as const;

/**
 * Creatures with no clip for the spell state play another of its group (0x00428220): fire ball
 * -> ASM_THROW_ITEM. The Deceiver's (M37P02_thw_at) and the elementals' (icewalk) have no SPELL
 * event, so their cast never takes effect. Clip length in 30 fps frames.
 */
const THROW_FALLBACK: Readonly<Record<number, number>> = { 134: 29, 136: 33, 137: 33, 138: 33 };

/** Seconds of a creature's cast clip: to its SPELL event (null = it has none) and to its end. */
export function creatureSpellClipSeconds(type: number, spell: SpellId): { release: number | null; end: number } {
  const frames = spell === 'fireball' ? THROW_FALLBACK[type] : undefined;
  if (frames !== undefined) return { release: null, end: frames / 30 };
  return spellClipSeconds(spell);
}

/** The mask bits of `type` in `group` that have a creature spell. */
export function creatureSpellBits(type: number, group: number): number[] {
  const mask = (CREATURE_SPELL_MASKS[type] ?? 0) & group;
  const out: number[] = [];
  for (let b = 0; b < 12; b++) if (mask & (1 << b) && CREATURE_SPELLS[b]) out.push(b);
  return out;
}

/**
 * Timed effects on a character (the status objects, pool 0x0058DB08; kinds by 0x004F326C):
 * a tag (one of each per character: a recast replaces it), a kind and a value.
 * kind 0 speed x value (SPED, heroism); 1 rate x value (SLOW, and the thaw stun at 0);
 * 2 frozen (FRZE); 4 outgoing damage x per type (HERO); 6 incoming damage x per type (STON);
 * 8 the world slowed round its owner (SLTI).
 */
export type StatusTag = 'SPED' | 'SLOW' | 'FRZE' | 'HERO' | 'STON' | 'SLTI' | 'THAW';

/** Status tags shown on a character (SC.SPELL_EVENT `status`): its look and the HUD. */
export const STATUS_NAMES: Readonly<Record<StatusTag, string>> = {
  SPED: 'Haste',
  SLOW: 'Slowed',
  FRZE: 'Frozen',
  HERO: 'Heroism',
  STON: 'Stone Skin',
  SLTI: 'Slow Time',
  THAW: 'Stunned',
};

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

/** Seconds of a spell's clip at a clip rate: to its SPELL event and to its end. */
export function spellClipSeconds(spell: SpellId, clipRate = 1): { release: number; end: number } {
  const i = SPELL_INFO[spell];
  return { release: i.eventFrame / 30 / clipRate, end: i.clipFrames / 30 / clipRate };
}

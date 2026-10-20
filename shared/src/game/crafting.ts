/**
 * Soft skills (MMO Stage 6, not original; docs/game-design/mmo/07), behind the server feature
 * `mmoCrafting`: Mining (ore veins in the caves and mines, shared charges), Smithing (recipes at
 * a merchant: gear and the finer refinement materials), Salvaging (gear broken down into
 * materials at a merchant). Levels 1–100 per character on 07 §3's curve.
 */
import type { ArenaDef } from '../arena/types.ts';
import { floorAt } from '../arena/level.ts';
import type { ItemMods, Rarity } from './items.ts';

export const SKILLS = ['mining', 'smithing', 'salvaging'] as const;
export type Skill = (typeof SKILLS)[number];
export type SkillXp = Partial<Record<Skill, number>>;
export const MAX_SKILL_LEVEL = 100;

/** XP for a skill level (07 §3): floor(1/4 × Σ_{n<L} (n + 300 × 2^(n/7))). Level 1 = 0. */
const SKILL_XP: number[] = (() => {
  const out = [0, 0];
  let sum = 0;
  for (let n = 1; n < MAX_SKILL_LEVEL; n++) {
    sum += n + 300 * 2 ** (n / 7);
    out.push(Math.floor(sum / 4));
  }
  return out;
})();

export function skillXpFor(level: number): number {
  return SKILL_XP[Math.max(1, Math.min(MAX_SKILL_LEVEL, level))]!;
}

export function skillLevel(xp: number): number {
  let l = 1;
  while (l < MAX_SKILL_LEVEL && xp >= SKILL_XP[l + 1]!) l++;
  return l;
}

/** Skills from untrusted storage. */
export function sanitizeSkills(raw: unknown): SkillXp {
  const out: SkillXp = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const s of SKILLS) {
    const v = (raw as Record<string, unknown>)[s];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[s] = Math.min(SKILL_XP[MAX_SKILL_LEVEL]! * 2, Math.floor(v));
  }
  return out;
}

// --- Mining ---------------------------------------------------------------------------------

export type OreKind = 'iron' | 'stone' | 'mithril';

export const ORES: Readonly<Record<OreKind, { name: string; level: number; item: string; min: number; max: number; xp: number; color: number }>> = {
  iron: { name: 'Iron Vein', level: 1, item: 'iron_scrap', min: 1, max: 2, xp: 25, color: 0xb87333 },
  stone: { name: 'Whetstone Seam', level: 15, item: 'polishing_stone', min: 1, max: 2, xp: 45, color: 0xd8d8c8 },
  mithril: { name: 'Mithril Vein', level: 35, item: 'mithril_crystal', min: 1, max: 1, xp: 80, color: 0x7fd8ff },
};

/** Which ores an act's caves hold, by its place (the catacombs, the mines, the glaciers...). */
const ACT_ORES: Readonly<Record<string, OreKind[]>> = {
  ca: ['iron', 'stone'],
  cm: ['iron', 'stone', 'mithril'],
  gl: ['stone', 'mithril'],
  co: ['iron'],
  du: ['iron'],
};

export const NODE_CHARGES: readonly [number, number] = [3, 5];
export const NODE_RESPAWN_SECONDS: readonly [number, number] = [120, 300];
export const NODE_REACH = 2.5;
/** Seconds one harvest takes (the next one waits). */
export const HARVEST_SECONDS = 2.5;
/** Ore veins in one act at most. */
const MAX_NODES = 5;

export interface OreNodeSpot {
  id: number;
  kind: OreKind;
  x: number;
  y: number;
  z: number;
}

/**
 * An act's ore veins: beside some of its hostile placements (spread through the act), on their
 * floor, the kinds its place holds in turn. Deterministic: every zone of the act agrees.
 */
export function oreNodes(act: string, arena: ArenaDef): OreNodeSpot[] {
  const kinds = ACT_ORES[act.slice(0, 2)];
  if (!kinds) return [];
  const hostile = arena.mobSpawns.filter((m) => (m.disposition ?? 3) >= 3);
  if (!hostile.length) return [];
  const step = Math.max(1, Math.floor(hostile.length / MAX_NODES));
  const out: OreNodeSpot[] = [];
  for (let i = 0; i < hostile.length && out.length < MAX_NODES; i += step) {
    const m = hostile[i]!;
    // A step to the side of where the creature stands, on the floor.
    for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]] as const) {
      const y = floorAt(arena, m.x + dx, m.z + dz, m.y, 2);
      if (y === null) continue;
      out.push({ id: out.length + 1, kind: kinds[out.length % kinds.length]!, x: m.x + dx, y, z: m.z + dz });
      break;
    }
  }
  return out;
}

// --- Smithing -------------------------------------------------------------------------------

export interface Recipe {
  id: string;
  name: string;
  level: number;
  inputs: { itemId: string; count: number }[];
  gold: number;
  output: { itemId: string; count: number };
  xp: number;
}

export const RECIPES: readonly Recipe[] = [
  { id: 'polish', name: 'Polishing Stone', level: 1, inputs: [{ itemId: 'iron_scrap', count: 4 }], gold: 10, output: { itemId: 'polishing_stone', count: 1 }, xp: 30 },
  { id: 'long_sword', name: 'Long Sword', level: 5, inputs: [{ itemId: 'iron_scrap', count: 6 }], gold: 40, output: { itemId: 'long_sword', count: 1 }, xp: 60 },
  { id: 'metal_shield', name: 'Metal Shield', level: 12, inputs: [{ itemId: 'iron_scrap', count: 8 }, { itemId: 'polishing_stone', count: 2 }], gold: 80, output: { itemId: 'metal_shield', count: 1 }, xp: 110 },
  { id: 'broad_sword', name: 'Broad Sword', level: 20, inputs: [{ itemId: 'iron_scrap', count: 10 }, { itemId: 'polishing_stone', count: 3 }], gold: 150, output: { itemId: 'broad_sword', count: 1 }, xp: 180 },
  { id: 'banded_armor', name: 'Banded Armor', level: 28, inputs: [{ itemId: 'iron_scrap', count: 16 }, { itemId: 'polishing_stone', count: 6 }], gold: 300, output: { itemId: 'banded_armor', count: 1 }, xp: 300 },
  { id: 'dust', name: 'Enchanted Dust', level: 30, inputs: [{ itemId: 'polishing_stone', count: 3 }, { itemId: 'mithril_crystal', count: 2 }], gold: 120, output: { itemId: 'enchanted_dust', count: 1 }, xp: 220 },
  { id: 'war_hammer', name: 'War Hammer', level: 40, inputs: [{ itemId: 'iron_scrap', count: 14 }, { itemId: 'mithril_crystal', count: 4 }], gold: 500, output: { itemId: 'war_hammer', count: 1 }, xp: 450 },
  { id: 'gem', name: 'Celestial Gem', level: 60, inputs: [{ itemId: 'enchanted_dust', count: 10 }, { itemId: 'mithril_crystal', count: 6 }], gold: 2000, output: { itemId: 'celestial_gem', count: 1 }, xp: 1500 },
  { id: 'catalyst', name: 'Divine Catalyst', level: 80, inputs: [{ itemId: 'celestial_gem', count: 2 }, { itemId: 'enchanted_dust', count: 12 }], gold: 6000, output: { itemId: 'divine_catalyst', count: 1 }, xp: 4000 },
];

/** A smith's gear rolls its rarity with this bonus to the roll (higher levels make finer pieces). */
export function smithRarityBonus(level: number): number {
  return Math.min(0.25, level / 400);
}

// --- Salvaging ------------------------------------------------------------------------------

/** What a piece of gear breaks into (07 §6, in this game's materials), by its rarity. */
export const SALVAGE: Readonly<Record<Rarity, { item: string; min: number; max: number; xp: number }>> = {
  worn: { item: 'iron_scrap', min: 2, max: 4, xp: 15 },
  mundane: { item: 'enchanted_dust', min: 1, max: 3, xp: 40 },
  tempered: { item: 'celestial_gem', min: 1, max: 1, xp: 120 },
  legendary: { item: 'divine_catalyst', min: 1, max: 1, xp: 400 },
};

export function salvageYield(mods: ItemMods | undefined, u: number): { itemId: string; count: number; xp: number } {
  const s = SALVAGE[mods?.rarity ?? 'worn'];
  return { itemId: s.item, count: s.min + Math.floor(u * (s.max - s.min + 1)), xp: s.xp };
}

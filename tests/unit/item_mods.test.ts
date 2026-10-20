import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { AFFIX_TIERS, BUILTIN_ITEMS, DAMAGE_TYPES, REFINE_LEVELS, affixLines, affixRange, sanitizeMods, tierRollRange, tierWindow, createSyntheticArena, equipmentOf, initPhysics, refineOnce, rollMods, rollRarity, withMods, withoutAffixes, type InventoryEntry, type Rapier } from '@crusaders/shared';

const sword = BUILTIN_ITEMS.get('long_sword')!;
const SLASH = DAMAGE_TYPES.indexOf('SLASH');

/** A small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('rarity, affixes, refinement (MMO Stage 3)', () => {
  it('cumulative thresholds and the drop distribution', () => {
    expect([0, 0.0009, 0.001, 0.049, 0.05, 0.299, 0.3, 0.99].map(rollRarity)).toEqual(['legendary', 'legendary', 'tempered', 'tempered', 'mundane', 'mundane', 'worn', 'worn']);
    const r = rng(1);
    const n = 100_000;
    const tally: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const x = rollRarity(r());
      tally[x] = (tally[x] ?? 0) + 1;
    }
    // A rolled item's affixes match its tier.
    // Each affix at most once, even when the generator keeps picking the same spot.
    const same = rollMods(sword, () => 0.02)!.affixes!;
    expect(same.length).toBe(4);
    expect(new Set(same.map((a) => a.id)).size).toBe(4);
    expect(Math.abs(tally['worn']! / n - 0.7)).toBeLessThan(0.01);
    expect(Math.abs(tally['mundane']! / n - 0.25)).toBeLessThan(0.01);
    expect(Math.abs(tally['tempered']! / n - 0.049)).toBeLessThan(0.004);
  });

  it("rolls every affix inside its tier's range, once, and shows tier and range", () => {
    const r = rng(3);
    for (let i = 0; i < 2000; i++) {
      const mods = rollMods(sword, r);
      const affixes = mods?.affixes ?? [];
      if (mods) expect(mods.ilvl).toBe(50);
      expect(new Set(affixes.map((a) => a.id)).size).toBe(affixes.length);
      for (const a of affixes) {
        // iLvl 50 (the default): T2..T5.
        expect(a.tier).toBeGreaterThanOrEqual(2);
        expect(a.tier).toBeLessThanOrEqual(5);
        const range = affixRange(a.id, a.tier)!;
        expect(a.value).toBeGreaterThanOrEqual(range.min - 1e-9);
        expect(a.value).toBeLessThanOrEqual(range.max + 1e-9);
      }
    }
    expect(affixLines({ affixes: [{ id: 'hp', value: 45, tier: 5 }, { id: 'res:FIRE', value: 0.12, tier: 4 }, { id: 'attr:intelligence', value: 2, tier: 2 }] }, { ranges: true }))
      .toEqual(['+45 hit points (T5: 41–50)', '+12 % Fire resistance (T4: 11–14)', '+2 Intellect (T2: 2)']);
    // An affix from before tiers shows the baseline T5 range when it lies in it, else none.
    expect(affixLines({ affixes: [{ id: 'dmg:BASH', value: 11 }] }, { ranges: true })).toEqual(['+11 Bash damage (10–12)']);
    expect(affixLines({ affixes: [{ id: 'dmg:BASH', value: 20 }] }, { ranges: true })).toEqual(['+20 Bash damage']);
  });

  it('has 12 tiers per family, T5 the old top and T10 double it', () => {
    for (const tiers of Object.values(AFFIX_TIERS)) {
      expect(tiers.length).toBe(12);
      tiers.forEach(([lo, hi], t) => {
        expect(lo).toBeLessThanOrEqual(hi);
        if (t > 0) expect(lo).toBeGreaterThanOrEqual(tiers[t - 1]![0]);
      });
    }
    expect(tierRollRange('hp', 5)).toEqual({ min: 41, max: 50 });
    expect(tierRollRange('hp', 10)).toEqual({ min: 91, max: 100 });
    expect(tierRollRange('mana', 10)!.max).toBe(120);
    expect(tierRollRange('dmg', 5)!.max).toBe(12);
    expect(tierRollRange('res', 5)!.max).toBeCloseTo(0.18);
    expect(tierRollRange('attr', 10)).toEqual({ min: 10, max: 10 });
    expect(tierRollRange('hp', 12)).toBeUndefined();
  });

  it("rolls tiers in the item level's sliding window", () => {
    expect([0, 9, 10, 39, 40, 50, 59, 89, 90, 99, 100].map((l) => tierWindow(l))).toEqual([
      { min: 0, max: 0 }, { min: 0, max: 0 }, { min: 0, max: 1 }, { min: 0, max: 3 }, { min: 1, max: 4 }, { min: 2, max: 5 },
      { min: 2, max: 5 }, { min: 5, max: 8 }, { min: 6, max: 9 }, { min: 6, max: 9 }, { min: 7, max: 10 },
    ]);
    const r = rng(7);
    const seen = new Set<number>();
    let hpMax = 0;
    for (let i = 0; i < 5000; i++) {
      const mods = rollMods(BUILTIN_ITEMS.get('scale_armor')!, r, 100);
      for (const a of mods?.affixes ?? []) {
        seen.add(a.tier!);
        if (a.id === 'hp') hpMax = Math.max(hpMax, a.value);
        expect(a.value).toBeGreaterThanOrEqual(affixRange(a.id, a.tier)!.min - 1e-9);
      }
    }
    // iLvl 100: every tier from T7 to T10 and nothing else; HP up to 100.
    expect([...seen].sort((a, b) => a - b)).toEqual([7, 8, 9, 10]);
    expect(hpMax).toBe(100);
    // iLvl 50 (Necros's drops): HP at most 50.
    let necros = 0;
    for (let i = 0; i < 5000; i++) for (const a of rollMods(BUILTIN_ITEMS.get('scale_armor')!, r, 50)?.affixes ?? []) if (a.id === 'hp') necros = Math.max(necros, a.value);
    expect(necros).toBe(50);
  });

  it('keeps item level and tiers through storage', () => {
    const mods = { rarity: 'tempered' as const, ilvl: 63, affixes: [{ id: 'hp', value: 55, tier: 6 }, { id: 'mana', value: 30 }] };
    expect(sanitizeMods(mods)).toEqual(mods);
    expect(sanitizeMods({ ilvl: 400, affixes: [{ id: 'hp', value: 5, tier: 99 }] })).toEqual({ ilvl: 100, affixes: [{ id: 'hp', value: 5 }] });
    const tiered = { rarity: 'mundane' as const, ilvl: 70, affixes: [{ id: 'dmg:SLASH', value: 17, tier: 7 }] };
    expect(withoutAffixes(withMods(sword, tiered), tiered).damage![SLASH]).toBeCloseTo(sword.damage![SLASH]! * 1.2);
  });

  it('splits an item back into its own numbers and its affixes', () => {
    const mods = { rarity: 'mundane' as const, affixes: [{ id: 'dmg:SLASH', value: 9 }, { id: 'attr:intelligence', value: 2 }] };
    const m = withMods(sword, mods);
    expect(m.attributes).toMatchObject({ intellect: 2 });
    expect(withoutAffixes(m, mods).damage![SLASH]).toBeCloseTo(sword.damage![SLASH]! * 1.2);
    expect(withoutAffixes(m, mods).attributes?.intellect ?? 0).toBe(0);
    const armour = BUILTIN_ITEMS.get('scale_armor')!;
    const res = { affixes: [{ id: 'res:FIRE', value: 0.1 }] };
    const FIRE = DAMAGE_TYPES.indexOf('FIRE');
    expect(withoutAffixes(withMods(armour, res), res).protection![FIRE]).toBeCloseTo(armour.protection?.[FIRE] ?? 1, 3);
  });

  it('stacks rarity × refinement, then flat affixes (03 §5.1)', () => {
    const m = withMods(sword, { rarity: 'legendary', plus: 10, affixes: [{ id: 'dmg:SLASH', value: 12 }, { id: 'attr:might', value: 3 }, { id: 'hp', value: 40 }] });
    expect(m.damage![SLASH]).toBeCloseTo(10 * 2 * 1.5 + 12);
    expect(m.attributes).toMatchObject({ might: 3 });
    expect(m.bonusHp).toBe(40);
    const eq = equipmentOf([{ slot: 0, itemId: 'scale_armor', equipped: true, mods: { rarity: 'legendary', plus: 10, affixes: [{ id: 'res:FIRE', value: 0.9 }] } }], BUILTIN_ITEMS);
    // Never past 75 % resistance.
    expect(Math.min(...eq.protection)).toBeGreaterThanOrEqual(0.25);
  });

  it('refinement never lowers the item, and +0 to +10 takes about 27.4 attempts on average', () => {
    expect(refineOnce({ plus: 9 }, 0.99)).toEqual({ mods: { plus: 9, failstacks: 1 }, success: false });
    expect(refineOnce({ plus: 9, failstacks: 3 }, 0)).toEqual({ mods: { plus: 10 }, success: true });
    const r = rng(7);
    let attempts = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      let mods = {};
      while (((mods as { plus?: number }).plus ?? 0) < REFINE_LEVELS.length) {
        mods = refineOnce(mods, r()).mods;
        attempts++;
      }
    }
    // Exactly 27.38 by 04 §3's own formula (its table's 30.78 is off).
    expect(attempts / runs).toBeGreaterThan(26.8);
    expect(attempts / runs).toBeLessThan(28);
  });
});

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

describe('refining in the zone', () => {
  it('at a merchant, for gold and materials; off the feature, refused', () => {
    const make = (features: Record<string, boolean>) => {
      const z = new WorldZone(rapier, 'refine', createSyntheticArena(), { send: () => {}, persist: () => {} }, { random: () => 0, features } as never);
      const inv: InventoryEntry[] = [{ slot: 0, itemId: 'long_sword', equipped: true }, { slot: 1, itemId: 'iron_scrap', equipped: false, quantity: 5 }];
      z.join(1, { name: 'Smith', characterId: null, position: { x: 0, y: 0.5, z: 0 }, gold: 1000, inventory: inv });
      const p = (z as unknown as { players: Map<number, { inventory: InventoryEntry[]; gold: number; shop: unknown; weapon: { damage: number[] } }> }).players.get(1)!;
      return { z, p };
    };
    const off = make({});
    off.p.shop = { id: 1, stock: [], openedAt: 0, gift: false };
    off.z.refine(1, 0, 'long_sword');
    expect(off.p.inventory[0]!.mods).toBeUndefined();
    const on = make({ mmoItems: true });
    on.z.refine(1, 0, 'long_sword');
    expect(on.p.inventory[0]!.mods).toBeUndefined(); // no shop open
    on.p.shop = { id: 1, stock: [], openedAt: 0, gift: false };
    on.z.refine(1, 0, 'long_sword');
    expect(on.p.inventory.find((e) => e.itemId === 'long_sword')!.mods).toEqual({ plus: 1 });
    expect(on.p.gold).toBe(900);
    expect(on.p.inventory.find((e) => e.itemId === 'iron_scrap')!.quantity).toBe(3);
    expect(on.p.weapon.damage[SLASH]).toBeCloseTo(10.4);
  });
});

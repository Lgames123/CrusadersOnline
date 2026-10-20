import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { BUILTIN_ITEMS, DAMAGE_TYPES, REFINE_LEVELS, createSyntheticArena, equipmentOf, initPhysics, refineOnce, rollMods, rollRarity, withMods, type InventoryEntry, type Rapier } from '@crusaders/shared';

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
    expect(rollMods(sword, () => 0.02)?.affixes?.length).toBe(1); // the same affix rolled 4 times adds up
    expect(Math.abs(tally['worn']! / n - 0.7)).toBeLessThan(0.01);
    expect(Math.abs(tally['mundane']! / n - 0.25)).toBeLessThan(0.01);
    expect(Math.abs(tally['tempered']! / n - 0.049)).toBeLessThan(0.004);
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

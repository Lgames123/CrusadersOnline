import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { TICK_RATE, buildLevelArena, createSyntheticArena, initPhysics, oreNodes, salvageYield, skillLevel, skillXpFor, type InventoryEntry, type LevelPlacements, type Rapier } from '@crusaders/shared';

const levelsDir = path.resolve(import.meta.dirname, '../../local/generated/levels');
const have = fs.existsSync(path.join(levelsDir, 'cm1a.placements.json'));
const level = (act: string) => {
  const placements = JSON.parse(fs.readFileSync(path.join(levelsDir, `${act}.placements.json`), 'utf8')) as LevelPlacements;
  return buildLevelArena(`level:${act}`, new Uint8Array(fs.readFileSync(path.join(levelsDir, `${placements.mesh}.collision.bin`))), placements);
};

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

describe('soft skills (MMO Stage 6)', () => {
  it('the skill curve: level 1 at 0 XP, 99 at about 13 million', () => {
    expect(skillLevel(0)).toBe(1);
    expect(skillXpFor(2)).toBe(83);
    expect(skillLevel(83)).toBe(2);
    expect(skillXpFor(99)).toBeGreaterThan(13_000_000);
    expect(skillLevel(skillXpFor(50))).toBe(50);
  });

  it('salvage yields by rarity', () => {
    expect(salvageYield(undefined, 0)).toMatchObject({ itemId: 'iron_scrap', count: 2 });
    expect(salvageYield({ rarity: 'mundane' }, 0.99)).toMatchObject({ itemId: 'enchanted_dust', count: 3 });
    expect(salvageYield({ rarity: 'legendary' }, 0.5)).toMatchObject({ itemId: 'divine_catalyst', count: 1 });
  });

  it.skipIf(!have)('the mines and caves have veins; towns have none', () => {
    const veins = oreNodes('cm1a', level('cm1a'));
    expect(veins.length).toBeGreaterThan(0);
    expect(new Set(veins.map((v) => v.kind)).size).toBeGreaterThan(1);
    expect(oreNodes('cs1a', level('cs1a'))).toEqual([]);
  });

  it.skipIf(!have)('mining a vein in reach, at its pace; it runs dry', () => {
    const arena = level('cm1a');
    const vein = oreNodes('cm1a', arena)[0]!;
    const z = new WorldZone(rapier, 'level:cm1a', arena, { send: () => {}, persist: () => {} }, { features: { mmoCrafting: true }, random: () => 0.5 });
    z.join(1, { name: 'Miner', characterId: 'c1', position: { x: vein.x + 1, y: vein.y + 0.2, z: vein.z } });
    const p = (z as unknown as { players: Map<number, { inventory: InventoryEntry[]; skills: Record<string, number> }> }).players.get(1)!;
    const ore = () => p.inventory.filter((e) => e.itemId === 'iron_scrap' || e.itemId === 'polishing_stone' || e.itemId === 'mithril_crystal').reduce((n, e) => n + (e.quantity ?? 1), 0);
    z.craft(1, { action: 'mine', vein: vein.id });
    expect(ore()).toBeGreaterThan(0);
    expect(p.skills['mining']).toBeGreaterThan(0);
    const after = ore();
    z.craft(1, { action: 'mine', vein: vein.id }); // too soon
    expect(ore()).toBe(after);
    for (let i = 0; i < 10; i++) {
      for (let t = 0; t < 3 * TICK_RATE; t++) z.step();
      z.craft(1, { action: 'mine', vein: vein.id });
    }
    // 3 to 5 charges, then it is worked out.
    expect(ore()).toBeLessThanOrEqual(5 * 2);
  });

  it('smithing and salvaging at a merchant', () => {
    const z = new WorldZone(rapier, 'smithy', createSyntheticArena(), { send: () => {}, persist: () => {} }, { features: { mmoCrafting: true }, random: () => 0.5 });
    z.join(1, { name: 'Smith', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 }, gold: 500, inventory: [{ slot: 0, itemId: 'iron_scrap', equipped: false, quantity: 10 }, { slot: 1, itemId: 'axe', equipped: false, mods: { rarity: 'mundane' } }] });
    const p = (z as unknown as { players: Map<number, { inventory: InventoryEntry[]; gold: number; shop: unknown; skills: Record<string, number> }> }).players.get(1)!;
    z.craft(1, { action: 'smith', recipe: 'long_sword' });
    expect(p.inventory.some((e) => e.itemId === 'long_sword')).toBe(false); // no anvil (merchant) here
    p.shop = { id: 1, stock: [], openedAt: 0, gift: false };
    z.craft(1, { action: 'smith', recipe: 'long_sword' }); // needs Smithing 5
    expect(p.inventory.some((e) => e.itemId === 'long_sword')).toBe(false);
    z.craft(1, { action: 'smith', recipe: 'polish' });
    expect(p.inventory.find((e) => e.itemId === 'polishing_stone')?.quantity ?? 1).toBe(1);
    expect(p.inventory.find((e) => e.itemId === 'iron_scrap')!.quantity).toBe(6);
    expect(p.gold).toBe(490);
    z.craft(1, { action: 'salvage', slot: 1, itemId: 'axe' });
    expect(p.inventory.some((e) => e.itemId === 'axe')).toBe(false);
    expect(p.inventory.find((e) => e.itemId === 'enchanted_dust')!.quantity).toBe(2);
    expect(p.skills['salvaging']).toBe(40);
  });
});

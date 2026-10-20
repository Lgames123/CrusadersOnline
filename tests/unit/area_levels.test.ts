import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  AREA_LEVELS, MOB_ARCHETYPES, NECROS_LEVEL, WAYPOINT_CHAPTERS, areaLevel, createSyntheticArena, initPhysics, levelForXp, mmoXpForLevel,
  mmoXpStep, mobBaseXp, mobHpScale, xpForLevel, xpLevelFactor, xpRewardForKill, type Rapier,
} from '@crusaders/shared';

describe('area levels (MMO)', () => {
  it('gives every campaign act a level, rising through the chapters', () => {
    let last = 0;
    for (const c of WAYPOINT_CHAPTERS) {
      const levels = c.acts.map((a) => AREA_LEVELS[a]);
      for (const l of levels) expect(l).toBeGreaterThanOrEqual(1);
      // Each chapter starts no lower than the one before ended, less a level or two of overlap.
      expect(Math.min(...(levels as number[]))).toBeGreaterThanOrEqual(last - 2);
      last = Math.max(...(levels as number[]));
    }
    expect(last).toBe(50);
    expect(areaLevel('train')).toBe(1);
    expect(areaLevel('level:bs1a')).toBe(49);
    expect(areaLevel('level:ca1d@crypt-3')).toBe(AREA_LEVELS['ca1d']);
    expect(areaLevel('cs1b-inn')).toBe(AREA_LEVELS['cs1b']);
    expect(areaLevel('synthetic-arena')).toBe(1);
    expect(NECROS_LEVEL).toBe(50);
  });

  it('keeps the original XP curve by default and adds the MMO one', () => {
    expect([2, 3, 4].map((l) => xpForLevel(l))).toEqual([500, 1500, 3500]);
    expect(mmoXpStep(1)).toBe(500);
    expect(mmoXpStep(10)).toBeCloseTo(7460, -2);
    // The wall before Necros: 45 → 50 costs more than the whole campaign up to 45.
    const campaign = mmoXpForLevel(45);
    const wall = mmoXpForLevel(50) - campaign;
    expect(campaign).toBeGreaterThan(800_000);
    expect(campaign).toBeLessThan(1_100_000);
    expect(wall).toBeGreaterThan(campaign);
    expect(mmoXpStep(45)).toBeGreaterThan(80_000);
    expect(mmoXpStep(49)).toBeGreaterThan(470_000);
    expect(mmoXpStep(50)).toBe(550_000);
    for (let l = 2; l < 100; l++) expect(mmoXpStep(l)).toBeGreaterThanOrEqual(mmoXpStep(l - 1));
    expect(levelForXp(mmoXpForLevel(50), true)).toBe(50);
    expect(levelForXp(mmoXpForLevel(50) - 1, true)).toBe(49);
    expect(levelForXp(1e12, true)).toBe(100);
    expect(levelForXp(1e12)).toBe(50);
  });

  it('pays XP by the creature\'s level and the level gap', () => {
    expect([1, 10, 50].map(mobBaseXp)).toEqual([38, 318, 2148]);
    expect(xpLevelFactor(20, 17)).toBe(1);
    expect(xpLevelFactor(20, 23)).toBe(1);
    expect(xpLevelFactor(20, 15)).toBeCloseTo(0.7);
    expect(xpLevelFactor(40, 1)).toBe(0.02);
    expect(xpLevelFactor(1, 50)).toBe(1.2);
    expect(xpRewardForKill(1, 100)).toBe(1);
    expect(xpRewardForKill(50, 50, 10)).toBe(21_480);
  });
});

describe('creatures at their area\'s level (feature mmoLevels)', () => {
  let rapier: Rapier;
  beforeAll(async () => {
    rapier = await initPhysics();
  });
  type M = { kind: string; level: number; rank: string; maxHp: number; levelDamage: number; archetype: { xpReward: number } };
  const mob = (features: Record<string, boolean>, act: string) => {
    const z = new WorldZone(rapier, act, { ...createSyntheticArena(), name: act }, { send: () => {}, persist: () => {} }, { random: () => 0.5, features } as never);
    return [...(z as unknown as { actors: Map<number, M> }).actors.values()].find((a) => a.kind === 'mob')!;
  };

  it('scales HP, blows and XP with the act\'s level', () => {
    const base = MOB_ARCHETYPES['skeleton_warrior']!;
    const m = mob({ mmoLevels: true }, 'level:gl1b');
    expect(m.level).toBe(40);
    expect(m.maxHp).toBe(Math.round(base.maxHp * mobHpScale(40)));
    expect(m.levelDamage).toBeCloseTo(1 + 0.035 * 39);
    expect(m.archetype.xpReward).toBe(mobBaseXp(40));
  });

  it('leaves the original numbers alone without the feature (the level still sets item levels)', () => {
    const base = MOB_ARCHETYPES['skeleton_warrior']!;
    const m = mob({}, 'level:gl1b');
    expect(m.level).toBe(40);
    expect(m.maxHp).toBe(base.maxHp);
    expect(m.levelDamage).toBe(1);
    expect(m.archetype.xpReward).toBe(base.xpReward);
  });
});

import { describe, expect, it } from 'vitest';
import {
  effectiveAttributes,
  originalDamageMultiplier,
  originalMaxHp,
  originalMaxMana,
  originalSpeedMultiplier,
  originalWeaponHit,
} from '@crusaders/shared';

// Drake's medium-difficulty attributes (default.ctx: might 20, intellect 15, endurance 25, speed 15).
const DRAKE_MEDIUM = { might: 20, intellect: 15, endurance: 25, speed: 15 };

describe('original derived-stat formulas', () => {
  it('match hand-evaluated values at level 1 and 10', () => {
    expect(originalMaxHp(DRAKE_MEDIUM, 1)).toBeCloseTo(65);
    expect(originalMaxHp(DRAKE_MEDIUM, 10)).toBeCloseTo(200);
    expect(originalMaxMana(DRAKE_MEDIUM, 1)).toBe(25);
    expect(originalMaxMana(DRAKE_MEDIUM, 10)).toBe(70);
    expect(originalDamageMultiplier(DRAKE_MEDIUM, 1)).toBeCloseTo(1.0);
    expect(originalDamageMultiplier(DRAKE_MEDIUM, 10)).toBeCloseTo(1.9);
    expect(originalSpeedMultiplier(DRAKE_MEDIUM, 1)).toBeCloseTo(1.009);
    expect(originalSpeedMultiplier({ ...DRAKE_MEDIUM, speed: 50 }, 1)).toBeCloseTo(1.609);
  });

  it('caps effective attributes at 50 and picks the stronger weapon component', () => {
    expect(effectiveAttributes(DRAKE_MEDIUM, { might: 40 }).might).toBe(50);
    expect(originalWeaponHit(8, 5, 1.5)).toEqual({ type: 'slash', amount: 12 });
    expect(originalWeaponHit(0, 10, 1.0)).toEqual({ type: 'bash', amount: 10 });
  });
});

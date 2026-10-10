import { describe, expect, it } from 'vitest';
import {
  effectiveAttributes,
  originalDamageMultiplier,
  originalMaxHp,
  originalMaxMana,
  originalSpeedMultiplier,
  originalWeaponHit,
  originalDamageTaken,
  originalFlinch,
  ORIGINAL_BLOCK_COS,
} from '@crusaders/shared';
import { parseItemsCtx } from '@crusaders/converter';

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

describe('original damage taken', () => {
  it('applies absorb (clamped), resist and armour per type, then sums', () => {
    const incoming = [10, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const easyResist = [0.6, 0.6, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const plate = [0.6, 0.6];
    expect(originalDamageTaken(incoming, easyResist)).toBeCloseTo(8.4);
    expect(originalDamageTaken(incoming, easyResist, plate)).toBeCloseTo(5.04);
    expect(originalDamageTaken(incoming, easyResist, plate, [6, 6])).toBeCloseTo(1.44); // bash fully absorbed
  });

  it('rolls flinches and exposes the radians-based block cone', () => {
    expect(originalFlinch(70, 100, 0)).toBe('flinch');
    expect(originalFlinch(10, 100, 1)).toBe('none');
    expect(originalFlinch(40, 100, 0.9)).toBe('stagger');
    expect(Math.acos(ORIGINAL_BLOCK_COS) * (180 / Math.PI)).toBeCloseTo(81.1, 0);
  });
});

describe('items.ctx parser', () => {
  it('resolves inheritance, damage, protection and calls (synthetic sample)', () => {
    const items = parseItemsCtx(`
      /* block comment */
      item Axe { Type = WEAPON; Speed = 1.1; SetDamage(SLASH,5); SetDamage(BASH,5); Price = 100; };
      item "Battle Axe": Axe { SetDamage(SLASH,8); Price = 150; }; // child
      item "Scale Armor" { Type = ARMOR; SetProtection(SLASH,0.9); };
      item Ring { Type = RING; Equip = BOOST_ATTRIBUTE; EquipParameters(-1,MIGHT,5); }
    `);
    const battle = items.find((i) => i.name === 'Battle Axe')!;
    expect(battle.fields).toMatchObject({ Type: 'WEAPON', Speed: 1.1, Price: 150 });
    expect(battle.damage).toEqual({ SLASH: 8, BASH: 5 });
    expect(items.find((i) => i.name === 'Scale Armor')!.protection).toEqual({ SLASH: 0.9 });
    expect(items.find((i) => i.name === 'Ring')!.calls).toEqual([{ name: 'EquipParameters', args: [-1, 'MIGHT', 5] }]);
  });
});

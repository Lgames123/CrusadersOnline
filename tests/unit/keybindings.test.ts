import { describe, expect, it } from 'vitest';
import { comboCode, compileBindings, formatKeyCode } from '../../client/src/input/keybindings.ts';

describe('hotbar keybindings', () => {
  it('row 1 on 1-9, row 2 on Shift+1-9, F1/F2 left to the original screens', () => {
    const b = compileBindings();
    expect(b.hotbarFor('Digit1')).toBe(0);
    expect(b.hotbarFor('Digit9')).toBe(8);
    expect(b.hotbarFor('Shift+Digit1')).toBe(9);
    expect(b.hotbarFor('Shift+Digit9')).toBe(17);
    expect(b.hotbarKeys).toHaveLength(18);
    expect(b.hotbarFor('F1')).toBeNull();
    expect(b.actionFor('F1')).toBe('characterSheet');
  });

  it('binds Shift combos only with another key', () => {
    expect(comboCode({ code: 'Digit3', shiftKey: true })).toBe('Shift+Digit3');
    expect(comboCode({ code: 'Digit3', shiftKey: false })).toBe('Digit3');
    expect(comboCode({ code: 'ShiftLeft', shiftKey: true })).toBe('ShiftLeft');
    expect(formatKeyCode('Shift+Digit3')).toBe('Shift+3');
  });

  it('custom keys replace a slot', () => {
    const b = compileBindings({ hotbar10: ['F5'] });
    expect(b.hotbarFor('F5')).toBe(9);
    expect(b.hotbarFor('Shift+Digit1')).toBeNull();
  });
});

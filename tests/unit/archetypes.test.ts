import { describe, expect, it } from 'vitest';
import { BUILTIN_ITEMS, LEVEL_ARCHETYPES, MOB_ARCHETYPES } from '@crusaders/shared';

describe('creature archetypes', () => {
  it('every level creature type maps to an archetype whose weapon and shield are known items', () => {
    for (const [type, id] of Object.entries(LEVEL_ARCHETYPES)) {
      const a = MOB_ARCHETYPES[id];
      expect(a, `type ${type}`).toBeDefined();
      // The elementals and Necros fight unarmed (their template names no weapon).
      if (a!.weapon !== 'unarmed') expect(BUILTIN_ITEMS.get(a!.weapon)?.type, `${id} weapon`).toBe('weapon');
      if (a!.shield) expect(BUILTIN_ITEMS.get(a!.shield)?.type, `${id} shield`).toBe('shield');
      expect(a!.resist).toHaveLength(11);
    }
  });

  it('carries the creature template loadouts (executable creature table)', () => {
    expect(MOB_ARCHETYPES['ogre_outlaw']).toMatchObject({ weapon: 'battle_axe', shield: null });
    expect(MOB_ARCHETYPES['dwarf_rebel']).toMatchObject({ weapon: 'war_hammer', shield: 'metal_shield' });
    expect(MOB_ARCHETYPES['dasher_brute']).toMatchObject({ weapon: 'dasher_weapon', shield: null });
    expect(MOB_ARCHETYPES['black_knight']).toMatchObject({ weapon: 'broad_sword', shield: 'metal_shield' });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { packCollision } from '@crusaders/converter/emit/gltf_level';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  ANIM,
  CREATURE_CAST,
  ELEMENTAL_ATTACKS,
  INPUT_PACKET_MAX_BYTES,
  LEVEL_ARCHETYPES,
  MOB_ARCHETYPES,
  SC,
  SPELLS,
  TICK_RATE,
  buildLevelArena,
  chooseMobSequence,
  createSyntheticArena,
  creatureSpellBits,
  encodeInput,
  initPhysics,
  necrosSpell,
  type ArenaDef,
  type LevelPlacements,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const FT = 0.3048;
type CombatMsg = Extract<ServerControlMsg, { op: typeof SC.COMBAT_EVENT }>['d'];
type SpellMsg = Extract<ServerControlMsg, { op: typeof SC.SPELL_EVENT }>['d'];

/** A player standing still and one creature `ft` feet in front of him, facing him. */
function setup(spawn: Partial<ArenaDef['mobSpawns'][number]> & { archetype: string }, ft: number, random = 0) {
  const arena = createSyntheticArena();
  arena.mobSpawns = [{ x: 0, y: 0.5, z: -ft * FT, yaw: Math.PI, ...spawn }];
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'monsters', arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { random: () => random });
  zone.join(1, { name: 'Target', characterId: null, position: { x: 0, y: 0.5, z: 0 }, experience: 1_000_000 });
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let clientTick = 0;
  const playerAnims: number[] = [];
  const mobAnims: number[] = [];
  const mob = () => zone.inspect().find((a) => a.kind === 'mob')!;
  const player = () => zone.inspect().find((a) => a.kind === 'player')!;
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++clientTick, flags: 0, yaw: 0, pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
      playerAnims.push(player().anim);
      mobAnims.push(mob().anim);
    }
  };
  const hits = (): CombatMsg[] => messages.filter((m) => m.op === SC.COMBAT_EVENT).map((m) => (m as Extract<ServerControlMsg, { op: typeof SC.COMBAT_EVENT }>).d).filter((d) => d.target === player().id);
  const spellEvents = (): SpellMsg[] => messages.filter((m) => m.op === SC.SPELL_EVENT).map((m) => (m as Extract<ServerControlMsg, { op: typeof SC.SPELL_EVENT }>).d);
  const spawned = () => messages.filter((m) => m.op === SC.ENTITY_SPAWN).map((m) => (m as Extract<ServerControlMsg, { op: typeof SC.ENTITY_SPAWN }>).d.id);
  return { zone, run, mob, player, hits, spellEvents, spawned, playerAnims, mobAnims };
}

describe('missing monsters (data)', () => {
  it('maps the elementals, Necros and the Ghost Father to archetypes', () => {
    expect(LEVEL_ARCHETYPES[136]).toBe('ice_elemental');
    expect(LEVEL_ARCHETYPES[137]).toBe('rock_elemental');
    expect(LEVEL_ARCHETYPES[138]).toBe('lava_elemental');
    expect(LEVEL_ARCHETYPES[150]).toBe('necros');
    expect(LEVEL_ARCHETYPES[156]).toBe('ghost_father');
    expect(MOB_ARCHETYPES['rock_elemental']).toMatchObject({ weapon: 'unarmed', type: 137, unarmed: [0, 10, 0, 0, 10, 0, 0, 0, 0, 0, 0] });
    expect(MOB_ARCHETYPES['necros']).toMatchObject({ steadfast: true, knocksDown: true, rams: true, type: 150 });
  });

  it("gives Necros his difficulty-scaled spells (0x004BD7C0's Necros branch)", () => {
    expect(creatureSpellBits(150, CREATURE_CAST.closeMask)).toEqual([2, 3]);
    expect(creatureSpellBits(150, CREATURE_CAST.rangedMask)).toEqual([6, 9]);
    expect(necrosSpell(6, 'medium')).toMatchObject({ spell: 'fireball', level: 3, values: { value1: 10 } });
    expect(necrosSpell(9, 'easy')!.values.value1).toBe(5);
    expect(necrosSpell(2, 'hard')).toMatchObject({ spell: 'soul_drinker', values: { value1: 12, value2: 20 }, cooldown: 1 });
    expect(necrosSpell(3, 'medium')).toMatchObject({ spell: 'holy_wrath', values: { value1: 20, duration: 4 } });
  });

  it("plays the elementals' own attacks: CHOP_LOW for the jab, three sweeps, a harmless leap", () => {
    const close = chooseMobSequence(4 * FT, 0.5, true, ELEMENTAL_ATTACKS);
    expect(close.main).toHaveLength(1);
    expect(close.main[0]).toMatchObject({ kind: 'low' });
    expect(close.main[0]!.again!.map((g) => g.frame)).toEqual([19, 28]);
    expect(ELEMENTAL_ATTACKS.jump.harmless).toBe(true);
    expect(ELEMENTAL_ATTACKS.normal.reach).toBeGreaterThan(11 * FT);
  });

  it('a creature scaled above 1.5 never hops and adds 3 to its roll (0x004083F0)', () => {
    expect(chooseMobSequence(7.5 * FT, 0, true, undefined, 1.5)).toMatchObject({ hop: true });
    const big = chooseMobSequence(7.5 * FT, 0, true, undefined, 2);
    expect(big.hop).toBe(false);
    expect(big.main.map((a) => a.kind)).toEqual(['normal', 'overhead']);
  });
});

describe('missing monsters (level data)', () => {
  const floor = () => packCollision([0, 100, 0, 40, 100, 0, 40, 100, -40, 0, 100, -40], [0, 1, 2, 0, 2, 3]);
  it("carries a placement's unarmed damage and scale, and keeps a sequence-revealed creature hidden", () => {
    const placements: LevelPlacements = {
      mesh: 'test',
      creatures: [
        { type: 137, name: 'RockElemental', position: [10, 100, -10], hp: 150, xp: 125, disposition: 3, resist: [1, 1, 1, 1.25, 0, 1, 1, 1, 0.75, 0, 0], damage: [0, 10, 0, 0, 10, 0, 0, 0, 0, 0, 0], scale: 0.8 },
        { type: 150, name: 'Necros', position: [20, 100, -20], hp: 1000, xp: 10, disposition: 3, resist: [0.8, 0.8, 0.21, 0.24, 0.22, 0.21, 0.43, 0.13, 0.3, 0.3, 0], scale: 1.5 },
      ],
      story: {
        triggers: [], cameras: [],
        sequences: [{
          name: 'seqNecros', trigger: 1,
          actors: [{ player: true }, { creature: 1 }],
          tracks: [{ actor: 3, steps: [0, 1] }],
          steps: [
            { action: 'Appear', when: null, args: { appear: 0, no_collide: 1 } },
            { action: 'Appear', when: null, args: { appear: 1 } },
          ],
        }],
      },
    };
    const arena = buildLevelArena('level:test', floor(), placements);
    expect(arena.mobSpawns[0]).toMatchObject({ archetype: 'rock_elemental', damage: [0, 10, 0, 0, 10, 0, 0, 0, 0, 0, 0], scale: 0.8 });
    expect(arena.mobSpawns[0]!.hidden).toBeUndefined();
    expect(arena.mobSpawns[1]).toMatchObject({ archetype: 'necros', hidden: true, scale: 1.5 });
  });
});

describe('missing monsters (brain)', () => {
  it('a Rock Elemental punches the player with its fists and its EARTH', () => {
    const t = setup({ archetype: 'rock_elemental' }, 6);
    t.run(Math.round(4 * TICK_RATE));
    const hit = t.hits().find((h) => h.attacker === t.mob().id && h.damage > 0);
    expect(hit).toBeDefined();
  });

  it("an Ice Elemental placed without spells (mask 0, the placements' own) runs straight in and punches", () => {
    const t = setup({ archetype: 'ice_elemental', spells: 0 }, 30);
    const start = Math.abs(t.mob().z);
    t.run(Math.round(1 * TICK_RATE));
    expect(t.mobAnims).toContain(ANIM.RUN);
    expect(t.mobAnims).not.toContain(ANIM.SPELL_CAST + SPELLS.indexOf('fireball'));
    // Its run clip: 18 ft in 20 frames (27 ft/s), far past the humanoid run.
    expect(start - Math.abs(t.mob().z)).toBeGreaterThan(3);
    t.run(Math.round(3 * TICK_RATE));
    expect(t.hits().some((h) => h.attacker === t.mob().id && h.damage > 0)).toBe(true);
  });

  it("a Lava Elemental (mask 0x80) at range walks in on its empty throw (icewalk's root motion)", () => {
    const t = setup({ archetype: 'lava_elemental', spells: 0x80 }, 30);
    const start = Math.abs(t.mob().z);
    t.run(Math.round(1.5 * TICK_RATE));
    expect(t.mobAnims).toContain(ANIM.SPELL_CAST + SPELLS.indexOf('fireball'));
    expect(t.spellEvents().some((e) => e.projectile)).toBe(false);
    expect(Math.abs(t.mob().z)).toBeLessThan(start - 1);
  });

  it("uses the placement's spell mask over the template's (a Shadow with 4 drinks souls)", () => {
    expect(creatureSpellBits(147, CREATURE_CAST.closeMask, 4)).toEqual([2]);
    expect(creatureSpellBits(136, CREATURE_CAST.rangedMask, 0)).toEqual([]);
  });

  it('a hidden creature is not sent, does not think and cannot be fought', () => {
    const t = setup({ archetype: 'necros', hidden: true }, 4);
    t.run(Math.round(3 * TICK_RATE));
    expect(t.hits()).toHaveLength(0);
    expect(t.spawned()).not.toContain(t.mob().id);
  });

  it('Necros raises his Force Globe first, and his blows knock the player down', () => {
    const t = setup({ archetype: 'necros' }, 5);
    t.run(Math.round(6 * TICK_RATE));
    expect(t.mobAnims).toContain(ANIM.SPELL_CAST + SPELLS.indexOf('torch_light'));
    expect(t.spellEvents().some((e) => e.status?.some((s) => s.tag === 'GLOB' && s.on))).toBe(true);
    const blow = t.hits().find((h) => h.attacker === t.mob().id && h.damage > 0);
    expect(blow).toBeDefined();
    expect(t.playerAnims).toContain(ANIM.KNOCKDOWN);
  });
});

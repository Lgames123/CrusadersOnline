import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  ANIM,
  CREATURE_CAST,
  CREATURE_SPELLS,
  INPUT_PACKET_MAX_BYTES,
  SC,
  SPELLS,
  TICK_RATE,
  createSyntheticArena,
  creatureSpellBits,
  creatureSpellClipSeconds,
  encodeInput,
  initPhysics,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

type SpellMsg = Extract<ServerControlMsg, { op: typeof SC.SPELL_EVENT }>['d'];
type CombatMsg = Extract<ServerControlMsg, { op: typeof SC.COMBAT_EVENT }>['d'];

const FT = 0.3048;

/** A player standing still, and one caster `ft` feet in front of him, facing him. */
function setup(archetype: string, ft: number, random = 0) {
  const arena = createSyntheticArena();
  arena.mobSpawns = [{ archetype, x: 0, y: 0.5, z: -ft * FT, yaw: Math.PI }];
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'creature-spells', arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { random: () => random });
  zone.join(1, { name: 'Target', characterId: null, position: { x: 0, y: 0.5, z: 0 }, experience: 100_000 });
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let clientTick = 0;
  const anims: number[] = [];
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++clientTick, flags: 0, yaw: 0, pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
      anims.push(caster().anim);
    }
  };
  const caster = () => zone.inspect().find((a) => a.kind === 'mob')!;
  const player = () => zone.inspect().find((a) => a.kind === 'player')!;
  const spellEvents = (): SpellMsg[] => messages.filter((m) => m.op === SC.SPELL_EVENT).map((m) => (m as Extract<ServerControlMsg, { op: typeof SC.SPELL_EVENT }>).d);
  const hits = (): CombatMsg[] => messages.filter((m) => m.op === SC.COMBAT_EVENT).map((m) => (m as Extract<ServerControlMsg, { op: typeof SC.COMBAT_EVENT }>).d).filter((d) => d.target === player().id);
  return { zone, run, caster, player, spellEvents, hits, anims };
}

describe('creature spells (data)', () => {
  it('reads the template masks into the brain groups', () => {
    // Dark Mage 0x25: soul drinker close, fire ball ranged (bit 0, stone skin, never chosen).
    expect(creatureSpellBits(143, CREATURE_CAST.closeMask)).toEqual([2]);
    expect(creatureSpellBits(143, CREATURE_CAST.rangedMask)).toEqual([5]);
    // Dark Master 0x38: unholy wrath close, fire ball ranged (bit 4 has no spell).
    expect(creatureSpellBits(144, CREATURE_CAST.closeMask)).toEqual([3]);
    expect(creatureSpellBits(144, CREATURE_CAST.rangedMask)).toEqual([5]);
    // Skeleton Ghost 0x2: lightning; Deceiver 0x40: the homing fire ball; a skeleton warrior nothing.
    expect(creatureSpellBits(146, CREATURE_CAST.rangedMask)).toEqual([1]);
    expect(creatureSpellBits(134, CREATURE_CAST.rangedMask)).toEqual([6]);
    expect(creatureSpellBits(145, 0xfff)).toEqual([]);
    expect(CREATURE_SPELLS[6]).toMatchObject({ spell: 'fireball', level: 2 });
  });

  it('the Deceiver and the elementals throw with no SPELL event', () => {
    expect(creatureSpellClipSeconds(134, 'fireball').release).toBeNull();
    expect(creatureSpellClipSeconds(136, 'fireball').release).toBeNull();
    expect(creatureSpellClipSeconds(143, 'fireball').release).toBeCloseTo(12 / 30, 5);
  });
});

describe('creature spells (brain)', () => {
  it('a Skeleton Ghost beyond 8 ft casts lightning at the player (AIR 3) on its clip', () => {
    const t = setup('skeleton_ghost', 30);
    t.run(40);
    expect(t.anims).toContain(ANIM.SPELL_CAST + SPELLS.indexOf('lightning'));
    expect(t.spellEvents().some((e) => e.cast?.caster === t.caster().id && e.cast.spell === 'lightning' && e.cast.phase === 'release')).toBe(true);
    expect(t.spellEvents().some((e) => e.bolts?.length)).toBe(true);
    const hit = t.hits().find((h) => h.attacker === t.caster().id);
    expect(hit?.damage).toBeGreaterThan(0);
    expect(hit!.damage).toBeLessThanOrEqual(3 * 1.2);
  });

  it('waits out the cooldown standing, then casts again', () => {
    const t = setup('skeleton_ghost', 30);
    t.run(Math.round(7 * TICK_RATE));
    const releases = t.spellEvents().filter((e) => e.cast?.phase === 'release').length;
    // Lightning's cooldown is 6 s from the start of a cast.
    expect(releases).toBe(2);
  });

  it('a Dark Mage throws an evil fire ball that burns the player', () => {
    const t = setup('dark_mage', 30);
    t.run(60);
    const ball = t.spellEvents().find((e) => e.projectile?.spell === 'fireball');
    expect(ball?.projectile?.look).toBe('FIREBALL_PROJ_EVIL');
    expect(t.hits().some((h) => h.attacker === t.caster().id && h.damage > 0)).toBe(true);
  });

  it('a Dark Master at 8-20 ft calls unholy wrath: DARK on the player', () => {
    // floor(0.99 x 1000) > 700: the close spell.
    const t = setup('dark_master', 15, 0.99);
    t.run(60);
    expect(t.spellEvents().some((e) => e.fx?.some((f) => f.name === 'UNHOLY_WRATH_CAST'))).toBe(true);
    expect(t.spellEvents().some((e) => e.burst?.spell === 'holy_wrath' && e.burst.dark)).toBe(true);
    expect(t.hits().some((h) => h.attacker === t.caster().id && h.damage > 0)).toBe(true);
  });

  it('the Deceiver plays its throw and nothing leaves its hand', () => {
    const t = setup('deceiver', 30);
    t.run(60);
    expect(t.anims).toContain(ANIM.SPELL_CAST + SPELLS.indexOf('fireball'));
    expect(t.spellEvents().some((e) => e.projectile)).toBe(false);
    expect(t.hits().length).toBe(0);
  });

  it('within 8 ft a caster fights in melee', () => {
    const t = setup('skeleton_ghost', 6);
    t.run(60);
    expect(t.spellEvents().some((e) => e.cast)).toBe(false);
  });
});

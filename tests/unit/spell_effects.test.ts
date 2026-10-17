import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  INPUT_PACKET_MAX_BYTES,
  SC,
  SPELL_CONJURE_TICKS,
  createSyntheticArena,
  encodeInput,
  initPhysics,
  type Rapier,
  type ServerControlMsg,
  type SpellId,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

type StatsMsg = Extract<ServerControlMsg, { op: typeof SC.PLAYER_STATS }>['d'];
type SpellMsg = Extract<ServerControlMsg, { op: typeof SC.SPELL_EVENT }>['d'];

/**
 * A caster knowing `spell` at `level`, facing a skeleton warrior (25 HP) `ahead` metres away that
 * has its back to him (beyond its 20 ft near sense: it does not come and break the cast).
 */
function setup(spell: SpellId, level = 1, ahead = 8) {
  const arena = createSyntheticArena();
  arena.mobSpawns = [{ archetype: 'skeleton_warrior', x: 0, y: 0.5, z: -ahead }];
  const messages: ServerControlMsg[] = [];
  const zone = new WorldZone(rapier, 'spells', arena, {
    send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
  }, { random: () => 0 });
  zone.join(1, { name: 'Caster', characterId: null, position: { x: 0, y: 0.5, z: 0 }, spells: [{ spell, level }], selectedSpell: spell, experience: 100_000 });
  const stats = (): StatsMsg => (messages.filter((m) => m.op === SC.PLAYER_STATS).at(-1) as Extract<ServerControlMsg, { op: typeof SC.PLAYER_STATS }>).d;
  const spellEvents = (): SpellMsg[] => messages.filter((m) => m.op === SC.SPELL_EVENT).map((m) => (m as Extract<ServerControlMsg, { op: typeof SC.SPELL_EVENT }>).d);
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let clientTick = 0;
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++clientTick, flags: 0, yaw: 0, pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      zone.step();
    }
  };
  const mobs = () => zone.inspect().filter((a) => a.kind === 'mob');
  const skeleton = () => mobs()[0]!;
  const player = () => zone.inspect().find((a) => a.kind === 'player')!;
  return { zone, stats, run, spellEvents, mobs, skeleton, player, messages };
}

/** Casts and plays the whole cast out (conjure + clip) and a little more. */
function cast(t: ReturnType<typeof setup>, extra = 10): void {
  t.zone.castSpell(1);
  t.run(SPELL_CONJURE_TICKS + 40 + extra);
}

describe('spell effects', () => {
  it('fire ball flies, explodes on the creature and burns it (FIRE value1)', () => {
    const t = setup('fireball');
    t.run(5);
    const mana = t.stats().mana;
    t.zone.castSpell(1);
    t.run(20);
    expect(t.spellEvents().some((e) => e.projectile?.spell === 'fireball')).toBe(true);
    expect(t.stats().mana).toBe(mana - 5);
    // 10 FIRE x the skeleton's FIRE resist 1.
    expect(t.skeleton().hp).toBe(15);
    expect(t.spellEvents().some((e) => e.burst?.spell === 'fireball')).toBe(true);
  });

  it('lightning strikes the creature in the aim for AIR value1', () => {
    const t = setup('lightning');
    t.run(5);
    t.zone.castSpell(1);
    t.run(30);
    expect(t.spellEvents().some((e) => e.bolts?.length)).toBe(true);
    // 25 AIR kills the 25 HP skeleton.
    expect(t.skeleton().alive).toBe(false);
  });

  it('fantastic freeze holds the creature in the aim (duration x WATER resist), then it thaws', () => {
    const t = setup('freeze');
    t.run(5);
    cast(t, 0);
    const frozen = t.spellEvents().flatMap((e) => e.status ?? []).find((s) => s.tag === 'FRZE' && s.on);
    expect(frozen?.seconds).toBeCloseTo(10, 0);
    const at = { x: t.skeleton().x, z: t.skeleton().z };
    t.run(40);
    expect(t.skeleton().x).toBeCloseTo(at.x, 3);
    expect(t.skeleton().z).toBeCloseTo(at.z, 3);
    t.run(10 * 20);
    expect(t.spellEvents().flatMap((e) => e.status ?? []).some((s) => s.tag === 'THAW' && s.on)).toBe(true);
  });

  it('slow puts SLOW (x value1 for its duration) on the creature it hits', () => {
    const t = setup('slow');
    t.run(5);
    t.zone.castSpell(1);
    t.run(25);
    const slow = t.spellEvents().flatMap((e) => e.status ?? []).find((s) => s.tag === 'SLOW' && s.on);
    expect(slow?.seconds).toBeCloseTo(30, 0);
  });

  it('heroism speeds the caster and multiplies his blows; stone skin cuts what he takes', () => {
    const t = setup('heroism', 1, 40);
    t.run(5);
    const speed = t.stats().speed!;
    cast(t);
    expect(t.stats().statuses?.map((s) => s.tag).sort()).toEqual(['HERO', 'SPED']);
    expect(t.stats().speed).toBeCloseTo(speed * 1.1, 5);

    const s = setup('stoneskin', 1, 40);
    s.run(5);
    cast(s);
    expect(s.stats().statuses?.map((x) => x.tag)).toEqual(['STON']);
  });

  it('holy wrath burns the unholy within its ring (LIGHT value1)', () => {
    const t = setup('holy_wrath', 2);
    t.run(5);
    cast(t);
    // Level 2: a 30 ft ring, 60 LIGHT x the skeleton's LIGHT resist 1.5: dead.
    expect(t.skeleton().alive).toBe(false);
  });

  it('soul drinker turns against its caster on the undead', () => {
    const t = setup('soul_drinker');
    t.run(5);
    const hp = t.stats().hp;
    t.zone.castSpell(1);
    t.run(60);
    expect(t.spellEvents().some((e) => e.drain && e.drain.seconds > 0)).toBe(true);
    expect(t.stats().hp).toBeLessThan(hp);
  });

  it('spectral ally appears ahead of the caster and fights for him', () => {
    const t = setup('spectral_ally', 1, 14);
    t.run(5);
    cast(t);
    expect(t.mobs().length).toBe(2);
    t.run(20 * 15);
    expect(t.skeleton().hp).toBeLessThan(25);
  });
});

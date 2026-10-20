import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { createSyntheticArena, initPhysics, type ArenaDef, type Rapier, type StoryCreatureOp } from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

interface MobView {
  kind: string;
  entityId: number;
  placement?: number;
  state: string;
  threat: Map<number, number>;
  hp: number;
  maxHp: number;
  deadUntil: number;
  disposition: number;
}

/** A repeatable random: with a constant one every blow rolls the same long impact (stun-lock). */
function seeded(seed: number): () => number {
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/**
 * Creature against creature (0x40D910 / 0x40DC90 / 0x40D360, Ws5a's lever relays). The player
 * stands behind the creatures (they face -Z), out of their notice, unless a test moves him.
 */
function fightZone(spawns: ArenaDef['mobSpawns'], ops: StoryCreatureOp[][] = []) {
  const arena = createSyntheticArena();
  arena.name = 'level:t5a';
  arena.mobSpawns = spawns;
  arena.story = {
    triggers: ops.map((creatureOps, i) => ({ id: 900 + i, kind: 'relay' as const, activation: 0x301, targets: [], creatureOps })),
    cameras: [],
    sequences: [],
  };
  const zone = new WorldZone(rapier, arena.name, arena, { send: () => { }, portal: () => { }, persist: () => { } }, { random: seeded(12345) });
  zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: -14, y: 0.5, z: 14 } });
  const internals = zone as unknown as {
    players: Map<number, unknown>;
    actors: Map<number, MobView>;
    fireTrigger(p: unknown, t: unknown): void;
    applyDamage(a: unknown, t: unknown, v: number[]): void;
  };
  const fire = (i: number) => internals.fireTrigger(internals.players.get(1), arena.story!.triggers[i]);
  const mob = (placement: number) => [...internals.actors.values()].find((a) => a.kind === 'mob' && a.placement === placement)!;
  const player = () => [...internals.actors.values()].find((a) => a.kind === 'player')!;
  const hit = (from: MobView, to: MobView, amount: number) => {
    const v = new Array(11).fill(0);
    v[0] = amount;
    internals.applyDamage(from, to, v);
  };
  /** Its current enemy: the highest threat. */
  const enemy = (m: MobView) => [...m.threat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const run = (ticks: number) => { for (let i = 0; i < ticks; i++) zone.step(); };
  return { zone, fire, mob, player, hit, enemy, run };
}

const guard = (placement: number, x: number, z: number): ArenaDef['mobSpawns'][number] => ({ archetype: 'npc_113', placement, disposition: 2, x, y: 0.5, z });
const skeleton = (placement: number, x: number, z: number, yaw = 0, y = 0.5): ArenaDef['mobSpawns'][number] => ({ archetype: 'skeleton_warrior', placement, x, y, z, hp: 25, yaw });

describe('creature against creature', () => {
  it('guards and hostiles leave each other alone without a relay (0x40D910: guards pick only the alarmed player, hostiles the player)', () => {
    const t = fightZone([guard(1, 0, -6), skeleton(2, 0, -10)]);
    t.run(200);
    expect(t.mob(1).state).toBe('idle');
    expect(t.mob(2).state).toBe('idle');
    expect(t.mob(1).hp).toBe(t.mob(1).maxHp);
    expect(t.mob(2).hp).toBe(t.mob(2).maxHp);
  });

  it("Ws5a's lever: attackTarget pairs and fightNearest start the fight, and blows land", () => {
    const t = fightZone([guard(1, 0, -6), skeleton(2, 0, -12)], [[
      { op: 'attackTarget', creature: 1, other: 2 },
      { op: 'attackTarget', creature: 2, other: 1 },
      { op: 'fightNearest', creature: 1 },
      { op: 'fightNearest', creature: 2 },
    ]]);
    t.fire(0);
    expect(t.mob(1).state).toBe('chase');
    expect(t.enemy(t.mob(1))).toBe(t.mob(2).entityId);
    expect(t.enemy(t.mob(2))).toBe(t.mob(1).entityId);
    t.run(20 * 15);
    // Blows land both ways.
    expect(t.mob(1).hp).toBeLessThan(t.mob(1).maxHp);
    expect(t.mob(2).hp < t.mob(2).maxHp || t.mob(2).deadUntil > 0).toBe(true);
  });

  it('fightNearest takes the nearest enemy at any range, then the next one when it dies', () => {
    const t = fightZone([guard(1, 0, -4), skeleton(2, 0, -9), skeleton(3, 0, -17)], [[{ op: 'fightNearest', creature: 1 }]]);
    t.fire(0);
    t.run(1);
    expect(t.enemy(t.mob(1))).toBe(t.mob(2).entityId);
    t.hit(t.player(), t.mob(2), 1000);
    expect(t.mob(2).deadUntil).toBeGreaterThan(0);
    t.run(1);
    expect(t.mob(1).state).toBe('chase');
    expect(t.enemy(t.mob(1))).toBe(t.mob(3).entityId);
  });

  it("an idle guard takes no creature's blow as a call to fight; a hostile struck by a guard turns on it and calls its friends", () => {
    const t = fightZone([
      guard(1, 0, -4),
      skeleton(2, 0, -10),
      skeleton(3, 3, -12),
      // On the platform (1.5 m up, over 4 ft), 24 m off, facing away: it doesn't hear the call.
      skeleton(4, 12, 11, Math.PI, 2),
    ]);
    t.hit(t.mob(2), t.mob(1), 1);
    t.run(1);
    expect(t.mob(1).state).toBe('idle');
    t.hit(t.mob(1), t.mob(2), 1);
    expect(t.mob(2).state).toBe('chase');
    expect(t.enemy(t.mob(2))).toBe(t.mob(1).entityId);
    // 0x40D360: the idle hostile near it takes the same enemy (event 0x17).
    expect(t.mob(3).state).toBe('chase');
    expect(t.enemy(t.mob(3))).toBe(t.mob(1).entityId);
    expect(t.mob(4).state).toBe('idle');
  });

  it('a hostile that takes the player calls the idle hostiles near it to him', () => {
    const t = fightZone([skeleton(2, 0, -10), skeleton(3, 3, -12)]);
    t.hit(t.player(), t.mob(2), 1);
    expect(t.enemy(t.mob(2))).toBe(t.player().entityId);
    expect(t.mob(3).state).toBe('chase');
    expect(t.enemy(t.mob(3))).toBe(t.player().entityId);
  });

  it('disposition4 (op 0x0E) makes a creature inert: it drops its fight, nobody takes it as an enemy, blows do not wake it', () => {
    const t = fightZone([guard(1, 0, -6), skeleton(2, 0, -12)], [
      [{ op: 'attackTarget', creature: 1, other: 2 }, { op: 'attackTarget', creature: 2, other: 1 }],
      [{ op: 'disposition4', creature: 1 }],
    ]);
    t.fire(0);
    expect(t.mob(2).state).toBe('chase');
    t.fire(1);
    expect(t.mob(1).disposition).toBe(4);
    expect(t.mob(1).state).toBe('idle');
    t.run(5);
    // The skeleton drops the inert guard (and the player is out of its sight).
    expect(t.mob(2).threat.has(t.mob(1).entityId)).toBe(false);
    expect(t.mob(2).state).not.toBe('chase');
    t.hit(t.player(), t.mob(1), 1);
    t.run(5);
    expect(t.mob(1).state).toBe('idle');
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { Parties } from '@crusaders/server/network/parties';
import { createSyntheticArena, initPhysics, shareKill, type KillCandidate, type Rapier } from '@crusaders/shared';

const c = (id: number, damage: number, extra: Partial<KillCandidate> = {}): KillCandidate => ({ id, damage, party: null, active: true, distance: 5, ...extra });

describe('kill shares (MMO Stage 2)', () => {
  it('alone: the whole reward, as the original', () => {
    expect(shareKill([c(1, 300)], 50)).toEqual([{ id: 1, xp: 50, gold: 1 }]);
  });

  it('two players: each his part; under 5 % nothing; idle or far away does not count', () => {
    const s = shareKill([c(1, 285), c(2, 15), c(3, 100, { active: false }), c(4, 100, { distance: 60 })], 100);
    expect(s).toEqual([{ id: 1, xp: 95, gold: 0.95 }, { id: 2, xp: 5, gold: 0.05 }]);
    expect(shareKill([c(1, 290), c(2, 10)], 100).map((x) => x.id)).toEqual([1]);
  });

  it('a party adds up, pays a bystander member in range, and gets the group bonus', () => {
    const s = shareKill([c(1, 280), c(2, 10, { party: 'p1' }), c(3, 10, { party: 'p1' }), c(5, 0, { party: 'p1', distance: 20 }), c(6, 0, { party: 'p1', distance: 35 })], 100);
    const party = s.filter((x) => x.id !== 1);
    expect(party.map((x) => x.id).sort()).toEqual([2, 3, 5]);
    // 100 × (1 + 0.1 × 2) × 20/300 = 8 shared by three.
    expect(party.every((x) => x.xp === 2)).toBe(true);
  });
});

describe('parties', () => {
  it('invite, accept, leader passes on, a lone member disbands it', () => {
    let now = 0;
    const parties = new Parties(() => now);
    expect(parties.invite('Ann', 'Bob').ok).toBe(true);
    expect(parties.accept('bob')).toMatchObject({ ok: true, party: { members: ['Ann', 'bob'] } });
    expect(parties.invite('Bob', 'Cid')).toMatchObject({ ok: false });
    parties.invite('Ann', 'Cid');
    now = 61_000;
    expect(parties.accept('Cid')).toMatchObject({ ok: false });
    expect(parties.leave('Ann').ok).toBe(true);
    expect(parties.of('Bob')).toBeNull();
  });
});

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

describe('a shared kill in the zone', () => {
  it('both hitters gain experience; the bystander gets nothing', () => {
    const arena = createSyntheticArena();
    arena.mobSpawns = [{ archetype: 'skeleton_warrior', x: 0, y: 0.5, z: -3, hp: 100 }];
    const zone = new WorldZone(rapier, 'share', arena, { send: () => {}, persist: () => {} }, { random: () => 0.5 });
    const ids = [1, 2, 3].map((c) => zone.join(c, { name: `P${c}`, characterId: null, position: { x: c, y: 0.5, z: 0 } }));
    const internal = zone as unknown as { actors: Map<number, { kind: string; hp: number; xp?: number }>; applyDamage(a: unknown, t: unknown, v: number[]): void };
    const mob = [...internal.actors.values()].find((a) => a.kind === 'mob')!;
    const [a, b, idle] = ids.map((id) => internal.actors.get(id)!);
    internal.applyDamage(a, mob, [60]);
    internal.applyDamage(b, mob, [60]);
    expect(mob.hp).toBe(0);
    expect(a!.xp).toBeGreaterThan(0);
    expect(b!.xp).toBeGreaterThan(0);
    expect(idle!.xp).toBe(0);
  });
});

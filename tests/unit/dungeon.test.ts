import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import { SC, TICK_RATE, buildLevelArena, dungeonLockFlag, emptyStoryState, initPhysics, splitInstance, type LevelPlacements, type Rapier, type ServerControlMsg } from '@crusaders/shared';

const levelsDir = path.resolve(import.meta.dirname, '../../local/generated/levels');
const have = fs.existsSync(path.join(levelsDir, 'ca1d.placements.json'));

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

describe('dungeon instances (MMO Stage 5)', () => {
  it('names an instance and its base act', () => {
    expect(splitInstance('level:ca1d@crypt-3')).toMatchObject({ base: 'level:ca1d', instance: 'crypt-3', dungeon: { id: 'crypt' } });
    expect(splitInstance('level:ca1d')).toMatchObject({ base: 'level:ca1d', instance: null, dungeon: null });
  });

  it.skipIf(!have)('the Crypt Overlord: adds, telegraphed slams, a wipe resets it, its treasure once a day', () => {
    const placements = JSON.parse(fs.readFileSync(path.join(levelsDir, 'ca1d.placements.json'), 'utf8')) as LevelPlacements;
    const arena = buildLevelArena('level:ca1d', new Uint8Array(fs.readFileSync(path.join(levelsDir, `${placements.mesh}.collision.bin`))), placements);
    const sent: ServerControlMsg[] = [];
    const zone = new WorldZone(rapier, 'level:ca1d@crypt-1', arena, { send: (_c, d) => typeof d === 'string' && sent.push(JSON.parse(d) as ServerControlMsg), persist: () => {} }, { features: { mmoDungeons: true }, random: () => 0.5 });
    zone.join(1, { name: 'Hero', characterId: 'c1', arrivingWaypoint: true, story: { ...emptyStoryState(), completedAt: 1 }, hp: 300 });
    zone.step();
    type A = { kind: string; hp: number; maxHp: number; name: string; bossOf?: string; character: { position: { x: number; y: number; z: number } } };
    const internal = zone as unknown as { actors: Map<number, A>; players: Map<number, A & { storyFlags: Set<string>; deadUntil: number }>; applyDamage(a: unknown, t: unknown, v: number[]): void; loseHp(a: unknown, t: unknown, d: number): void };
    const boss = () => [...internal.actors.values()].find((a) => a.bossOf === 'crypt')!;
    expect(boss()).toMatchObject({ name: 'Crypt Overlord', maxHp: 3000 });
    const hero = internal.players.get(1)!;
    const mobs = () => [...internal.actors.values()].filter((a) => a.kind === 'mob').length;
    const before = mobs();
    internal.loseHp(hero, boss(), 800); // 73 %: phase 2
    zone.step();
    expect(mobs()).toBe(before + 3);
    internal.loseHp(hero, boss(), 1100); // 37 %: phase 3
    // The hero stands by the boss, so the slam picks him.
    Object.assign(hero.character.position, boss().character.position);
    for (let i = 0; i < TICK_RATE * 3; i++) {
      hero.hp = 300; // the adds and the boss hit hard: keep him up through the wind-up
      zone.step();
    }
    expect(sent.some((m) => m.op === SC.TELEGRAPH)).toBe(true);
    // A wipe: the boss comes back whole.
    internal.loseHp(boss(), hero, 10_000);
    zone.step();
    expect(boss().hp).toBe(3000);
    // Back up, kill it: its treasure once.
    hero.deadUntil = 0;
    hero.hp = 300;
    internal.loseHp(hero, boss(), 3000);
    expect(hero.storyFlags.has(dungeonLockFlag('crypt'))).toBe(true);
  });
});

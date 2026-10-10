import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone, type PersistRecord } from '@crusaders/server/simulation/world_zone';
import {
  INPUT,
  INPUT_PACKET_MAX_BYTES,
  MOB_ARCHETYPES,
  PLAYER_RESPAWN_TICKS,
  SC,
  createSyntheticArena,
  encodeInput,
  inMeleeArc,
  initPhysics,
  quantizeAngle,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const SKELETON = MOB_ARCHETYPES['skeleton_warrior']!;

/** In-process zone with one player; captures JSON messages and persist requests. */
function setup(opts: { experience?: number } = {}) {
  const messages: ServerControlMsg[] = [];
  const persisted: { records: PersistRecord[]; reason: string }[] = [];
  const zone = new WorldZone(rapier, 'test', createSyntheticArena(), {
    send: (_conn, data) => {
      if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg);
    },
    persist: (records, reason) => persisted.push({ records, reason }),
  }, { random: () => 0 });
  const entityId = zone.join(1, { name: 'Tester', characterId: 'c1', position: { x: 0, y: 0.5, z: 0 }, ...opts });
  const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  let clientTick = 0;
  /** Runs `ticks` server ticks, feeding one input per tick (yaw in radians). */
  const run = (ticks: number, flags = 0, yaw = 0, each?: (i: number) => void) => {
    for (let i = 0; i < ticks; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++clientTick, flags, yaw: quantizeAngle(yaw), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      each?.(i);
      zone.step();
    }
  };
  const mob = () => zone.inspect().find((a) => a.kind === 'mob')!;
  const me = () => zone.inspect().find((a) => a.id === entityId)!;
  const events = () => messages.filter((m) => m.op === SC.COMBAT_EVENT).map((m) => m.d as Extract<ServerControlMsg, { op: typeof SC.COMBAT_EVENT }>['d']);
  const stats = () => messages.filter((m) => m.op === SC.PLAYER_STATS).map((m) => m.d as Extract<ServerControlMsg, { op: typeof SC.PLAYER_STATS }>['d']);
  return { zone, run, mob, me, events, stats, persisted, entityId };
}

describe('melee arc', () => {
  it('accepts targets in front within reach and rejects behind or out of reach', () => {
    // yaw 0 faces -Z
    expect(inMeleeArc(0, 0, 0, 0, -1.5, 2, 110)).toBe(true);
    expect(inMeleeArc(0, 0, 0, 0, 1.5, 2, 110)).toBe(false);
    expect(inMeleeArc(0, 0, 0, 0, -3, 2, 110)).toBe(false);
    expect(inMeleeArc(0, 0, 0, 1.5, -0.2, 2, 110)).toBe(false); // ~82° off-axis
    expect(inMeleeArc(0, 0, 0, 0.7, -1.2, 2, 110)).toBe(true); // ~30° off-axis
  });
});

describe('skeleton warrior AI', () => {
  it('stays idle out of aggro range, then chases a player who comes close', () => {
    const t = setup();
    t.run(20);
    expect(t.mob().state).toBe('idle');
    t.run(20, INPUT.FORWARD, 0); // run towards -Z (mob at z = -15)
    t.run(40);
    expect(t.mob().state).toBe('chase');
    const gap = Math.hypot(t.mob().x - t.me().x, t.mob().z - t.me().z);
    expect(gap).toBeLessThan(SKELETON.reach);
  });

  it('gives up beyond its leash, walks home and stays idle', () => {
    const t = setup();
    t.run(20, INPUT.FORWARD, 0); // aggro
    t.run(10);
    expect(t.mob().state).toBe('chase');
    t.run(200, INPUT.FORWARD, Math.PI); // flee to the +Z wall, ~35 m from the mob's spawn (leash 30 m)
    t.run(200);
    expect(t.mob().state).toBe('idle');
    expect(Math.hypot(t.mob().x - 0, t.mob().z + 15)).toBeLessThan(0.6);
    expect(t.mob().hp).toBe(SKELETON.maxHp);
  });
});

describe('authoritative melee', () => {
  it('kills the skeleton with a combo chain and rewards XP and gold (persisted immediately)', () => {
    const t = setup();
    t.run(20, INPUT.FORWARD, 0);
    t.run(30); // let the mob arrive in front of us
    // Swing whenever possible; requests during startup/active are ignored by the server.
    for (let i = 0; i < 200 && t.mob().alive; i++) t.run(1, 0, 0, () => t.zone.attack(1));
    expect(t.mob().alive).toBe(false);
    const hits = t.events().filter((e) => e.target === t.mob().id);
    // Axe 5/5 (tie -> bash) x Might multiplier 1.0 x attack mode 1.0 / 1.0 / 1.25 (power hit)
    expect(hits.map((e) => e.damage).slice(0, 3)).toEqual([5, 5, 6.25]);
    expect(hits.findIndex((e) => e.killed)).toBe(4); // 25 HP skeleton dies on the 5th hit
    const kill = hits.find((e) => e.killed)!;
    expect(kill.reward).toEqual({ xp: SKELETON.xpReward, gold: SKELETON.goldMin });
    t.run(1);
    expect(t.stats().at(-1)).toMatchObject({ xp: SKELETON.xpReward, gold: SKELETON.goldMin });
    expect(t.persisted.find((p) => p.reason === 'progress')?.records[0]).toMatchObject({ experience: 25, gold: 5 });
  });

  it('ignores attack spam: at most one hit per swing lifecycle', () => {
    const t = setup();
    t.run(20, INPUT.FORWARD, 0);
    t.run(30);
    const before = t.events().filter((e) => e.target === t.mob().id).length;
    t.run(40, 0, 0, () => {
      for (let k = 0; k < 10; k++) t.zone.attack(1);
    });
    const hits = t.events().filter((e) => e.target === t.mob().id).length - before;
    // swing at weapon speed 1.1 = 3 + 3 + 5 ticks => at most ceil(40 / 11) hits
    expect(hits).toBeLessThanOrEqual(4);
    expect(hits).toBeGreaterThan(0);
  });

  it('lets the skeleton kill an idle player, who respawns with full health', () => {
    const t = setup();
    t.run(20, INPUT.FORWARD, 0);
    let deadAt = -1;
    for (let i = 0; i < 1500 && deadAt < 0; i++) {
      t.run(1);
      if (!t.me().alive) deadAt = i;
    }
    expect(deadAt).toBeGreaterThan(0);
    // Medium difficulty: slash resist 0.9
    expect(t.events().every((e) => e.target !== t.entityId || (e.damage >= SKELETON.damageMin * 0.9 - 1e-9 && e.damage <= SKELETON.damageMax * 0.9 + 1e-9))).toBe(true);
    t.run(PLAYER_RESPAWN_TICKS + 1);
    expect(t.me()).toMatchObject({ alive: true, hp: 65 }); // 50 + 0.6 x Endurance 25 x level 1
  });

  it('levels up after enough kills (max HP grows and heals)', () => {
    const t = setup({ experience: 90 });
    t.run(20, INPUT.FORWARD, 0);
    t.run(30);
    for (let i = 0; i < 200 && t.mob().alive; i++) t.run(1, 0, 0, () => t.zone.attack(1));
    t.run(1);
    expect(t.stats().at(-1)).toMatchObject({ level: 2, maxHp: 80, hp: 80, xp: 115 }); // 50 + 0.6 x 25 x 2
  });
});

describe('difficulty and flinch (original rules)', () => {
  it('uses the difficulty columns for player HP and incoming damage', () => {
    const easy = new WorldZone(rapier, 'easy', createSyntheticArena(), { send: () => {} }, { random: () => 0, difficulty: 'easy' });
    easy.join(1, { name: 'E', characterId: null, position: { x: 0, y: 0.5, z: 0 } });
    // Easy endurance 30: 50 + 0.6 x 30 = 68
    expect(easy.inspect().find((a) => a.kind === 'player')!.hp).toBe(68);
  });

  it('interrupts the player with a flinch when a hit takes a large share of remaining HP', () => {
    const t = setup();
    t.run(20, INPUT.FORWARD, 0);
    // Wait until the skeleton has brought us low enough that 7.2 damage >= 0.7 x HP before the hit.
    let flinched = false;
    for (let i = 0; i < 1500 && t.me().alive && !flinched; i++) {
      t.run(1);
      flinched = t.zone.inspect().length > 0 && (t.zone as unknown as { players: Map<number, { hitUntil: number }> }).players.get(1)!.hitUntil > t.zone.tick;
    }
    expect(flinched).toBe(true);
  });
});

describe('shield block (original rule)', () => {
  it('stops every frontal hit while the shield is raised towards the attacker', () => {
    const t = setup();
    t.run(20, INPUT.FORWARD, 0); // aggro; we face -Z, the skeleton comes from -Z
    t.run(300, INPUT.BLOCK, 0);
    const onMe = t.events().filter((e) => e.target === t.entityId);
    expect(onMe.length).toBeGreaterThan(3);
    expect(onMe.every((e) => e.blocked === true && e.damage === 0)).toBe(true);
    expect(t.me().hp).toBe(65);
  });

  it('does not protect against hits from behind', () => {
    const t = setup();
    t.run(20, INPUT.FORWARD, 0);
    t.run(300, INPUT.BLOCK, Math.PI); // shield raised but facing away from the skeleton
    const onMe = t.events().filter((e) => e.target === t.entityId);
    expect(onMe.length).toBeGreaterThan(0);
    expect(onMe.some((e) => !e.blocked && e.damage > 0)).toBe(true);
  });

  it('cannot block while swinging', () => {
    const t = setup();
    t.run(20, INPUT.FORWARD, 0);
    t.run(300, INPUT.BLOCK, 0, () => t.zone.attack(1));
    expect(t.events().some((e) => e.target === t.entityId && !e.blocked)).toBe(true);
  });
});

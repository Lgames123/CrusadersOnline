import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone, type PersistRecord } from '@crusaders/server/simulation/world_zone';
import {
  ANIM,
  SIDE_SWING_RECHAIN_TICKS,
  LAYERED_SWING_SECONDS,
  type GameplayFeatures,
  THRUST_WALL_DISTANCE,
  THRUST_WALL_HEIGHT,
  attackKindFor,
  createMovementWorld,
  wallAhead,
  COMBO_MULTIPLIERS,
  MOB_ENGAGE,
  MOB_SHIELD_TICKS,
  MOB_SPECIAL_ROLL,
  chooseMobSequence,
  attackSweep,
  hitShove,
  chooseMobSpecial,
  mobBand,
  PLAYER_RADIUS,
  PLAYER_REACH,
  DEFAULT_MOVEMENT_STATS,
  ORIGINAL_CLIP_FPS,
  attackTiming,
  INPUT,
  TICK_RATE,
  INPUT_PACKET_MAX_BYTES,
  MOB_ARCHETYPES,
  PLAYER_RESPAWN_TICKS,
  SC,
  BUILTIN_ITEMS,
  addItem,
  createSyntheticArena,
  encodeInput,
  equipmentOf,
  levelForXp,
  sanitizeInventory,
  setEquipped,
  startingInventory,
  xpForLevel,
  inMeleeArc,
  initPhysics,
  quantizeAngle,
  type InventoryEntry,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const SKELETON = MOB_ARCHETYPES['skeleton_warrior']!;

/** Deterministic pseudo-random source in [0, 1) (a small LCG). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** In-process zone with one player; captures JSON messages and persist requests. */
function setup(opts: { experience?: number; inventory?: InventoryEntry[]; random?: () => number; reactiveBlock?: boolean; features?: Partial<GameplayFeatures> } = {}) {
  const messages: ServerControlMsg[] = [];
  const persisted: { records: PersistRecord[]; reason: string }[] = [];
  const zone = new WorldZone(rapier, 'test', createSyntheticArena(), {
    send: (_conn, data) => {
      if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg);
    },
    persist: (records, reason) => persisted.push({ records, reason }),
  }, { random: opts.random ?? (() => 0), reactiveBlock: opts.reactiveBlock, features: opts.features });
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
  const inventories = () => messages.filter((m) => m.op === SC.INVENTORY_UPDATE).map((m) => m.d as Extract<ServerControlMsg, { op: typeof SC.INVENTORY_UPDATE }>['d']);
  return { zone, run, mob, me, events, stats, inventories, persisted, entityId, messages };
}

/**
 * Ticks of running that cover 9.5 m: the skeleton (15 m away, facing away) notices a player
 * behind it within 20 ft.
 */
const APPROACH = Math.ceil((9.5 / DEFAULT_MOVEMENT_STATS.runSpeed) * TICK_RATE);

describe('original swing timing', () => {
  it('hits on each clip IMPACT frame at 1000/30 fps and chains five plain swings', () => {
    // First combo step PN25: SWING 11, IMPACT 13, RECOVERY 18 -> active window ends on tick
    // round(13 / 33.3 × 20) = 8 (damage was captured on frame ~13.6 in the original).
    const first = attackTiming('normal', 1);
    expect(first.startup + first.active - 1).toBe(Math.round((13 / ORIGINAL_CLIP_FPS) * TICK_RATE));
    expect(COMBO_MULTIPLIERS).toHaveLength(5);
    // Heavier steps take longer (PN17 power attack recovers at frame 23).
    const last = attackTiming('normal', 5);
    expect(last.startup + last.active + last.recovery).toBeGreaterThan(first.startup + first.active + first.recovery);
    // A faster weapon shortens the swing.
    const fast = attackTiming('normal', 1, 2);
    expect(fast.startup + fast.active + fast.recovery).toBeLessThan(first.startup + first.active + first.recovery);
  });
});

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
    t.run(APPROACH, INPUT.FORWARD, 0); // run towards -Z (mob at z = -15)
    t.run(40);
    expect(t.mob().state).toBe('chase');
    // Closed in: within its engage distance, or already in reach.
    const gap = Math.hypot(t.mob().x - t.me().x, t.mob().z - t.me().z);
    expect(gap).toBeLessThan(MOB_ENGAGE + 0.5);
  });

  it('gives up beyond its leash, walks home and stays idle', () => {
    const t = setup();
    t.run(APPROACH, INPUT.FORWARD, 0); // aggro
    t.run(10);
    expect(t.mob().state).toBe('chase');
    t.run(200, INPUT.FORWARD, Math.PI); // flee to the +Z wall, ~35 m from the mob's spawn (leash 30 m)
    // Cornered at the wall the player falls to the skeleton's jabs; with no target left it walks home.
    t.run(300);
    expect(t.mob().state).toBe('idle');
    expect(Math.hypot(t.mob().x - 0, t.mob().z + 15)).toBeLessThan(0.6);
    expect(t.mob().hp).toBe(SKELETON.maxHp);
  });
});

describe('authoritative melee', () => {
  it('kills the skeleton with a combo chain and rewards XP and gold (persisted immediately)', () => {
    const t = setup({ inventory: [{ slot: 0, itemId: 'axe', equipped: true }, { slot: 1, itemId: 'wooden_shield', equipped: true }] });
    t.run(APPROACH, INPUT.FORWARD, 0);
    t.run(30); // let the mob arrive in front of us
    // Swing whenever possible; requests during startup/active are ignored by the server.
    for (let i = 0; i < 200 && t.mob().alive; i++) t.run(1, 0, 0, () => t.zone.attack(1));
    expect(t.mob().alive).toBe(false);
    // Hits the skeleton's guard stopped (frontal, between its attack chains) deal nothing.
    const hits = t.events().filter((e) => e.target === t.mob().id && !e.blocked);
    // Axe 5/5 (tie -> bash) x Might multiplier 1.0 x attack mode 1.0 (every combo step)
    // x the skeleton's original bash multiplier 1.1
    expect(hits.map((e) => e.damage).slice(0, 3)).toEqual([5.5, 5.5, 5.5]);
    expect(hits.findIndex((e) => e.killed)).toBe(4); // 25 HP skeleton dies on the 5th hit
    const kill = hits.find((e) => e.killed)!;
    // random() = 0 makes every loot roll succeed.
    expect(kill.reward).toEqual({ xp: SKELETON.xpReward, gold: SKELETON.goldMin, loot: ['Long Sword', 'Scale Armor'] });
    t.run(1);
    expect(t.stats().at(-1)).toMatchObject({ xp: SKELETON.xpReward, gold: SKELETON.goldMin });
    const saved = t.persisted.find((p) => p.reason === 'progress')?.records[0];
    expect(saved).toMatchObject({ experience: 40, gold: 5 });
    expect(saved?.inventory?.map((e) => e.itemId)).toEqual(['axe', 'wooden_shield', 'long_sword', 'scale_armor']);
    expect(t.inventories().at(-1)?.items.map((i) => [i.name, i.equipped])).toEqual([
      ['Axe', true], ['Wooden Shield', true], ['Long Sword', false], ['Scale Armor', false],
    ]);
  });

  it('ignores attack spam: at most one hit per swing lifecycle', () => {
    const t = setup();
    t.run(APPROACH, INPUT.FORWARD, 0);
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
    t.run(APPROACH, INPUT.FORWARD, 0);
    let deadAt = -1;
    for (let i = 0; i < 1500 && deadAt < 0; i++) {
      t.run(1);
      if (!t.me().alive) deadAt = i;
    }
    expect(deadAt).toBeGreaterThan(0);
    // Long Sword 10 slash, whole vector (creatures skip the Might rule) x medium slash resist 0.9
    expect(t.events().filter((e) => e.target === t.entityId).every((e) => e.damage === 9)).toBe(true);
    t.run(PLAYER_RESPAWN_TICKS + 1);
    expect(t.me()).toMatchObject({ alive: true, hp: 65 }); // 50 + 0.6 x Endurance 25 x level 1
  });

  it('levels up at the original threshold; the max-HP gain is added to current HP', () => {
    const t = setup({ experience: 470 });
    t.run(APPROACH, INPUT.FORWARD, 0);
    t.run(30);
    for (let i = 0; i < 200 && t.mob().alive; i++) t.run(1, 0, 0, () => t.zone.attack(1));
    t.run(1);
    const s = t.stats();
    const up = s.findIndex((x) => x.level === 2);
    expect(s[up]).toMatchObject({ level: 2, maxHp: 80, xp: 510 }); // 50 + 0.6 x 25 x 2
    expect(s[up]!.hp).toBe(Math.min(80, s[up - 1]!.hp + 15));
  });
});

describe('directional attacks (original controls)', () => {
  it('plays side swings on the upper body (legs keep moving), whole, dropping clicks until the layer frees', () => {
    const t = setup();
    t.run(5); // away from the skeleton: a hit would interrupt the swing
    t.zone.attack(1, 'left');
    t.run(1, INPUT.LEFT, 0);
    // Replicated as the legs' clip (side-stepping) plus the upper-body swing in the entity flags.
    expect(t.me().anim).toBe(ANIM.STRAFE_LEFT);
    expect((t.me().flags >> 1) & 3).toBe(1);
    const total = Math.round(LAYERED_SWING_SECONDS * 20);
    expect(total).toBe(17); // ~0.83 s: the whole PN02 clip and the layer's fade
    // Clicks during the swing are dropped, not queued.
    for (let i = 0; i < total - 3; i++) {
      if (i % 2 === 0) t.zone.attack(1, 'right');
      t.run(1);
    }
    t.run(4);
    expect((t.me().flags >> 1) & 3).toBe(0);
    t.zone.attack(1, 'right'); // a click after the layer freed starts the next side swing
    t.run(1);
    expect((t.me().flags >> 1) & 3).toBe(2);
    t.run(40);
    t.zone.attack(1); // a plain click right after starts the combo at hit 1
    t.run(1);
    expect(t.me().anim).toBe(ANIM.ATTACK);
  });

  it('feature sideSwingRetrigger (not original): a side swing re-triggers 0.3 s in, alternating sides', () => {
    const t = setup({ features: { sideSwingRetrigger: true } });
    t.run(5);
    t.zone.attack(1, 'left');
    t.run(1, INPUT.LEFT, 0);
    expect((t.me().flags >> 1) & 3).toBe(1);
    const parity = (t.me().flags >> 3) & 1;
    t.run(SIDE_SWING_RECHAIN_TICKS);
    t.zone.attack(1, 'right');
    t.run(1);
    expect((t.me().flags >> 1) & 3).toBe(2);
    expect((t.me().flags >> 3) & 1).not.toBe(parity);
  });

  it('tells the client which non-original features are on (none by default)', () => {
    const plain = setup();
    const enter = plain.messages.find((m) => m.op === SC.WORLD_ENTER);
    expect(enter && 'features' in enter.d).toBe(false);
    const on = setup({ features: { sideSwingRetrigger: true } });
    const msg = on.messages.find((m) => m.op === SC.WORLD_ENTER);
    expect(msg?.op === SC.WORLD_ENTER && msg.d.features).toEqual({ sideSwingRetrigger: true });
  });
});

describe('shield rush (original controls)', () => {
  it('a rush that meets the skeleton reels it back and knocks it down, unharmed; Drake loses HP on contact', () => {
    const t = setup();
    t.run(APPROACH, INPUT.FORWARD, 0);
    // Wait until the skeleton stands within reach of the charge, then rush (shield + jump).
    for (let i = 0; i < 200 && Math.hypot(t.mob().x - t.me().x, t.mob().z - t.me().z) > 1.6; i++) t.run(1);
    const hp = t.mob().hp;
    const myHp = t.me().hp;
    const anims: number[] = [];
    for (let i = 0; i < 30; i++) {
      t.run(1, i === 0 ? INPUT.BLOCK | INPUT.JUMP : INPUT.BLOCK, 0);
      anims.push(t.mob().anim);
    }
    const reel = anims.indexOf(ANIM.HIT);
    expect(reel).toBeGreaterThanOrEqual(0);
    expect(anims.indexOf(ANIM.KNOCKDOWN)).toBeGreaterThan(reel);
    expect(t.mob().hp).toBe(hp);
    expect(t.me().hp).toBeLessThan(myHp);
  });
});

describe('air swing and wall jab (original controls)', () => {
  it('a click in the air is the upper-body level swing; a plain click facing a wall within 5 ft is the jab', () => {
    expect(attackKindFor(INPUT.FORWARD, false)).toBe('air');
    expect(attackKindFor(INPUT.FORWARD, true)).toBe('jump');
    const mw = createMovementWorld(rapier, createSyntheticArena());
    // Walk towards the synthetic arena's +Z wall until it is within 5 ft ahead.
    let z = 0;
    for (; z < 30 && !wallAhead(mw, { x: 0, y: 0.5, z }, Math.PI, THRUST_WALL_DISTANCE, THRUST_WALL_HEIGHT); z += 0.1);
    expect(z).toBeGreaterThan(10);
    expect(z).toBeLessThan(30);
    expect(wallAhead(mw, { x: 0, y: 0.5, z }, 0, THRUST_WALL_DISTANCE, THRUST_WALL_HEIGHT)).toBe(false); // facing away
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
    t.run(APPROACH, INPUT.FORWARD, 0);
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
    t.run(APPROACH, INPUT.FORWARD, 0); // aggro; we face -Z, the skeleton comes from -Z
    t.run(300, INPUT.BLOCK, 0);
    const onMe = t.events().filter((e) => e.target === t.entityId);
    expect(onMe.length).toBeGreaterThan(3);
    expect(onMe.every((e) => e.blocked === true && e.damage === 0)).toBe(true);
    expect(t.me().hp).toBe(65);
  });

  it('does not protect against hits from behind', () => {
    const t = setup();
    t.run(APPROACH, INPUT.FORWARD, 0);
    t.run(300, INPUT.BLOCK, Math.PI); // shield raised but facing away from the skeleton
    const onMe = t.events().filter((e) => e.target === t.entityId);
    expect(onMe.length).toBeGreaterThan(0);
    expect(onMe.some((e) => !e.blocked && e.damage > 0)).toBe(true);
  });

  it('cannot block while swinging', () => {
    const t = setup();
    t.run(APPROACH, INPUT.FORWARD, 0);
    // Swinging every 2 s (back-to-back swings would keep the skeleton in its hit reactions).
    t.run(600, INPUT.BLOCK, 0, (i) => i % 40 === 0 && t.zone.attack(1));
    expect(t.events().some((e) => e.target === t.entityId && !e.blocked)).toBe(true);
  });
});

describe('experience curve (original)', () => {
  it('uses the engine thresholds 500, 1500, 3500, 6500, 10500, then +4000', () => {
    expect([2, 3, 4, 5, 6, 7, 8].map(xpForLevel)).toEqual([500, 1500, 3500, 6500, 10500, 14500, 18500]);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(499)).toBe(1);
    expect(levelForXp(500)).toBe(2);
    expect(levelForXp(14_500)).toBe(7);
  });
});

describe('inventory and equipment', () => {
  it('equips one item per equipment slot and keeps the bag consistent', () => {
    const inv = startingInventory();
    expect(addItem(inv, 'axe')).toBe(2);
    expect(setEquipped(inv, 2, true, BUILTIN_ITEMS)).toBe(true);
    expect(inv.filter((e) => e.equipped).map((e) => e.itemId)).toEqual(['wooden_shield', 'axe']);
    expect(equipmentOf(inv, BUILTIN_ITEMS).weapon.name).toBe('Axe');
    expect(setEquipped(inv, 2, true, BUILTIN_ITEMS)).toBe(false); // no-op
    expect(setEquipped(inv, 9, true, BUILTIN_ITEMS)).toBe(false); // empty slot
    const full: InventoryEntry[] = Array.from({ length: 48 }, (_, slot) => ({ slot, itemId: 'axe', equipped: false }));
    expect(addItem(full, 'mace')).toBeNull();
  });

  it('drops unknown items, bad slots and duplicate equipped items from saved data', () => {
    const clean = sanitizeInventory([
      { slot: 0, itemId: 'axe', equipped: true },
      { slot: 1, itemId: 'mace', equipped: true },
      { slot: 1, itemId: 'long_sword', equipped: false },
      { slot: 2, itemId: 'excalibur', equipped: true },
      { slot: 99, itemId: 'mace', equipped: false },
    ], BUILTIN_ITEMS);
    expect(clean).toEqual([
      { slot: 0, itemId: 'axe', equipped: true },
      { slot: 1, itemId: 'mace', equipped: false },
    ]);
  });

  it('applies the equipped weapon and armour to combat', () => {
    const t = setup({
      inventory: [
        { slot: 0, itemId: 'axe', equipped: true },
        { slot: 1, itemId: 'wooden_shield', equipped: true },
        { slot: 2, itemId: 'long_sword', equipped: false },
        { slot: 3, itemId: 'scale_armor', equipped: false },
      ],
      random: lcg(3),
    });
    t.zone.equip(1, 2, true);
    t.zone.equip(1, 3, true);
    expect(t.inventories().at(-1)!.weaponSpeed).toBe(1);
    t.run(APPROACH, INPUT.FORWARD, 0);
    t.run(30);
    // Let the skeleton land a hit first, then click every 0.5 s (landed hits interrupt it).
    for (let i = 0; i < 200 && !t.events().some((e) => e.target === t.entityId && !e.blocked); i++) t.run(1);
    for (let i = 0; i < 600 && t.mob().alive; i++) t.run(1, 0, 0, () => i % 10 === 0 && t.zone.attack(1));
    const dealt = t.events().filter((e) => e.target === t.mob().id && !e.blocked).map((e) => e.damage);
    expect(dealt.slice(0, 2)).toEqual([9, 9]); // Long Sword 10 slash x skeleton slash 0.9
    const taken = t.events().filter((e) => e.target === t.entityId && !e.blocked).map((e) => e.damage);
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.every((d) => d === 8.1)).toBe(true); // 10 x resist 0.9 x Scale Armor 0.9
  });

  it('defers equipment changes requested during a swing to the end of the swing', () => {
    const t = setup({ inventory: [{ slot: 0, itemId: 'axe', equipped: true }, { slot: 1, itemId: 'mace', equipped: false }] });
    t.run(1);
    t.zone.attack(1);
    t.run(1);
    const before = t.inventories().length;
    t.zone.equip(1, 1, true);
    expect(t.inventories().length).toBe(before); // not yet
    t.run(20);
    expect(t.inventories().at(-1)!.items.find((i) => i.slot === 1)!.equipped).toBe(true);
  });

  it('gives new characters the starting kit', () => {
    const t = setup();
    expect(t.inventories()[0]!.items.map((i) => [i.itemId, i.equipped])).toEqual([['long_sword', true], ['wooden_shield', true]]);
  });
});

describe('skeleton melee brain (decompiled, 0x00409520)', () => {
  it('walks in with its shield up, then hops in swinging on the upper body from 20 % of the hop', () => {
    const t = setup();
    t.run(APPROACH, INPUT.FORWARD, 0);
    const samples: { anim: number; flags: number; swinging: boolean; shield: boolean; gap: number }[] = [];
    for (let i = 0; i < 80; i++) {
      t.run(1);
      samples.push({ ...t.mob(), gap: Math.hypot(t.mob().x - t.me().x, t.mob().z - t.me().z) });
    }
    // Within 12 ft it walks in shield raised (the player stands, facing it).
    expect(samples.some((s) => s.anim === ANIM.WALK && s.shield && s.gap < 12 * 0.3048)).toBe(true);
    const hop = samples.findIndex((s) => s.anim === ANIM.HOP_FORWARD);
    expect(hop).toBeGreaterThanOrEqual(0);
    // During the hop: the hop clip on the legs, a swing on the upper body (entity flags bits 1-2).
    const during = samples.slice(hop).filter((s) => s.anim === ANIM.HOP_FORWARD);
    expect(during.some((s) => s.swinging && ((s.flags >> 1) & 3) !== 0)).toBe(true);
    expect(during[0]!.swinging).toBe(false);
  });

  it('attacks again at once after its pause when the player within 8 ft neither swings nor blocks', () => {
    const t = setup();
    t.run(APPROACH, INPUT.FORWARD, 0);
    const starts: number[] = [];
    let was = false;
    for (let i = 0; i < 200 && t.me().alive; i++) {
      t.run(1);
      const sw = t.mob().swinging;
      if (sw && !was) starts.push(i);
      was = sw;
    }
    // The jab (500 ms pause after it) every ~1.2 s: no guard in between.
    const gaps = starts.slice(2).map((s, k) => s - starts[k + 1]!);
    expect(gaps.length).toBeGreaterThan(2);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(26);
  });

  it('guards after an attack against a player holding a shield; a stopped blow sends it back in', () => {
    const t = setup({ random: lcg(7) });
    t.run(APPROACH, INPUT.FORWARD, 0);
    // Holding the shield up (frontal hits are stopped) until the skeleton guards after an attack.
    let guarding = false;
    for (let i = 0; i < 400 && !guarding && t.me().alive; i++) {
      t.run(1, INPUT.BLOCK, 0);
      guarding = t.mob().brain === 'post' && t.mob().shield;
    }
    expect(guarding).toBe(true);
    t.zone.attack(1);
    let blocked = false;
    for (let i = 0; i < 12 && !blocked; i++) {
      t.run(1);
      blocked = t.events().some((e) => e.target === t.mob().id && e.blocked);
    }
    expect(blocked).toBe(true);
    // The stopped blow ends the guard: the counter-attack follows within the shield clip.
    let swung = false;
    for (let i = 0; i < MOB_SHIELD_TICKS && !swung; i++) {
      t.run(1);
      swung = t.mob().swinging;
    }
    expect(swung).toBe(true);
  });

  it('chooses its sequences as the original (0x004083F0) and its specials against a raised shield (0x004087A0)', () => {
    const ft = 0.3048;
    // Beyond 7 ft: the hop, its swing on the upper body, the rest standing; pauses 500 / 700 / 900 ms.
    expect(chooseMobSequence(7.5 * ft, 0)).toMatchObject({ hop: true, upper: { kind: 'overhead' }, main: [], pauseMs: 500 });
    expect(chooseMobSequence(7.5 * ft, 3 / 12)).toMatchObject({ hop: true, upper: { kind: 'normal' }, main: [{ kind: 'overhead' }], pauseMs: 700 });
    expect(chooseMobSequence(7.5 * ft, 0.99)).toMatchObject({ hop: true, upper: { kind: 'overhead' }, main: [{ kind: 'low' }, { kind: 'normal' }], pauseMs: 900 });
    // Under 5 ft the jab; 5-7 ft swings where it stands.
    expect(chooseMobSequence(4 * ft, 0.5)).toMatchObject({ hop: false, main: [{ kind: 'thrust' }], pauseMs: 500 });
    expect(chooseMobSequence(6 * ft, 8 / 12)).toMatchObject({ hop: false, upper: null, main: [{ kind: 'low' }, { kind: 'normal' }, { kind: 'overhead' }] });
    expect(chooseMobSpecial(true, 0)).toMatchObject({ main: [{ kind: 'bash' }, { kind: 'thrust' }] });
    expect(chooseMobSpecial(true, 0.7)).toMatchObject({ main: [{ kind: 'jump' }] });
    expect(chooseMobSpecial(false, 0)).toMatchObject({ main: [{ kind: 'jump' }] });
    expect(MOB_SPECIAL_ROLL).toBe(0.8);
    expect([7.9, 8.1, 12.5, 21].map((f) => mobBand(f * ft))).toEqual([0, 1, 2, 3]);
  });

  it('notices a player 100 ft ahead within 60 degrees, otherwise only within 20 ft', () => {
    const t = setup();
    // The skeleton (z = -15) faces -Z, away from the player at z = 0: 49 ft behind it.
    t.run(20);
    expect(t.mob().state).toBe('idle');
    t.run(Math.ceil((7 / DEFAULT_MOVEMENT_STATS.runSpeed) * TICK_RATE), INPUT.FORWARD, 0); // 26 ft behind
    t.run(5);
    expect(t.mob().state).toBe('idle');
    t.run(Math.ceil((2.5 / DEFAULT_MOVEMENT_STATS.runSpeed) * TICK_RATE), INPUT.FORWARD, 0); // under 20 ft
    t.run(2);
    expect(t.mob().state).toBe('chase');
  });
});

describe('character spacing', () => {
  it('never lets a creature walk through the player', () => {
    const t = setup();
    t.run(APPROACH, INPUT.FORWARD, 0);
    let closest = Infinity;
    for (let i = 0; i < 300 && t.me().alive; i++) {
      t.run(1);
      closest = Math.min(closest, Math.hypot(t.mob().x - t.me().x, t.mob().z - t.me().z));
    }
    expect(closest).toBeGreaterThan(2 * PLAYER_RADIUS - 0.05);
  });
});

describe('hit reactions (original rules)', () => {
  it('a landed hit puts the player in an impact and stops the creature for its impact', () => {
    const t = setup({ random: lcg(5) });
    t.run(APPROACH, INPUT.FORWARD, 0);
    let hitMe = false;
    for (let i = 0; i < 400 && !hitMe; i++) {
      const n = t.events().length;
      t.run(1);
      hitMe = t.events().slice(n).some((e) => e.target === t.entityId && e.damage > 0 && !e.killed);
    }
    expect(hitMe).toBe(true);
    t.run(1); // the player's state is replicated from its next step
    expect(t.me().anim).toBe(ANIM.HIT);
    // A landed hit on the skeleton stops whatever it was doing (swing, hop) for its impact.
    let hitMob = false;
    for (let i = 0; i < 600 && !hitMob && t.mob().alive; i++) {
      const n = t.events().length;
      t.run(1, 0, 0, () => i % 7 === 0 && t.zone.attack(1));
      hitMob = t.events().slice(n).some((e) => e.target === t.mob().id && e.damage > 0 && !e.killed);
    }
    expect(hitMob).toBe(true);
    t.run(1); // replicated from the creature's next update
    expect(t.mob().swinging).toBe(false);
    expect(t.mob().anim).toBe(ANIM.HIT);
  });
});

describe('the shove of a blow (0x0044D290, one frame of impulse)', () => {
  it('turns the impulse into a shove of under a foot, a stopped blow included', () => {
    const ft = 0.3048;
    const level = attackSweep('normal', 2)!;
    expect(hitShove(Math.hypot(...level), false) / ft).toBeCloseTo(0.68, 1);
    expect(hitShove(Math.hypot(...level), true) / ft).toBeCloseTo(0.84, 1);
    expect(attackSweep('bash', 1)).toBeNull();
  });

  it('moves a creature along the blade sweep when the blow lands', () => {
    const t = setup({ inventory: [{ slot: 0, itemId: 'axe', equipped: true }, { slot: 1, itemId: 'wooden_shield', equipped: true }] });
    t.run(APPROACH, INPUT.FORWARD, 0);
    const shoves: number[] = [];
    for (let i = 0; i < 600 && shoves.length < 3 && t.mob().alive; i++) {
      const before = t.mob();
      const n = t.events().length;
      t.run(1, 0, 0, () => i % 7 === 0 && t.zone.attack(1));
      const hit = t.events().slice(n).some((e) => e.target === before.id && e.damage > 0 && !e.killed);
      // Ticks where the skeleton stood in its pause (no movement of its own) when the blow landed.
      if (hit && before.brain === 'pause') shoves.push(Math.hypot(t.mob().x - before.x, t.mob().z - before.z));
    }
    expect(shoves.length).toBeGreaterThan(0);
    for (const d of shoves) {
      expect(d).toBeGreaterThan(0.15);
      expect(d).toBeLessThan(0.4);
    }
  });
});

describe('skeleton shield AI', () => {
  it('does not raise its shield in reaction to a swing (the original only guards after its own attack)', () => {
    const t = setup({ random: () => 0.68 });
    t.run(APPROACH, INPUT.FORWARD, 0);
    t.run(30);
    const gap = () => Math.hypot(t.mob().x - t.me().x, t.mob().z - t.me().z);
    for (let i = 0; i < 80 && (t.mob().swinging || gap() > PLAYER_REACH + 0.3); i++) t.run(1);
    const before = t.mob().anim;
    t.zone.attack(1);
    t.run(1);
    expect(t.mob().anim === ANIM.BLOCK && before !== ANIM.BLOCK).toBe(false);
  });

  it('optional reactive block: raises the shield against a frontal swing, then lowers it', () => {
    // 0.68 passes the 35% block roll.
    const t = setup({ random: () => 0.68, reactiveBlock: true });
    t.run(APPROACH, INPUT.FORWARD, 0);
    t.run(30);
    const gap = () => Math.hypot(t.mob().x - t.me().x, t.mob().z - t.me().z);
    for (let i = 0; i < 80 && (t.mob().swinging || t.me().anim === ANIM.HIT || gap() > PLAYER_REACH + 0.3); i++) t.run(1);
    t.zone.attack(1);
    t.run(12);
    const first = t.events().filter((e) => e.target === t.mob().id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ blocked: true, damage: 0 });
    const anims: number[] = [];
    for (let i = 0; i < 60; i++) {
      t.run(1);
      anims.push(t.mob().anim);
    }
    expect(anims.some((a) => a !== ANIM.BLOCK)).toBe(true);
  });
});

describe('world objects (original level placements)', () => {
  /** Synthetic arena plus objects near the spawn (0, 0.5, 0); the skeleton is far away (z = -15). */
  function objectZone() {
    const arena = createSyntheticArena();
    arena.objects = [
      { id: 0, kind: 'item', x: 1, y: 0.5, z: 0, item: { name: 'Gold Pieces', quantity: 30 } },
      { id: 1, kind: 'item', x: -1, y: 0.5, z: 0, item: { name: 'Healing Potion', quantity: 1 } },
      { id: 2, kind: 'item', x: 0, y: 0.5, z: 1, item: { name: 'Healing Potion', quantity: 1 } },
      { id: 3, kind: 'chest', x: 0, y: 0.5, z: 2, contents: [{ name: 'Long Sword', quantity: 1 }, { name: 'Gold Pieces', quantity: 12 }] },
      { id: 4, kind: 'breakable', x: 0, y: 0.5, z: -1.5, hp: 8 },
      { id: 5, kind: 'item', x: 10, y: 0.5, z: 10, item: { name: 'Gold Pieces', quantity: 5 } },
    ];
    const messages: ServerControlMsg[] = [];
    const zone = new WorldZone(rapier, 'objects', arena, {
      send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
    }, { random: () => 0 });
    zone.join(1, { name: 'Looter', characterId: null, position: { x: 0, y: 0.5, z: 0 }, inventory: [{ slot: 0, itemId: 'axe', equipped: true }, { slot: 1, itemId: 'wooden_shield', equipped: true }] });
    const last = <T extends ServerControlMsg['op']>(op: T) => messages.filter((m) => m.op === op).at(-1) as Extract<ServerControlMsg, { op: T }> | undefined;
    return { zone, messages, last };
  }

  it('picks up gold and stacks potions within reach, refuses far objects', () => {
    const t = objectZone();
    t.zone.step();
    t.zone.interact(1, 5); // 14 m away
    expect(t.last(SC.OBJECT_STATE)?.d.full).toBe(true);
    t.zone.interact(1, 0);
    t.zone.interact(1, 1);
    t.zone.interact(1, 2);
    t.zone.step();
    expect(t.last(SC.PLAYER_STATS)!.d.gold).toBe(30);
    const potion = t.last(SC.INVENTORY_UPDATE)!.d.items.find((i) => i.itemId === 'healing_potion')!;
    expect(potion).toMatchObject({ quantity: 2, heal: 10 });
    const changes = t.messages.filter((m) => m.op === SC.OBJECT_STATE && !m.d.full).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects);
    expect(changes.map((c) => [c.id, c.state])).toEqual([[0, 'gone'], [1, 'gone'], [2, 'gone']]);
    t.zone.interact(1, 0); // already taken
    expect(t.messages.filter((m) => m.op === SC.OBJECT_STATE).length).toBe(4);
  });

  it('opens a chest once and grants its contents', () => {
    const t = objectZone();
    t.zone.interact(1, 3);
    t.zone.step();
    expect(t.last(SC.OBJECT_STATE)!.d.objects[0]).toMatchObject({ id: 3, state: 'open', loot: ['Long Sword', '12 Gold Pieces'] });
    expect(t.last(SC.PLAYER_STATS)!.d.gold).toBe(12);
    expect(t.last(SC.INVENTORY_UPDATE)!.d.items.some((i) => i.itemId === 'long_sword')).toBe(true);
  });

  it('drinks a potion to heal, capped at max HP', () => {
    const t = objectZone();
    t.zone.interact(1, 1);
    const slot = t.last(SC.INVENTORY_UPDATE)!.d.items.find((i) => i.itemId === 'healing_potion')!.slot;
    (t.zone as unknown as { players: Map<number, { hp: number }> }).players.get(1)!.hp = 50;
    t.zone.useItem(1, slot);
    t.zone.step();
    expect(t.last(SC.PLAYER_STATS)!.d.hp).toBe(60);
    expect(t.last(SC.INVENTORY_UPDATE)!.d.items.some((i) => i.itemId === 'healing_potion')).toBe(false);
  });

  it('breaks a prop with melee swings and brings it back later', () => {
    const t = objectZone();
    // Face -Z (yaw 0): the breakable is 1.5 m ahead. Axe hits 5 bash -> two swings for 8 HP.
    const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
    let tick = 0;
    const run = (n: number, attack = false) => {
      for (let i = 0; i < n; i++) {
        const len = encodeInput(buf, 0, [{ clientTick: ++tick, flags: 0, yaw: quantizeAngle(0), pitch: 0 }]);
        t.zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
        if (attack) t.zone.attack(1);
        t.zone.step();
      }
    };
    run(40, true);
    const hits = t.messages.filter((m) => m.op === SC.OBJECT_STATE && !m.d.full).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects).filter((o) => o.id === 4);
    expect(hits[0]).toMatchObject({ state: 'present', damage: 5, hp: 3 });
    expect(hits.at(-1)).toMatchObject({ state: 'gone', hp: 0 });
    run(20 * 300 + 40);
    const back = t.messages.filter((m) => m.op === SC.OBJECT_STATE).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects).filter((o) => o.id === 4).at(-1);
    expect(back?.state).toBe('present');
  });

  it('drops an item onto the ground dynamically and picks it back up without respawning', () => {
    const t = objectZone();
    // Give player a potion in slot 2
    t.zone.interact(1, 1);
    t.zone.step();
    const potion = t.last(SC.INVENTORY_UPDATE)!.d.items.find((i) => i.itemId === 'healing_potion')!;
    expect(potion).toBeDefined();

    // Drop it to the ground
    t.zone.dropInventoryItem(1, potion.slot);
    t.zone.step();

    // Verify it was removed from inventory
    const afterDrop = t.last(SC.INVENTORY_UPDATE)!.d.items;
    expect(afterDrop.some((i) => i.itemId === 'healing_potion')).toBe(false);

    // Verify dynamic object state broadcast
    const droppedObjMsg = t.messages.filter((m) => m.op === SC.OBJECT_STATE && !m.d.full).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects).find((o) => o.id >= 2_000_000);
    expect(droppedObjMsg).toBeDefined();
    expect(droppedObjMsg?.state).toBe('present');
    expect(droppedObjMsg?.def?.item?.name).toBe('Healing Potion');

    const droppedId = droppedObjMsg!.id;

    // Pick it back up
    t.zone.interact(1, droppedId);
    t.zone.step();

    // Verify it is back in inventory
    const pickedUp = t.last(SC.INVENTORY_UPDATE)!.d.items.find((i) => i.itemId === 'healing_potion')!;
    expect(pickedUp).toBeDefined();

    // Step far into the future (beyond respawn window)
    for (let i = 0; i < 20 * 350; i++) t.zone.step();

    // Verify it never respawned
    const respawnMsgs = t.messages.filter((m) => m.op === SC.OBJECT_STATE && !m.d.full).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects).filter((o) => o.id === droppedId && o.state === 'present');
    // Only the initial drop 'present' state should exist, no respawn
    expect(respawnMsgs).toHaveLength(1);
  });

  it('expires dropped items after 5 minutes (6000 ticks) and broadcasts gone state', () => {
    const t = objectZone();
    t.zone.interact(1, 1);
    t.zone.step();
    const potion = t.last(SC.INVENTORY_UPDATE)!.d.items.find((i) => i.itemId === 'healing_potion')!;
    t.zone.dropInventoryItem(1, potion.slot);
    t.zone.step();

    const droppedObjMsg = t.messages.filter((m) => m.op === SC.OBJECT_STATE && !m.d.full).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects).find((o) => o.id >= 2_000_000)!;
    expect(droppedObjMsg).toBeDefined();
    const droppedId = droppedObjMsg.id;

    // Step 5 minutes (20 ticks/sec * 300 sec = 6000 ticks)
    for (let i = 0; i < 6020; i++) t.zone.step();

    // Verify it expired and became 'gone'
    const goneMsgs = t.messages.filter((m) => m.op === SC.OBJECT_STATE && !m.d.full).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects).filter((o) => o.id === droppedId && o.state === 'gone');
    expect(goneMsgs.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces a 20-item ground limit per player, instantly removing the oldest on the 21st drop', () => {
    const t = objectZone();
    const p = (t.zone as unknown as { players: Map<number, { inventory: InventoryEntry[] }> }).players.get(1)!;
    // Add 21 separate unequipped potions to inventory
    for (let s = 2; s <= 22; s++) {
      p.inventory.push({ slot: s, itemId: 'healing_potion', equipped: false });
    }

    const droppedIds: number[] = [];

    // Drop first 20 items (slots 2..21)
    for (let s = 2; s <= 21; s++) {
      t.zone.dropInventoryItem(1, s);
      t.zone.step();

      const lastDropped = t.messages.filter((m) => m.op === SC.OBJECT_STATE && !m.d.full).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects).filter((o) => o.id >= 2_000_000 && o.state === 'present').at(-1)!;
      droppedIds.push(lastDropped.id);
    }
    expect(droppedIds).toHaveLength(20);
    const firstDroppedId = droppedIds[0]!;

    // Verify the first item is still present before dropping the 21st
    const firstBefore21 = t.messages.filter((m) => m.op === SC.OBJECT_STATE && !m.d.full).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects).filter((o) => o.id === firstDroppedId && o.state === 'gone');
    expect(firstBefore21).toHaveLength(0);

    // Drop the 21st item (slot 22)
    t.zone.dropInventoryItem(1, 22);
    t.zone.step();

    // The oldest item (firstDroppedId) must have disappeared instantly
    const firstAfter21 = t.messages.filter((m) => m.op === SC.OBJECT_STATE && !m.d.full).flatMap((m) => (m as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects).filter((o) => o.id === firstDroppedId && o.state === 'gone');
    expect(firstAfter21).toHaveLength(1);
  });

  it('allows picking up dropped dynamic items atomically without duplication between two players', () => {
    const arena = createSyntheticArena();
    const messages: { connId: number; msg: ServerControlMsg }[] = [];
    const zone = new WorldZone(rapier, 'atomic', arena, {
      send: (c, data) => { if (typeof data === 'string') messages.push({ connId: c, msg: JSON.parse(data) }); },
    }, { random: () => 0 });

    zone.join(1, { name: 'P1', characterId: null, position: { x: 0, y: 0.5, z: 0 }, inventory: [{ slot: 2, itemId: 'healing_potion', equipped: false, quantity: 1, x: 0, y: 0 }] });
    zone.join(2, { name: 'P2', characterId: null, position: { x: 0, y: 0.5, z: 0 }, inventory: [] });

    // Player 1 drops the potion
    zone.dropInventoryItem(1, 2);
    zone.step();

    const dropped = messages
      .filter((m) => m.msg.op === SC.OBJECT_STATE && !m.msg.d.full)
      .flatMap((m) => (m.msg as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects)
      .find((o) => o.id >= 2_000_000 && o.state === 'present');
    expect(dropped).toBeDefined();
    const droppedId = dropped!.id;

    // Both players attempt to interact / pick up the same item at the same time
    zone.interact(1, droppedId);
    zone.interact(2, droppedId);
    zone.step();

    // Exactly one player should receive the potion in an INVENTORY_UPDATE
    const p1Inv = messages.filter((m) => m.connId === 1 && m.msg.op === SC.INVENTORY_UPDATE).at(-1)?.msg as Extract<ServerControlMsg, { op: typeof SC.INVENTORY_UPDATE }>;
    const p2Inv = messages.filter((m) => m.connId === 2 && m.msg.op === SC.INVENTORY_UPDATE).at(-1)?.msg as Extract<ServerControlMsg, { op: typeof SC.INVENTORY_UPDATE }>;

    const p1Has = p1Inv?.d.items.some((i) => i.itemId === 'healing_potion') ?? false;
    const p2Has = p2Inv?.d.items.some((i) => i.itemId === 'healing_potion') ?? false;
    expect(p1Has !== p2Has).toBe(true);

    // Dynamic item was removed from world objects
    const gone = messages
      .filter((m) => m.msg.op === SC.OBJECT_STATE && !m.msg.d.full)
      .flatMap((m) => (m.msg as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects)
      .find((o) => o.id === droppedId && o.state === 'gone');
    expect(gone).toBeDefined();
  });

  it('rejects pickup when bag is full and preserves the ground item', () => {
    const arena = createSyntheticArena();
    const messages: { connId: number; msg: ServerControlMsg }[] = [];
    const zone = new WorldZone(rapier, 'full_bag', arena, {
      send: (c, data) => { if (typeof data === 'string') messages.push({ connId: c, msg: JSON.parse(data) }); },
    }, { random: () => 0 });

    zone.join(1, { name: 'P1', characterId: null, position: { x: 0, y: 0.5, z: 0 }, inventory: [{ slot: 0, itemId: 'long_sword', equipped: false, x: 0, y: 0 }] });
    // Fill P2's bag completely (all 48 cells)
    const fullBag = Array.from({ length: 48 }, (_, i) => ({
      slot: i,
      itemId: 'mace',
      equipped: false,
      x: i % 8,
      y: Math.floor(i / 8),
    }));
    zone.join(2, { name: 'P2', characterId: null, position: { x: 0, y: 0.5, z: 0 }, inventory: fullBag });

    zone.dropInventoryItem(1, 0);
    zone.step();

    const dropped = messages
      .filter((m) => m.msg.op === SC.OBJECT_STATE && !m.msg.d.full)
      .flatMap((m) => (m.msg as Extract<ServerControlMsg, { op: typeof SC.OBJECT_STATE }>).d.objects)
      .find((o) => o.id >= 2_000_000 && o.state === 'present')!;

    // Player 2 with full bag tries to pick it up
    messages.length = 0;
    zone.interact(2, dropped.id);
    zone.step();

    // Must receive bag_full error
    const err = messages.find((m) => m.connId === 2 && m.msg.op === SC.ERROR)?.msg as Extract<ServerControlMsg, { op: typeof SC.ERROR }> | undefined;
    expect(err).toBeDefined();
    expect(err?.d.code).toBe('bag_full');
    expect(err?.d.message).toBe('Inventory full.');
  });

  it('rejects equip and sends bag_full when swapped item cannot fit in inventory', () => {
    const arena = createSyntheticArena();
    const messages: { connId: number; msg: ServerControlMsg }[] = [];
    const zone = new WorldZone(rapier, 'equip_full', arena, {
      send: (c, data) => { if (typeof data === 'string') messages.push({ connId: c, msg: JSON.parse(data) }); },
    }, { random: () => 0 });

    // Equipped scale_armor (2x3) and banded_armor (2x3) in bag.
    // The bag is packed with potions so there is no 2x3 space to return scale_armor to the bag.
    const packedInv = [
      { slot: 0, itemId: 'scale_armor', equipped: true },
      { slot: 1, itemId: 'banded_armor', equipped: false, x: 0, y: 0 },
      ...Array.from({ length: 42 }, (_, i) => ({
        slot: i + 2,
        itemId: 'healing_potion',
        equipped: false,
        x: (i + 2) % 8,
        y: Math.floor((i + 2) / 8),
      })),
    ];
    zone.join(1, { name: 'P1', characterId: null, position: { x: 0, y: 0.5, z: 0 }, inventory: packedInv });

    messages.length = 0;
    zone.equip(1, 1, true);
    zone.step();

    const err = messages.find((m) => m.connId === 1 && m.msg.op === SC.ERROR)?.msg as Extract<ServerControlMsg, { op: typeof SC.ERROR }> | undefined;
    expect(err).toBeDefined();
    expect(err?.d.code).toBe('bag_full');
    expect(err?.d.message).toBe('Inventory full.');
  });

  it('picks up Mana Crystals and restores mana when used', () => {
    const arena = createSyntheticArena();
    arena.objects = [{ id: 10, kind: 'item', x: 0, y: 0.5, z: 0.5, item: { name: 'Mana Crystals 2', quantity: 2 } }];
    const messages: { connId: number; msg: ServerControlMsg }[] = [];
    const zone = new WorldZone(rapier, 'mana_crystals', arena, {
      send: (c, data) => { if (typeof data === 'string') messages.push({ connId: c, msg: JSON.parse(data) }); },
    }, { random: () => 0 });

    zone.join(1, { name: 'Mage', characterId: null, mana: 5, position: { x: 0, y: 0.5, z: 0 }, inventory: [] });
    zone.step();

    // Pick up Mana Crystals 2
    messages.length = 0;
    zone.interact(1, 10);
    zone.step();

    const inv = messages.filter((m) => m.connId === 1 && m.msg.op === SC.INVENTORY_UPDATE).at(-1)?.msg as Extract<ServerControlMsg, { op: typeof SC.INVENTORY_UPDATE }>;
    expect(inv).toBeDefined();
    const crystal = inv.d.items.find((i) => i.itemId === 'mana_crystals_2');
    expect(crystal).toBeDefined();
    expect(crystal?.quantity).toBe(2);

    // Use one crystal to restore mana
    zone.useItem(1, crystal!.slot);
    zone.step();

    const stats = messages.filter((m) => m.connId === 1 && m.msg.op === SC.PLAYER_STATS).at(-1)?.msg as Extract<ServerControlMsg, { op: typeof SC.PLAYER_STATS }>;
    expect(stats).toBeDefined();
    expect(stats.d.mana).toBe(10); // 5 + 5 = 10
  });
});



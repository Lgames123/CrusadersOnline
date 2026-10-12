import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone, type PersistRecord } from '@crusaders/server/simulation/world_zone';
import {
  ANIM,
  COMBO_MULTIPLIERS,
  MOB_HOP_RANGE,
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

/** In-process zone with one player; captures JSON messages and persist requests. */
function setup(opts: { experience?: number; inventory?: InventoryEntry[]; random?: () => number; reactiveBlock?: boolean } = {}) {
  const messages: ServerControlMsg[] = [];
  const persisted: { records: PersistRecord[]; reason: string }[] = [];
  const zone = new WorldZone(rapier, 'test', createSyntheticArena(), {
    send: (_conn, data) => {
      if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg);
    },
    persist: (records, reason) => persisted.push({ records, reason }),
  }, { random: opts.random ?? (() => 0), reactiveBlock: opts.reactiveBlock });
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
  return { zone, run, mob, me, events, stats, inventories, persisted, entityId };
}

/** Ticks of running that cover 6 m (towards the skeleton's aggro range). */
const APPROACH = Math.ceil((6 / DEFAULT_MOVEMENT_STATS.runSpeed) * TICK_RATE);

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
    // Closed in: within its lunge (forward hop) range, or already in reach.
    const gap = Math.hypot(t.mob().x - t.me().x, t.mob().z - t.me().z);
    expect(gap).toBeLessThan(MOB_HOP_RANGE);
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
    const t = setup();
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
  it('replicates the side swing and keeps it out of the combo chain', () => {
    const t = setup();
    t.run(5); // away from the skeleton: a hit would interrupt the swing
    t.zone.attack(1, 'left');
    t.run(1);
    expect(t.me().anim).toBe(ANIM.ATTACK_LEFT);
    t.run(30);
    t.zone.attack(1); // a plain click right after starts the combo at hit 1
    t.run(1);
    expect(t.me().anim).toBe(ANIM.ATTACK);
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
    expect(addItem(inv, 'long_sword')).toBe(2);
    expect(setEquipped(inv, 2, true, BUILTIN_ITEMS)).toBe(true);
    expect(inv.filter((e) => e.equipped).map((e) => e.itemId)).toEqual(['wooden_shield', 'long_sword']);
    expect(equipmentOf(inv, BUILTIN_ITEMS).weapon.name).toBe('Long Sword');
    expect(setEquipped(inv, 2, true, BUILTIN_ITEMS)).toBe(false); // no-op
    expect(setEquipped(inv, 9, true, BUILTIN_ITEMS)).toBe(false); // empty slot
    const full: InventoryEntry[] = Array.from({ length: 32 }, (_, slot) => ({ slot, itemId: 'axe', equipped: false }));
    expect(addItem(full, 'mace')).toBeNull();
  });

  it('drops unknown items, bad slots and duplicate equipped items from saved data', () => {
    const clean = sanitizeInventory([
      { slot: 0, itemId: 'axe', equipped: true },
      { slot: 1, itemId: 'mace', equipped: true },
      { slot: 1, itemId: 'long_sword', equipped: false },
      { slot: 2, itemId: 'excalibur', equipped: true },
      { slot: 40, itemId: 'mace', equipped: false },
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
    });
    t.zone.equip(1, 2, true);
    t.zone.equip(1, 3, true);
    expect(t.inventories().at(-1)!.weaponSpeed).toBe(1);
    t.run(APPROACH, INPUT.FORWARD, 0);
    t.run(30);
    // One swing every 1.5 s: back-to-back swings would keep the skeleton in its hit reactions.
    for (let i = 0; i < 600 && t.mob().alive; i++) t.run(1, 0, 0, () => i % 30 === 0 && t.zone.attack(1));
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
    expect(t.inventories()[0]!.items.map((i) => [i.itemId, i.equipped])).toEqual([['axe', true], ['wooden_shield', true]]);
  });
});

describe('skeleton lunge (original behaviour)', () => {
  it('hops forward from range and swings straight after', () => {
    const t = setup();
    t.run(APPROACH, INPUT.FORWARD, 0);
    const anims: number[] = [];
    for (let i = 0; i < 80; i++) {
      t.run(1);
      anims.push(t.mob().anim);
    }
    const hop = anims.indexOf(ANIM.HOP_FORWARD);
    expect(hop).toBeGreaterThanOrEqual(0);
    const after = anims.slice(hop).find((a) => a !== ANIM.HOP_FORWARD);
    expect([ANIM.ATTACK, ANIM.ATTACK_OVERHEAD, ANIM.ATTACK_LOW]).toContain(after);
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
    const t = setup();
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
      t.run(1, 0, 0, () => i % 25 === 0 && t.zone.attack(1));
      hitMob = t.events().slice(n).some((e) => e.target === t.mob().id && e.damage > 0 && !e.killed);
    }
    expect(hitMob).toBe(true);
    t.run(1); // replicated from the creature's next update
    expect(t.mob().swinging).toBe(false);
    expect(t.mob().anim).toBe(ANIM.HIT);
  });
});

describe('skeleton shield AI', () => {
  it('does not raise its shield in reaction to a swing (the logged original never did)', () => {
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
    // 0.68 passes the 35% block roll but not the step-back / leap rolls.
    const t = setup({ random: () => 0.68, reactiveBlock: true });
    t.run(APPROACH, INPUT.FORWARD, 0);
    t.run(30);
    const gap = () => Math.hypot(t.mob().x - t.me().x, t.mob().z - t.me().z);
    for (let i = 0; i < 80 && (t.mob().swinging || gap() > PLAYER_REACH + 0.3); i++) t.run(1);
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

  it('raises the shield for 0.82 s after its 0.5 s stance; frontal hits then are blocked, others land', () => {
    // 0.68 passes the stance-shield roll, not the step-back / leap rolls.
    const t = setup({ random: () => 0.68 });
    t.run(APPROACH, INPUT.FORWARD, 0);
    t.run(30);
    // Swing as soon as the stance shield is up (it stays up 0.82 s); otherwise wait.
    for (let i = 0; i < 600 && t.mob().alive; i++) {
      const up = t.mob().shield;
      t.run(1, 0, 0, () => up && t.zone.attack(1));
      if (t.events().some((e) => e.target === t.mob().id && e.blocked)) break;
    }
    // ...then keep swinging now and then until one lands.
    for (let i = 0; i < 600 && t.mob().alive; i++) t.run(1, 0, 0, () => i % 20 === 0 && t.zone.attack(1));
    const onMob = t.events().filter((e) => e.target === t.mob().id);
    expect(onMob.some((e) => e.blocked)).toBe(true);
    expect(onMob.some((e) => !e.blocked && e.damage > 0)).toBe(true);
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
    zone.join(1, { name: 'Looter', characterId: null, position: { x: 0, y: 0.5, z: 0 } });
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
});

import { beforeAll, describe, expect, it } from 'vitest';
import { BOOMER_RULES, BoomerAxes, naturalSpline, type BoomerHost } from '@crusaders/server/simulation/boomer_axe';
import type { SpellTarget } from '@crusaders/server/simulation/spell_runtime';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  DAMAGE_TYPES,
  INPUT_PACKET_MAX_BYTES,
  SC,
  TICK_DT,
  catalogFromItemRules,
  createMovementWorld,
  createSyntheticArena,
  encodeInput,
  initPhysics,
  quantizeAngle,
  type Character,
  type InventoryEntry,
  type Rapier,
  type ServerControlMsg,
  type SpellEventMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const FT = 0.3048;
type AxeMsg = NonNullable<SpellEventMsg['d']['axe']>;

describe('natural cubic spline (0x004C2BF0 / 0x004C28F0)', () => {
  it('passes through its keys, is straight on straight data and flat-curved at the ends', () => {
    const ts = [0, 1, 2, 3];
    const ys = [0, 4, -1, 2];
    const s = naturalSpline(ts, ys);
    ts.forEach((t, i) => expect(s(t)).toBeCloseTo(ys[i]!, 9));
    const line = naturalSpline(ts, [1, 3, 5, 7]);
    expect(line(1.5)).toBeCloseTo(4, 9);
    // Natural: no second derivative at either end.
    const e = 1e-3;
    const d2 = (t: number) => (s(t + e) - 2 * s(t) + s(t - e)) / (e * e);
    expect(Math.abs(d2(e))).toBeLessThan(0.05);
    expect(Math.abs(d2(3 - e))).toBeLessThan(0.05);
    // Clamped outside the keys.
    expect(s(5)).toBeCloseTo(2, 9);
  });
});

describe('the Boomer Axe in flight (0x004C06B0)', () => {
  /** A wielder at the origin facing -z and the axes, with a fake host. */
  function rig(others: SpellTarget[] = [], random = () => 0.5) {
    const mw = createMovementWorld(rapier, createSyntheticArena());
    const target = (id: number, x: number, z: number): SpellTarget => ({
      entityId: id, kind: 'mob', yaw: 0, hp: 100, maxHp: 100, statuses: new Map(),
      character: { position: { x, y: 0, z } } as unknown as Character,
    });
    const owner = target(1, 0, 0);
    owner.kind = 'player';
    const all = [owner, ...others];
    const msgs: SpellEventMsg['d'][] = [];
    const damage: { target: number; vector: number[] }[] = [];
    let caught = 0;
    const host: BoomerHost = {
      mw,
      random,
      characters: () => all,
      alive: () => true,
      present: () => true,
      hostile: (a, b) => a !== b,
      shieldStops: () => false,
      damage: (_a, t, vector) => damage.push({ target: t.entityId, vector }),
      emit: (_at, d) => msgs.push(d),
      caught: () => caught++,
    };
    const axes = new BoomerAxes(host);
    const axeMsgs = () => msgs.flatMap((m) => (m.axe ? [m.axe] : []));
    return { axes, owner, target, msgs, damage, axeMsgs, caught: () => caught };
  }

  it('flies out 1 s at 60 ft/s, curves home and is caught at the hand', () => {
    const r = rig();
    const hand = { x: 0, y: 1.3, z: -0.45 };
    expect(r.axes.throw(r.owner, hand, { x: 0, y: 0, z: -1 })).toBe(true);
    expect(r.axes.flying(r.owner)).toBe(true);
    // A second throw while it flies does nothing.
    expect(r.axes.throw(r.owner, hand, { x: 0, y: 0, z: -1 })).toBe(false);
    let ticks = 0;
    let farthest = 0;
    while (r.caught() === 0 && ticks < 2000) {
      r.axes.step();
      ticks++;
      const last = r.axeMsgs().at(-1)!;
      farthest = Math.max(farthest, -last.pos[2]);
    }
    expect(r.caught()).toBe(1);
    expect(r.axes.flying(r.owner)).toBe(false);
    // Out: 60 ft in 1 s, then the curve home (t to 3 - 0.05 k at k = 80 / 60 per second).
    expect(farthest / FT).toBeGreaterThan(55);
    expect(farthest / FT).toBeLessThan(63);
    const pace = 80 / 60;
    const home = (3 - BOOMER_RULES.catchAt * pace) / pace;
    expect(ticks * TICK_DT).toBeGreaterThan(1 + home - 0.2);
    expect(ticks * TICK_DT).toBeLessThan(1 + home + 0.2);
    expect(r.axeMsgs().at(-1)!.end).toBe(true);
    expect(r.damage).toEqual([]);
  });

  it('meets a creature: SLASH 5 + AIR 5, sound 306/307, then turns back', () => {
    const v = rig().target(2, 0, -20 * FT);
    const r2 = rig([v], () => 0.9);
    r2.axes.throw(r2.owner, { x: 0, y: 1.3, z: -0.45 }, { x: 0, y: 0, z: -1 });
    for (let i = 0; i < 400 && r2.caught() === 0; i++) r2.axes.step();
    expect(r2.damage).toHaveLength(1);
    const vec = r2.damage[0]!.vector;
    expect(vec[DAMAGE_TYPES.indexOf('SLASH')]).toBe(5);
    expect(vec[DAMAGE_TYPES.indexOf('AIR')]).toBe(5);
    expect(r2.msgs.flatMap((m) => m.sounds ?? []).map((s) => s.id)).toContain(307);
    // Turned back at the creature, ~20 ft out, not 60.
    const farthest = Math.max(...r2.axeMsgs().map((m) => -m.pos[2]));
    expect(farthest / FT).toBeLessThan(22);
    expect(r2.caught()).toBe(1);
  });

  it('passes the creature it is thrown from inside of (the blow victim) and meets it on the way back', () => {
    const v = rig().target(2, 0, -2.5 * FT);
    const r = rig([v]);
    r.axes.throw(r.owner, { x: 0, y: 1.3, z: -0.45 }, { x: 0, y: 0, z: -1 });
    for (let i = 0; i < 400 && r.caught() === 0; i++) r.axes.step();
    const farthest = Math.max(...r.axeMsgs().map((m) => -m.pos[2]));
    expect(farthest / FT).toBeGreaterThan(55);
    expect(r.damage.map((d) => d.target)).toEqual([2]);
    expect(r.caught()).toBe(1);
  });

  it('a wall turns it back with sparks, a scorch and sound 328 / 206', () => {
    const r = rig([], () => 0);
    // The synthetic arena's wall is 20 m away along -z: aim at the pillar at (-8, -8) instead, 8.5 m off.
    const from = { x: -8, y: 1.3, z: 0 };
    r.axes.throw(r.owner, from, { x: 0, y: 0, z: -1 });
    for (let i = 0; i < 60; i++) r.axes.step();
    const d = r.msgs.find((m) => m.decals?.length);
    expect(d?.decals?.[0]?.kind).toBe('SCORCH');
    expect(d?.fx?.[0]?.name).toBe('SWORD_METAL');
    expect(d?.sounds?.[0]?.id).toBe(328);
  });
});

describe('a landed Boomer Axe blow throws it (0x0044D59A → 0x00401000)', () => {
  const RULES: Parameters<typeof catalogFromItemRules>[0] = { items: [
    { name: 'Axe', parent: null, fields: { Type: 'WEAPON', SubType: 'MELEE', Model: 71, Width: 1, Height: 3, Price: 100, Speed: 1.1 }, damage: { SLASH: 5, BASH: 5 }, protection: {}, calls: [] },
    { name: 'Boomer Axe', parent: 'Axe', fields: { Type: 'WEAPON', SubType: 'THROWABLE', Model: 71, Texture: 1, Width: 1, Height: 3, Price: 1600, Speed: 1.2, Use: 'BOOMER' }, damage: { SLASH: 20 }, protection: {}, calls: [] },
  ] };
  const items = catalogFromItemRules(RULES);

  it('reads Use BOOMER', () => {
    expect(items.get('boomer_axe')!.boomer).toBe(true);
    expect(items.get('axe')!.boomer).toBeUndefined();
  });

  it('the axe leaves the hand, strikes and comes back to be wielded again', () => {
    const arena = createSyntheticArena();
    arena.mobSpawns = [{ x: 0, y: 0.5, z: -5 * FT, yaw: Math.PI, archetype: 'skeleton_warrior', shield: null }];
    const messages: ServerControlMsg[] = [];
    const zone = new WorldZone(rapier, 'boomer', arena, {
      send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
    }, { random: () => 0, items });
    const inventory: InventoryEntry[] = [{ slot: 0, itemId: 'boomer_axe', equipped: true }];
    const me = zone.join(1, { name: 'Tester', characterId: null, position: { x: 0, y: 0.5, z: 0 }, experience: 0, inventory });
    const buf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
    let clientTick = 0;
    const axes = () => messages.flatMap((m) => (m.op === SC.SPELL_EVENT ? [(m as SpellEventMsg).d.axe] : [])).filter((a): a is AxeMsg => !!a);
    const speeds = () => messages.flatMap((m) => (m.op === SC.INVENTORY_UPDATE ? [m.d.weaponSpeed] : []));
    let thrownAt = -1;
    for (let i = 0; i < 400; i++) {
      const len = encodeInput(buf, 0, [{ clientTick: ++clientTick, flags: 0, yaw: quantizeAngle(0), pitch: 0 }]);
      zone.receiveInput(1, new DataView(buf.buffer.slice(0, len)));
      if (thrownAt < 0 && i % 25 === 0) zone.attack(1);
      zone.step();
      if (thrownAt < 0 && axes().length) thrownAt = i;
      if (axes().some((a) => a.end)) break;
    }
    expect(thrownAt).toBeGreaterThanOrEqual(0);
    const all = axes();
    expect(all[0]!.end).toBeUndefined();
    expect(all.at(-1)!.end).toBe(true);
    // Unarmed while it flew (the inventory tells the client the fists' speed), the axe's again once caught.
    expect(speeds()).toContain(1);
    expect(speeds().at(-1)).toBe(1.2);
    // The magic axe's own SLASH 5 + AIR 5 reached the skeleton after the blow itself.
    const hits = messages.flatMap((m) => (m.op === SC.COMBAT_EVENT && m.d.damage > 0 && m.d.attacker === me ? [m.d] : []));
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[1]!.damage).toBeLessThan(hits[0]!.damage);
  });
});

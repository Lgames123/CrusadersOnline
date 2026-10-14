import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  BUILTIN_ITEMS,
  PORTAL_OBJECT_BASE,
  SC,
  catalogFromItemRules,
  createMovementWorld,
  createSyntheticArena,
  initPhysics,
  setDoorOpen,
  advanceSwing,
  moverFromMotion,
  MOVER_BACK,
  MOVER_DONE,
  MOVER_FORWARD,
  MOVER_SHUT,
  doorSwingFromMotion,
  swingKeyAwayFrom,
  wallDistance,
  type DoorSwing,
  type ArenaDef,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

/** A 2 x 3 m door slab 1.5 m in front of the spawn (yaw 0 faces -Z); `lock` names its key. */
/** The original's inn / house door mover (Cs1a bDoorE_1): ±90° keys, eased, back after 4 s. */
const SWING: DoorSwing = doorSwingFromMotion({
  flags: 0x44002008, start: 0, delayMs: 4000, types: [0x90, 0x90],
  keys: [[90, 1 / 0.3048, -1.5 / 0.3048], [-90, 1 / 0.3048, -1.5 / 0.3048]],
  speeds: [1 / 9000, 1 / 9000, 1 / 450, 1 / 450],
}, 0.3048)!;

function doorArena(lock?: string, swing = false): ArenaDef {
  const arena = createSyntheticArena();
  const b = [-1, 0, -1.6, 1, 3, -1.4] as const;
  const points: number[] = [];
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) points.push(x, y, z);
  arena.objects = [{ id: 500_000, kind: 'door', x: 0, y: 0, z: -1.5, bounds: [...b], ...(lock ? { lock } : {}) }];
  arena.brushes = [{ name: 'bDoorE_1', points: new Float32Array(points), solid: true, door: 500_000, ...(swing ? { swing: SWING } : {}) }];
  return arena;
}

describe('doors', () => {
  it('a closed door blocks; opened, its collider is gone', () => {
    const mw = createMovementWorld(rapier, doorArena());
    const feet = { x: 0, y: 0, z: 0 };
    expect(wallDistance(mw, feet, 0, 3, 1)).toBeCloseTo(1.4, 1);
    expect(setDoorOpen(mw, 500_000, true)).toBe(true);
    expect(wallDistance(mw, feet, 0, 3, 1)).toBeNull();
    setDoorOpen(mw, 500_000, false);
    expect(wallDistance(mw, feet, 0, 3, 1)).toBeCloseTo(1.4, 1);
    expect(setDoorOpen(mw, 7, true)).toBe(false);
  });

  it('door keys are USEABLE items named "... Key"', () => {
    const catalog = catalogFromItemRules({ items: [
      { name: 'Ice Key', fields: { Type: 'USEABLE', Permanent: true } },
      { name: 'Dwarven Tome', fields: { Type: 'TRINKET' } },
    ] } as never);
    expect(catalog.get('ice_key')).toMatchObject({ type: 'key', name: 'Ice Key' });
    expect(catalog.has('dwarven_tome')).toBe(false);
  });

  function zone(lock?: string, carry = false) {
    const items = new Map(BUILTIN_ITEMS);
    items.set('room_2_key', { id: 'room_2_key', name: 'Room 2 Key', type: 'key', width: 1, height: 1, price: 0 });
    const messages: ServerControlMsg[] = [];
    const z = new WorldZone(rapier, 'doors', doorArena(lock), {
      send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
    }, { items });
    z.join(1, { name: 'Opener', characterId: null, position: { x: 0, y: 0.5, z: 0 }, ...(carry ? { inventory: [{ slot: 0, itemId: 'room_2_key', equipped: false }] } : {}) });
    const opened = () => messages.some((m) => m.op === SC.OBJECT_STATE && m.d.objects.some((o) => o.id === 500_000 && o.state === 'open'));
    const blocked = () => wallDistance((z as unknown as { mw: Parameters<typeof wallDistance>[0] }).mw, { x: 0, y: 0, z: 0 }, 0, 3, 1) !== null;
    return { z, opened, blocked };
  }

  it('the interact key opens an unlocked door in reach', () => {
    const t = zone();
    expect(t.blocked()).toBe(true);
    t.z.interact(1, 500_000);
    expect(t.opened()).toBe(true);
    expect(t.blocked()).toBe(false);
  });

  it('a lever-operated gate ignores the interact key; pulling its lever opens it', () => {
    const arena = doorArena();
    arena.objects![0]!.byLever = true;
    arena.objects!.push({ id: 500_001, kind: 'lever', x: 1, y: 0, z: 0, bounds: [1, 0, -0.1, 1.2, 1.2, 0.1], opens: [500_000] });
    const messages: ServerControlMsg[] = [];
    const z = new WorldZone(rapier, 'lever', arena, {
      send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
    });
    z.join(1, { name: 'Puller', characterId: null, position: { x: 0, y: 0.5, z: 0 } });
    const open = (id: number) => messages.some((m) => m.op === SC.OBJECT_STATE && m.d.objects.some((o) => o.id === id && o.state === 'open'));
    z.interact(1, 500_000);
    expect(open(500_000)).toBe(false);
    z.interact(1, 500_001);
    expect(open(500_001)).toBe(true);
    expect(open(500_000)).toBe(true);
    expect(wallDistance((z as unknown as { mw: Parameters<typeof wallDistance>[0] }).mw, { x: 0, y: 0, z: 0 }, 0, 3, 1)).toBeNull();
  });

  it('a lever pulls once and its gate rises on its mover, waits its delay and comes back down (Ws9a)', () => {
    // Ws9a: bLever1_1 turns 40° about Z, once (mode 6); bOuterGates rises, back after 5 s (mode 0 + flag 8).
    const arena = doorArena();
    arena.objects![0]!.byLever = true;
    arena.objects!.push({ id: 500_001, kind: 'lever', x: 1, y: 0, z: 0, bounds: [1, 0, -0.1, 1.2, 1.2, 0.1], opens: [500_000] });
    arena.brushes![0]!.mover = moverFromMotion({ flags: 0x4002048, start: 0, delayMs: 5000, types: [0x46], keys: [[0, 3.2, 0]], speeds: [1 / 1000, 0] }, 1)!;
    arena.brushes!.push({ name: 'bLever1_1', points: new Float32Array([1, 0, 0, 1.2, 1.2, 0]), solid: false, door: 500_001, mover: moverFromMotion({ flags: 0x4002806, start: 0, delayMs: 0, types: [0xa0], keys: [[40, 1.1, 0]], speeds: [1 / 500, 0] }, 1)! });
    const messages: ServerControlMsg[] = [];
    const z = new WorldZone(rapier, 'lever', arena, {
      send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
    });
    z.join(1, { name: 'Puller', characterId: null, position: { x: 0, y: 0.5, z: 0 } });
    const last = (id: number) => messages.flatMap((m) => (m.op === SC.OBJECT_STATE ? m.d.objects.filter((o) => o.id === id) : [])).at(-1);
    const blocked = () => wallDistance((z as unknown as { mw: Parameters<typeof wallDistance>[0] }).mw, { x: 0, y: 0, z: 0 }, 0, 3, 1) !== null;
    z.interact(1, 500_001);
    expect(last(500_001)).toMatchObject({ state: 'open', mover: { state: MOVER_FORWARD } });
    expect(last(500_000)).toMatchObject({ state: 'open', mover: { state: MOVER_FORWARD } });
    expect(blocked()).toBe(true); // it has only begun to rise
    for (let i = 0; i < 20 * 1.1; i++) z.step();
    expect(last(500_001)).toMatchObject({ mover: { state: MOVER_DONE } });
    expect(last(500_000)).toMatchObject({ mover: { state: MOVER_BACK, progress: 1 } });
    expect(blocked()).toBe(false); // up out of the way
    // The lever is done: pulling it again moves nothing.
    const sent = messages.length;
    z.interact(1, 500_001);
    expect(messages.length).toBe(sent);
    for (let i = 0; i < 20 * 6.5; i++) z.step();
    expect(last(500_000)).toMatchObject({ state: 'present', mover: { state: MOVER_SHUT } });
  });

  it('a door exit is taken with the interact key, not by walking in', () => {
    const arena = createSyntheticArena();
    arena.portals = [{ id: 0, target: 'level:next', x: 0, y: 0.5, z: -1, use: true }];
    const portals: string[] = [];
    const z = new WorldZone(rapier, 'exit', arena, { send: () => {}, portal: (_c, target) => portals.push(target) });
    z.join(1, { name: 'Leaver', characterId: null, position: { x: 0, y: 0.5, z: 0 } });
    for (let i = 0; i < 5; i++) z.step();
    expect(portals).toEqual([]);
    z.interact(1, PORTAL_OBJECT_BASE);
    expect(portals).toEqual(['level:next']);
  });

  it('a locked door opens only with the use key and its key carried', () => {
    const without = zone('Room 2 Key');
    without.z.interact(1, 500_000, true);
    expect(without.opened()).toBe(false);
    const t = zone('Room 2 Key', true);
    t.z.interact(1, 500_000);
    expect(t.opened()).toBe(false);
    t.z.interact(1, 500_000, true);
    expect(t.opened()).toBe(true);
    expect(t.blocked()).toBe(false);
  });

  it('the original door mover: hinge keys, eased swing of ~1.42 s, opens away from the player', () => {
    expect(SWING.keys[0]).toMatchObject({ cx: expect.closeTo(1, 5), cz: expect.closeTo(-1.5, 5), angle: expect.closeTo(Math.PI / 2, 5) });
    expect(SWING.holdMs).toBe(4000);
    let p = 0;
    let ms = 0;
    while (p < 1) (p = advanceSwing(SWING, 0, p, 1, 10)), (ms += 10);
    expect(ms).toBeGreaterThan(1380);
    expect(ms).toBeLessThan(1460);
    const points = doorArena().brushes![0]!.points;
    expect(swingKeyAwayFrom(SWING, points, 0, 0)).toBe(1); // the player is on the +Z side
    expect(swingKeyAwayFrom(SWING, points, 0, -4)).toBe(0);
  });

  function swingZone(blocker = false) {
    const messages: ServerControlMsg[] = [];
    const z = new WorldZone(rapier, 'swing', doorArena(undefined, true), {
      send: (_c, data) => { if (typeof data === 'string') messages.push(JSON.parse(data) as ServerControlMsg); },
    });
    z.join(1, { name: 'Opener', characterId: null, position: { x: 0, y: 0.5, z: 0 } });
    if (blocker) z.join(2, { name: 'InTheWay', characterId: null, position: { x: 0, y: 0.5, z: -2.6 } });
    const states = () => messages.flatMap((m) => (m.op === SC.OBJECT_STATE ? m.d.objects.filter((o) => o.id === 500_000) : []));
    // Straight ahead at x = 0: the shut slab is 1.4 m away; swung open, the way is clear.
    const shut = () => wallDistance((z as unknown as { mw: Parameters<typeof wallDistance>[0] }).mw, { x: 0, y: 0, z: 0 }, 0, 3, 1) !== null;
    return { z, states, shut };
  }

  it('a swinging door turns open, stays open 4 s and swings shut', () => {
    const t = swingZone();
    expect(t.shut()).toBe(true);
    t.z.interact(1, 500_000);
    expect(t.states()[0]).toMatchObject({ state: 'open', swing: { key: 1, phase: 'opening' } });
    for (let i = 0; i < 30; i++) t.z.step();
    expect(t.shut()).toBe(false);
    expect(t.states().at(-1)).toMatchObject({ state: 'open', swing: { phase: 'holding', progress: 1 } });
    for (let i = 0; i < 20 * 4; i++) t.z.step();
    expect(t.states().at(-1)).toMatchObject({ swing: { phase: 'closing' } });
    for (let i = 0; i < 30; i++) t.z.step();
    expect(t.states().at(-1)).toMatchObject({ state: 'present' });
    expect(t.shut()).toBe(true);
  });

  it('a swinging door waits for a character in its way', () => {
    const t = swingZone(true);
    t.z.interact(1, 500_000);
    for (let i = 0; i < 60; i++) t.z.step();
    const last = t.states().at(-1)!;
    expect(last).toMatchObject({ state: 'open', swing: { phase: 'opening', blocked: true } });
    expect(last.swing!.progress).toBeLessThan(1);
  });

  it('solid props block; a breakable one stops blocking once broken', () => {
    const arena = createSyntheticArena();
    const pts: number[] = [];
    for (const x of [-1, 1]) for (const y of [0, 1.5]) for (const z of [-1.6, -1.4]) pts.push(x, y, z);
    arena.solids = [{ points: new Float32Array(pts), object: 7 }];
    const mw = createMovementWorld(rapier, arena);
    const feet = { x: 0, y: 0, z: 0 };
    expect(wallDistance(mw, feet, 0, 3, 1)).toBeCloseTo(1.4, 1);
    expect(setDoorOpen(mw, 7, true)).toBe(true); // broken
    expect(wallDistance(mw, feet, 0, 3, 1)).toBeNull();
  });
});

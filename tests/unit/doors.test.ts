import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  BUILTIN_ITEMS,
  SC,
  catalogFromItemRules,
  createMovementWorld,
  createSyntheticArena,
  initPhysics,
  setDoorOpen,
  wallDistance,
  type ArenaDef,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

/** A 2 x 3 m door slab 1.5 m in front of the spawn (yaw 0 faces -Z); `lock` names its key. */
function doorArena(lock?: string): ArenaDef {
  const arena = createSyntheticArena();
  const b = [-1, 0, -1.6, 1, 3, -1.4] as const;
  const points: number[] = [];
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) points.push(x, y, z);
  arena.objects = [{ id: 500_000, kind: 'door', x: 0, y: 0, z: -1.5, bounds: [...b], ...(lock ? { lock } : {}) }];
  arena.brushes = [{ name: 'bDoorE_1', points: new Float32Array(points), solid: true, door: 500_000 }];
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
    items.set('room_2_key', { id: 'room_2_key', name: 'Room 2 Key', type: 'key', price: 0 });
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
});

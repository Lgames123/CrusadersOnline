import { beforeAll, describe, expect, it } from 'vitest';
import { WorldZone } from '@crusaders/server/simulation/world_zone';
import {
  BUILTIN_ITEMS,
  SC,
  createSyntheticArena,
  initPhysics,
  type InventoryEntry,
  type ItemDef,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await initPhysics();
});

const CHEST = 600_000;
const AT = { x: 0, y: 0.5, z: 0 };
/** Eight 2×3 armours fill the 8×6 bag exactly. */
const FULL_BAG: InventoryEntry[] = Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, itemId: 'scale_armor', equipped: false, x: (i % 4) * 2, y: i < 4 ? 0 : 3 }));

interface Internal {
  players: Map<number, { inventory: InventoryEntry[]; cutscene: unknown; weapon: ItemDef }>;
  objects: Map<number, { state: string; def: { item?: { itemId?: string } } }>;
}

function zone(items = new Map(BUILTIN_ITEMS), carries?: { name: string; quantity: number }[]) {
  const arena = createSyntheticArena();
  if (carries) arena.mobSpawns[0]!.carries = carries;
  arena.objects = [{ id: CHEST, kind: 'chest', x: 0, y: 0, z: -0.5, contents: [{ name: 'Long Sword', quantity: 1 }, { name: 'Gold Pieces', quantity: 5 }] }];
  const messages = new Map<number, ServerControlMsg[]>();
  const z = new WorldZone(rapier, 'inventory', arena, {
    send: (c, data) => {
      if (typeof data === 'string') messages.set(c, [...(messages.get(c) ?? []), JSON.parse(data) as ServerControlMsg]);
    },
  }, { items });
  const internal = z as unknown as Internal;
  const join = (connId: number, inventory?: InventoryEntry[]) => {
    z.join(connId, { name: `P${connId}`, characterId: null, position: { ...AT }, ...(inventory ? { inventory } : {}) });
    return internal.players.get(connId)!;
  };
  const sent = (connId: number) => messages.get(connId) ?? [];
  const errors = (connId: number) => sent(connId).filter((m) => m.op === SC.ERROR);
  const updates = (connId: number) => sent(connId).filter((m) => m.op === SC.INVENTORY_UPDATE).length;
  const dynamic = () => [...internal.objects].filter(([id]) => id >= 2_000_000);
  return { z, internal, join, sent, errors, updates, dynamic };
}

const count = (inv: readonly InventoryEntry[], itemId: string) => inv.filter((e) => e.itemId === itemId).reduce((n, e) => n + (e.quantity ?? 1), 0);

describe('inventory authority in the zone', () => {
  it('a dropped item is picked up by exactly one of two players', () => {
    const t = zone();
    const a = t.join(1);
    const b = t.join(2, [{ slot: 0, itemId: 'healing_potion', equipped: false }]);
    t.z.dropInventoryItem(1, 0, 'long_sword');
    const [[id]] = t.dynamic() as [[number, unknown]];
    t.z.interact(2, id);
    t.z.interact(1, id);
    expect(count(a.inventory, 'long_sword') + count(b.inventory, 'long_sword')).toBe(1);
    expect(count(b.inventory, 'long_sword')).toBe(1);
    expect(t.dynamic()).toHaveLength(0);
  });

  it('a repeated drop of the same slot spawns one ground item and resyncs the client', () => {
    const t = zone();
    t.join(1);
    t.z.dropInventoryItem(1, 1, 'wooden_shield');
    const before = t.updates(1);
    t.z.dropInventoryItem(1, 1, 'wooden_shield');
    expect(t.dynamic()).toHaveLength(1);
    expect(t.updates(1)).toBe(before + 1);
  });

  it('refuses a request whose item no longer is in that slot (stale client view)', () => {
    const t = zone();
    const p = t.join(1, [{ slot: 0, itemId: 'healing_potion', equipped: false, x: 0, y: 0 }]);
    t.z.dropInventoryItem(1, 0, 'long_sword');
    t.z.moveInventoryItem(1, 0, 5, 5, 'long_sword');
    t.z.equip(1, 0, true, 'long_sword');
    expect(p.inventory).toEqual([{ slot: 0, itemId: 'healing_potion', equipped: false, x: 0, y: 0 }]);
    expect(t.dynamic()).toHaveLength(0);
  });

  it('a double equip click is not reported as a full bag', () => {
    const t = zone();
    const p = t.join(1, [{ slot: 0, itemId: 'long_sword', equipped: false }]);
    t.z.equip(1, 0, true, 'long_sword');
    t.z.equip(1, 0, true, 'long_sword');
    expect(p.inventory[0]!.equipped).toBe(true);
    expect(t.errors(1)).toHaveLength(0);
  });

  it('drops a worn weapon and picks it back up as the same item, carried', () => {
    const t = zone();
    const p = t.join(1);
    t.z.dropInventoryItem(1, 0, 'long_sword');
    expect(p.weapon.id).toBe('unarmed');
    expect(count(p.inventory, 'long_sword')).toBe(0);
    const [[id]] = t.dynamic() as [[number, unknown]];
    t.z.interact(1, id);
    expect(p.inventory.find((e) => e.itemId === 'long_sword')).toMatchObject({ equipped: false });
  });

  it('a dropped item keeps its identity when two catalog items share a name', () => {
    const items = new Map(BUILTIN_ITEMS);
    const blade = (id: string): ItemDef => ({ id, name: 'Blade', type: 'weapon', width: 1, height: 3, price: 0 });
    items.set('first_blade', blade('first_blade'));
    items.set('second_blade', blade('second_blade'));
    items.set('Blade', blade('second_blade'));
    const t = zone(items);
    const p = t.join(1, [{ slot: 0, itemId: 'first_blade', equipped: false }]);
    t.z.dropInventoryItem(1, 0);
    const [[id]] = t.dynamic() as [[number, unknown]];
    t.z.interact(1, id);
    expect(p.inventory.map((e) => e.itemId)).toEqual(['first_blade']);
  });

  it('unequips into the chosen free cell; an occupied cell leaves it worn without a full-bag error', () => {
    const t = zone();
    const p = t.join(1, [
      { slot: 0, itemId: 'long_sword', equipped: true },
      { slot: 1, itemId: 'wooden_shield', equipped: false, x: 0, y: 0 },
    ]);
    t.z.equip(1, 0, false, 'long_sword', { x: 1, y: 0 });
    expect(p.inventory[0]).toMatchObject({ equipped: true });
    expect(t.errors(1)).toHaveLength(0);
    t.z.equip(1, 0, false, 'long_sword', { x: 7, y: 3 });
    expect(p.inventory[0]).toMatchObject({ equipped: false, x: 7, y: 3 });
  });

  it('refuses bag changes during a scripted sequence and while dead', () => {
    const t = zone();
    const p = t.join(1);
    const before = structuredClone(p.inventory);
    p.cutscene = { sequence: { name: 'test' }, until: Number.MAX_SAFE_INTEGER };
    t.z.dropInventoryItem(1, 1);
    t.z.equip(1, 0, false);
    t.z.moveInventoryItem(1, 1, 5, 0);
    expect(p.inventory).toEqual(before);
    expect(t.dynamic()).toHaveLength(0);
  });

  it('a bag that cannot hold all of a chest takes none of it', () => {
    const t = zone();
    const p = t.join(1, FULL_BAG);
    const chest = () => t.sent(1).filter((m) => m.op === SC.OBJECT_STATE).flatMap((m) => m.d.objects).filter((o) => o.id === CHEST);
    t.z.interact(1, CHEST);
    expect(t.errors(1).at(-1)).toMatchObject({ d: { code: 'bag_full' } });
    expect(count(p.inventory, 'long_sword')).toBe(0);
    expect((p as unknown as { gold: number }).gold).toBe(0); // not even the gold
    expect(chest()).toHaveLength(0);
    t.z.dropInventoryItem(1, 1, 'scale_armor');
    t.z.interact(1, CHEST);
    expect(count(p.inventory, 'long_sword')).toBe(1);
    expect((p as unknown as { gold: number }).gold).toBe(5);
    expect(chest()).toEqual([expect.objectContaining({ state: 'open', loot: ['Long Sword', '5 Gold Pieces'] })]);
  });

  it('a door key goes to the key items even with a full bag, and cannot be dropped', () => {
    const items = new Map(BUILTIN_ITEMS);
    const key: ItemDef = { id: 'room_2_key', name: 'Room 2 Key', type: 'key', width: 1, height: 1, price: 0, model: 110, keyItem: true };
    items.set(key.id, key).set(key.name, key);
    const t = zone(items);
    t.internal.objects.get(CHEST)!.def = { id: CHEST, kind: 'chest', x: 0, y: 0, z: -0.5, contents: [{ name: 'Room 2 Key', quantity: 1 }] } as never;
    const p = t.join(1, FULL_BAG);
    t.z.interact(1, CHEST);
    expect(t.errors(1)).toHaveLength(0);
    const entry = p.inventory.find((e) => e.itemId === 'room_2_key')!;
    expect(entry.x).toBeUndefined();
    const view = t.sent(1).filter((m) => m.op === SC.INVENTORY_UPDATE).at(-1)!.d.items.find((i) => i.itemId === 'room_2_key');
    expect(view).toMatchObject({ keyItem: true });
    expect(view!.x).toBeUndefined();
    t.z.dropInventoryItem(1, entry.slot, 'room_2_key');
    expect(count(p.inventory, 'room_2_key')).toBe(1);
    expect(t.dynamic()).toHaveLength(0);
  });

  it("a kill's gold goes to the purse; its items lie at the corpse for the killer alone, 2 minutes", () => {

    const t = zone(new Map(BUILTIN_ITEMS), [{ name: 'Gold Pieces', quantity: 7 }, { name: 'Long Sword', quantity: 1 }, { name: 'Wooden Shield', quantity: 1 }]);
    const p = t.join(1);
    const other = t.join(2);
    const internal = t.z as unknown as { actors: Map<number, { kind: string }>; grantReward(p: unknown, m: unknown): { gold: number } };
    const mob = [...internal.actors.values()].find((a) => a.kind === 'mob')!;
    const swords = count(p.inventory, 'long_sword');
    expect(internal.grantReward(p, mob)).toEqual({ xp: expect.any(Number), gold: 7 });
    expect((p as unknown as { gold: number }).gold).toBe(7);
    expect(count(p.inventory, 'long_sword')).toBe(swords); // nothing goes into the bag
    const left = t.dynamic().map(([id]) => id);
    expect(left).toHaveLength(2);
    const sent = (c: number) => t.sent(c).filter((m) => m.op === SC.OBJECT_STATE).flatMap((m) => m.d.objects);
    expect(sent(1).filter((o) => left.includes(o.id)).map((o) => [o.def?.item?.name, o.def?.loose])).toEqual([['Long Sword', true], ['Wooden Shield', true]]);
    expect(sent(2).filter((o) => left.includes(o.id))).toHaveLength(0);
    // Both stand at the sword: the other player cannot take it, the killer can.
    const at = (t.internal.objects.get(left[0]!) as unknown as { def: { x: number; y: number; z: number } }).def;
    for (const q of [p, other]) Object.assign((q as unknown as { character: { position: object } }).character.position, { x: at.x, y: at.y, z: at.z });
    t.z.interact(2, left[0]!);
    expect(t.dynamic()).toHaveLength(2);
    t.z.interact(1, left[0]!);
    expect(count(p.inventory, 'long_sword')).toBe(swords + 1);
    expect(t.dynamic().map(([id]) => id)).toEqual([left[1]]);
    for (let i = 0; i < 20 * 60 * 2 + 20; i++) t.z.step();
    expect(t.dynamic()).toHaveLength(0);
    expect(sent(1).filter((o) => o.id === left[1]).map((o) => o.state)).toEqual(['present', 'gone']);
  });
});

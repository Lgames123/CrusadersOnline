import { describe, expect, it } from 'vitest';
import { addItem, BUILTIN_ITEMS, canPlaceGrid, catalogFromItemRules, firstFreeGridPosition, fitsGrid, INVENTORY_GRID, layoutInventoryGrid, layoutItemViews, layoutLegacyGrid, mergeInventoryStacks, moveInventoryGridItem, overlapsGrid, sanitizeInventory, setEquipped, splitInventoryStack, type InventoryEntry } from '@crusaders/shared';

describe('inventory grid geometry', () => {
  it('uses the original dimensions, including inherited fields from item rules', () => {
    expect(BUILTIN_ITEMS.get('long_sword')).toMatchObject({ width: 1, height: 3, model: 8 });
    expect(BUILTIN_ITEMS.get('wooden_shield')).toMatchObject({ width: 2, height: 2, model: 86 });
    expect(BUILTIN_ITEMS.get('scale_armor')).toMatchObject({ width: 2, height: 3, model: 80 });
    const catalog = catalogFromItemRules({ items: [
      { name: 'Base Sword', fields: { Type: 'WEAPON', SubType: 'MELEE', Width: 1, Height: 3, Model: 8, Price: 1 }, damage: {}, protection: {} },
      { name: 'Inherited Sword', fields: { Type: 'WEAPON', SubType: 'MELEE', Width: 1, Height: 3, Model: 9, Price: 2 }, damage: {}, protection: {} },
    ] });
    expect(catalog.get('inherited_sword')).toMatchObject({ width: 1, height: 3, model: 9 });
  });

  it('keeps the items.ctx Texture index that picks a potion colour from its model', () => {
    const catalog = catalogFromItemRules({ items: [
      { name: 'Healing Potion', fields: { Type: 'POTION', Use: 'HEAL', Model: 62, Texture: 2, Stackable: 'true' }, damage: {}, protection: {}, calls: [{ name: 'UseParameters', args: [10] }] },
      { name: 'Invisibility Potion', fields: { Type: 'POTION', Use: 'HEAL', Model: 62, Texture: 0, Stackable: 'true' }, damage: {}, protection: {}, calls: [{ name: 'UseParameters', args: [5] }] },
    ] });
    expect(catalog.get('healing_potion')).toMatchObject({ model: 62, texture: 2 });
    expect(catalog.get('invisibility_potion')!.texture).toBeUndefined();
  });

  it('door keys are key items: no bag cell, kept even when the bag is full', () => {
    const catalog = catalogFromItemRules({ items: [
      { name: 'Room 2 Key', fields: { Type: 'USEABLE', Model: 110, Width: 1, Height: 1 }, damage: {}, protection: {} },
      { name: 'Rune', fields: { Type: 'QUEST', Model: 105, Width: 1, Height: 1, Permanent: 'true' }, damage: {}, protection: {} },
    ] });
    expect(catalog.get('room_2_key')).toMatchObject({ type: 'key', keyItem: true, model: 110 });
    expect(catalog.get('rune')!.keyItem).toBeUndefined();
    const inv: InventoryEntry[] = Array.from({ length: 8 }, (_, i) => ({ slot: i, itemId: 'scale_armor', equipped: false, x: (i % 4) * 2, y: i < 4 ? 0 : 3 }));
    expect(addItem(inv, 'rune', 1, catalog)).toBeNull();
    const slot = addItem(inv, 'room_2_key', 1, catalog)!;
    expect(slot).toBe(8);
    expect(inv.find((e) => e.slot === slot)).toEqual({ slot, itemId: 'room_2_key', equipped: false });
    expect(layoutInventoryGrid(inv, catalog).has(slot)).toBe(false);
    expect(moveInventoryGridItem(inv, slot, 0, 0, catalog)).toBe(false);
    expect(sanitizeInventory([{ slot: 0, itemId: 'room_2_key', equipped: false, x: 3, y: 3 }], catalog)).toEqual([{ slot: 0, itemId: 'room_2_key', equipped: false }]);
    expect(layoutItemViews([{ slot: 0, keyItem: true, x: 0, y: 0 }, { slot: 1, x: 0, y: 0 }])).toEqual(new Map([[1, { x: 0, y: 0, width: 1, height: 1 }]]));
  });

  it('recognises the original sword, shield and armour shapes at the grid edges', () => {

    expect(fitsGrid(INVENTORY_GRID, { x: 7, y: 1, width: 1, height: 3 })).toBe(true); // sword 1×3
    expect(fitsGrid(INVENTORY_GRID, { x: 6, y: 4, width: 2, height: 2 })).toBe(true); // shield 2×2
    expect(fitsGrid(INVENTORY_GRID, { x: 6, y: 3, width: 2, height: 3 })).toBe(true); // armour 2×3
    expect(fitsGrid(INVENTORY_GRID, { x: 7, y: 2, width: 2, height: 3 })).toBe(false);
    expect(fitsGrid(INVENTORY_GRID, { x: 6, y: 4, width: 2, height: 3 })).toBe(false);
  });

  it('rejects overlapping placements and finds the next area that fits', () => {
    const sword = { x: 0, y: 0, width: 1, height: 3 };
    const shield = { x: 1, y: 0, width: 2, height: 2 };
    expect(overlapsGrid(sword, shield)).toBe(false);
    expect(canPlaceGrid(INVENTORY_GRID, { x: 0, y: 2, width: 2, height: 3 }, [sword, shield])).toBe(false);
    expect(firstFreeGridPosition({ columns: 3, rows: 3 }, { width: 2, height: 2 }, [sword])).toEqual({ x: 1, y: 0 });
  });

  it('lays out legacy records deterministically without overlap', () => {
    const placed = layoutLegacyGrid([{ width: 1, height: 3 }, { width: 2, height: 2 }, { width: 2, height: 3 }]);
    expect(placed).toEqual([
      { item: { width: 1, height: 3 }, x: 0, y: 0 },
      { item: { width: 2, height: 2 }, x: 1, y: 0 },
      { item: { width: 2, height: 3 }, x: 3, y: 0 },
    ]);
  });

  it('moves only a carried item into a server-valid empty rectangle', () => {
    const inv = [
      { slot: 0, itemId: 'long_sword', equipped: false, x: 0, y: 0 },
      { slot: 1, itemId: 'wooden_shield', equipped: false, x: 1, y: 0 },
      { slot: 2, itemId: 'scale_armor', equipped: true },
    ];
    expect(moveInventoryGridItem(inv, 0, 1, 0, BUILTIN_ITEMS)).toBe(false); // shield occupies it
    expect(moveInventoryGridItem(inv, 2, 4, 0, BUILTIN_ITEMS)).toBe(false); // equipped
    expect(moveInventoryGridItem(inv, 0, 3, 0, BUILTIN_ITEMS)).toBe(true);
    expect(inv[0]).toMatchObject({ x: 3, y: 0 });
    expect(layoutInventoryGrid(inv, BUILTIN_ITEMS).get(0)).toMatchObject({ x: 3, y: 0, width: 1, height: 3 });
  });

  it('merges only compatible carried stacks without exceeding 99', () => {
    const inv = [{ slot: 0, itemId: 'healing_potion', equipped: false, quantity: 40 }, { slot: 1, itemId: 'healing_potion', equipped: false, quantity: 50 }];
    expect(mergeInventoryStacks(inv, 0, 1, BUILTIN_ITEMS)).toBe(true);
    expect(inv).toEqual([{ slot: 1, itemId: 'healing_potion', equipped: false, quantity: 90 }]);
    inv.push({ slot: 2, itemId: 'healing_potion', equipped: false, quantity: 10 });
    expect(mergeInventoryStacks(inv, 2, 1, BUILTIN_ITEMS)).toBe(false);
  });

  it('splits only when a new stack and its full rectangle fit', () => {
    const inv = [{ slot: 0, itemId: 'healing_potion', equipped: false, quantity: 9, x: 0, y: 0 }];
    expect(splitInventoryStack(inv, 0, 4, BUILTIN_ITEMS)).toBe(true);
    expect(inv).toEqual([
      { slot: 0, itemId: 'healing_potion', equipped: false, quantity: 5, x: 0, y: 0 },
      { slot: 1, itemId: 'healing_potion', equipped: false, quantity: 4, x: 1, y: 0 },
    ]);
    expect(splitInventoryStack(inv, 0, 5, BUILTIN_ITEMS)).toBe(false);
  });

  it('reserves space and swaps atomically when equipping and unequipping', () => {
    const inv = [
      { slot: 0, itemId: 'long_sword', equipped: true },
      { slot: 1, itemId: 'axe', equipped: false, x: 0, y: 0 },
    ];
    expect(setEquipped(inv, 1, true, BUILTIN_ITEMS)).toBe(true);
    expect(inv.find((e) => e.slot === 1)?.equipped).toBe(true);
    expect(inv.find((e) => e.slot === 0)?.equipped).toBe(false);
    expect(inv.find((e) => e.slot === 0)?.x).toBe(0);
    expect(inv.find((e) => e.slot === 0)?.y).toBe(0);

    expect(setEquipped(inv, 1, false, BUILTIN_ITEMS)).toBe(true);
    expect(inv.find((e) => e.slot === 1)?.equipped).toBe(false);

    // Full bag rejecting unequip of 2x3 scale_armor
    const packed = [
      { slot: 0, itemId: 'scale_armor', equipped: true },
      ...Array.from({ length: 48 }, (_, i) => ({
        slot: i + 1,
        itemId: 'healing_potion',
        equipped: false,
        x: i % 8,
        y: Math.floor(i / 8),
      })),
    ];
    expect(setEquipped(packed, 0, false, BUILTIN_ITEMS)).toBe(false);
    expect(packed[0]?.equipped).toBe(true);
  });

  it('allocates grid origins on addItem and rejects when no rectangle fits', () => {
    const inv: any[] = [];
    expect(addItem(inv, 'long_sword', 1, BUILTIN_ITEMS)).toBe(0);
    expect(inv[0]).toMatchObject({ slot: 0, itemId: 'long_sword', x: 0, y: 0 });
    expect(addItem(inv, 'long_sword', 1, BUILTIN_ITEMS)).toBe(1);
    expect(inv[1]).toMatchObject({ slot: 1, itemId: 'long_sword', x: 1, y: 0 });
  });

  it('preserves saved coordinates in pass 1 regardless of slot order', () => {
    // Slot 0 has no saved coordinates; Slot 1 has saved x: 0, y: 0.
    // In pass 1, Slot 1 gets (0, 0); in pass 2, Slot 0 gets placed in the first free spot (1, 0).
    const inv = [
      { slot: 0, itemId: 'healing_potion', equipped: false },
      { slot: 1, itemId: 'healing_potion', equipped: false, x: 0, y: 0 },
    ];
    const layout = layoutInventoryGrid(inv, BUILTIN_ITEMS);
    expect(layout.get(1)).toMatchObject({ x: 0, y: 0 });
    expect(layout.get(0)).toMatchObject({ x: 1, y: 0 });
  });

  it('swaps equipped items only when the unequipped item fits the remaining space', () => {
    // Long sword is 1x3, Battle axe is 1x3. They swap cleanly.
    const inv = [
      { slot: 0, itemId: 'long_sword', equipped: true },
      { slot: 1, itemId: 'battle_axe', equipped: false, x: 0, y: 0 },
    ];
    expect(setEquipped(inv, 1, true, BUILTIN_ITEMS)).toBe(true);
    expect(inv.find((e) => e.slot === 1)?.equipped).toBe(true);
    expect(inv.find((e) => e.slot === 0)?.equipped).toBe(false);
    expect(inv.find((e) => e.slot === 0)?.x).toBe(0);
    expect(inv.find((e) => e.slot === 0)?.y).toBe(0);
  });

  it('lays out item views without double-counting and allows unequipping 2x3 armor when space exists', () => {
    // 14 items matching the user screenshot exactly:
    const items = [
      { slot: 0, x: 0, y: 0, width: 1, height: 3, equipped: false },
      { slot: 1, x: 1, y: 0, width: 1, height: 3, equipped: false },
      { slot: 2, x: 2, y: 0, width: 1, height: 3, equipped: false },
      { slot: 3, x: 3, y: 0, width: 1, height: 3, equipped: false },
      { slot: 4, x: 4, y: 0, width: 1, height: 1, equipped: false },
      { slot: 5, x: 5, y: 0, width: 1, height: 1, equipped: false },
      { slot: 6, x: 6, y: 0, width: 1, height: 1, equipped: false },
      { slot: 7, x: 7, y: 0, width: 1, height: 1, equipped: false },
      { slot: 8, x: 4, y: 1, width: 1, height: 1, equipped: false },
      { slot: 9, x: 6, y: 1, width: 1, height: 1, equipped: false },
      { slot: 10, x: 7, y: 1, width: 1, height: 1, equipped: false },
      { slot: 11, x: 5, y: 2, width: 1, height: 3, equipped: false },
      { slot: 12, x: 0, y: 3, width: 1, height: 3, equipped: false },
      { slot: 13, x: 1, y: 3, width: 1, height: 3, equipped: false },
      // Equipped armor (2x3)
      { slot: 14, width: 2, height: 3, equipped: true },
    ];

    const layout = layoutItemViews(items);
    expect(layout.size).toBe(14);
    const occupied = [...layout.values()];
    expect(occupied.length).toBe(14);

    const armorPlacement = firstFreeGridPosition(INVENTORY_GRID, { width: 2, height: 3 }, occupied);
    expect(armorPlacement).toEqual({ x: 6, y: 2 });
  });
});


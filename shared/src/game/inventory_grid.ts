import type { InventoryEntry, ItemCatalog } from './items.ts';

/** Pure geometry helpers for the visual inventory grid. */

export interface GridSize { columns: number; rows: number; }
export interface GridShape { width: number; height: number; }
export interface GridPlacement extends GridShape { x: number; y: number; }

export const INVENTORY_GRID: Readonly<GridSize> = { columns: 8, rows: 6 };

function positive(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

export function fitsGrid(size: GridSize, placement: GridPlacement): boolean {
  return positive(size.columns) && positive(size.rows) && positive(placement.width) && positive(placement.height)
    && Number.isInteger(placement.x) && Number.isInteger(placement.y)
    && placement.x >= 0 && placement.y >= 0
    && placement.x + placement.width <= size.columns && placement.y + placement.height <= size.rows;
}

export function overlapsGrid(a: GridPlacement, b: GridPlacement): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function canPlaceGrid(size: GridSize, placement: GridPlacement, occupied: readonly GridPlacement[]): boolean {
  return fitsGrid(size, placement) && !occupied.some((other) => overlapsGrid(placement, other));
}

/** First vacant origin in reading order, or null when the rectangle cannot fit. */
export function firstFreeGridPosition(size: GridSize, shape: GridShape, occupied: readonly GridPlacement[]): { x: number; y: number } | null {
  for (let y = 0; y < size.rows; y++) for (let x = 0; x < size.columns; x++) {
    if (canPlaceGrid(size, { x, y, ...shape }, occupied)) return { x, y };
  }
  return null;
}

/**
 * Converts legacy one-cell slot records into a deterministic, non-overlapping visual layout.
 * It is deliberately presentation-only until x/y are persisted by a later migration.
 */
export function layoutLegacyGrid<T extends GridShape>(items: readonly T[], size: GridSize = INVENTORY_GRID): ({ item: T; x: number; y: number } | null)[] {
  const occupied: GridPlacement[] = [];
  return items.map((item) => {
    const at = firstFreeGridPosition(size, item, occupied);
    if (!at) return null;
    occupied.push({ ...at, width: item.width, height: item.height });
    return { item, ...at };
  });
}

export function layoutInventoryGrid(inv: readonly InventoryEntry[], catalog: ItemCatalog, size: GridSize = INVENTORY_GRID): ReadonlyMap<number, GridPlacement> {
  const out = new Map<number, GridPlacement>();
  const occupied: GridPlacement[] = [];
  const unplaced: { entry: InventoryEntry; width: number; height: number }[] = [];
  const bag = [...inv].filter((e) => !e.equipped).sort((a, b) => a.slot - b.slot);

  // Pass 1: Keep authoritative saved coordinates first
  for (const entry of bag) {
    const def = catalog.get(entry.itemId);
    if (!def || def.keyItem) continue; // key items live on their own page, not in the bag
    const saved = entry.x === undefined || entry.y === undefined ? null : { x: entry.x, y: entry.y, width: def.width, height: def.height };
    if (saved && canPlaceGrid(size, saved, occupied)) {
      occupied.push(saved);
      out.set(entry.slot, saved);
    } else {
      unplaced.push({ entry, width: def.width, height: def.height });
    }
  }

  // Pass 2: Pack pre-migration or displaced records into the first free positions
  for (const { entry, width, height } of unplaced) {
    const at = firstFreeGridPosition(size, { width, height }, occupied);
    if (!at) continue;
    const placement = { ...at, width, height };
    occupied.push(placement);
    out.set(entry.slot, placement);
  }

  return out;
}

export interface ItemViewLike {
  slot: number;
  width?: number;
  height?: number;
  equipped?: boolean;
  keyItem?: boolean;
  x?: number;
  y?: number;
}

/** Lays out pre-dimensioned item views deterministically, matching layoutInventoryGrid without needing catalog lookup. */
export function layoutItemViews<T extends ItemViewLike>(items: readonly T[], size: GridSize = INVENTORY_GRID): Map<number, GridPlacement> {
  const out = new Map<number, GridPlacement>();
  const occupied: GridPlacement[] = [];
  const unplaced: { item: T; width: number; height: number }[] = [];
  const bag = [...items].filter((item) => !item.equipped && !item.keyItem).sort((a, b) => a.slot - b.slot);


  for (const item of bag) {
    const width = Math.max(1, item.width ?? 1), height = Math.max(1, item.height ?? 1);
    const saved = item.x === undefined || item.y === undefined ? null : { x: item.x, y: item.y, width, height };
    if (saved && canPlaceGrid(size, saved, occupied)) {
      occupied.push(saved);
      out.set(item.slot, saved);
    } else {
      unplaced.push({ item, width, height });
    }
  }

  for (const { item, width, height } of unplaced) {
    const at = firstFreeGridPosition(size, { width, height }, occupied);
    if (!at) continue;
    const placement = { ...at, width, height };
    occupied.push(placement);
    out.set(item.slot, placement);
  }

  return out;
}

/** Moves a carried item only if its full rectangle fits; equipped items are not movable. */
export function moveInventoryGridItem(inv: InventoryEntry[], slot: number, x: number, y: number, catalog: ItemCatalog, size: GridSize = INVENTORY_GRID): boolean {
  const entry = inv.find((e) => e.slot === slot);
  const def = entry && catalog.get(entry.itemId);
  if (!entry || !def || entry.equipped) return false;
  const layout = layoutInventoryGrid(inv, catalog, size);
  if (!layout.has(slot)) return false;
  const occupied = [...layout].filter(([other]) => other !== slot).map(([, placement]) => placement);
  const next = { x, y, width: def.width, height: def.height };
  if (!canPlaceGrid(size, next, occupied)) return false;
  entry.x = x;
  entry.y = y;
  return true;
}

import { describe, expect, it } from 'vitest';
import { SpatialHashGrid } from '@crusaders/shared';

describe('SpatialHashGrid', () => {
  it('finds nearby entities and excludes far ones', () => {
    const g = new SpatialHashGrid(32);
    g.update(1, 0, 0);
    g.update(2, 40, 10);
    g.update(3, 500, 500);
    g.update(4, -10, -60);
    const out: number[] = [];
    const n = g.queryRadius(0, 0, 64, out);
    expect(out.slice(0, n).sort()).toEqual([1, 2, 4]);
  });

  it('moves entities between cells and removes them', () => {
    const g = new SpatialHashGrid(32);
    g.update(7, 0, 0);
    g.update(7, 300, 300);
    const out: number[] = [];
    expect(g.queryRadius(0, 0, 10, out)).toBe(0);
    expect(g.queryRadius(300, 300, 10, out)).toBe(1);
    g.remove(7);
    expect(g.queryRadius(300, 300, 10, out)).toBe(0);
    expect(g.size).toBe(0);
  });

  it('handles negative coordinates', () => {
    const g = new SpatialHashGrid(32);
    g.update(1, -1, -1);
    g.update(2, 1, 1);
    const out: number[] = [];
    expect(g.queryRadius(-1, -1, 1, out)).toBe(2);
  });
});

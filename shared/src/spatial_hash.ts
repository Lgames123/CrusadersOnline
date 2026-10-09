const OFFSET = 1 << 15; // cell coordinates in [-32768, 32767]

function cellKey(cx: number, cz: number): number {
  return (cx + OFFSET) * 65536 + (cz + OFFSET);
}

/**
 * 2D uniform grid on the XZ plane for interest management and AI proximity.
 * Integer keys and caller-provided output arrays keep queries allocation-free.
 */
export class SpatialHashGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly entityCell = new Map<number, number>();
  readonly cellSize: number;

  constructor(cellSize = 32) {
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.entityCell.size;
  }

  private keyFor(x: number, z: number): number {
    return cellKey(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
  }

  /** Inserts or moves an entity. Cheap when the entity stays in the same cell. */
  update(id: number, x: number, z: number): void {
    const key = this.keyFor(x, z);
    const prev = this.entityCell.get(id);
    if (prev === key) return;
    if (prev !== undefined) this.detach(id, prev);
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = []));
    cell.push(id);
    this.entityCell.set(id, key);
  }

  remove(id: number): void {
    const prev = this.entityCell.get(id);
    if (prev === undefined) return;
    this.detach(id, prev);
    this.entityCell.delete(id);
  }

  private detach(id: number, key: number): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    const i = cell.indexOf(id);
    if (i >= 0) {
      cell[i] = cell[cell.length - 1]!;
      cell.pop();
    }
    if (cell.length === 0) this.cells.delete(key);
  }

  /**
   * Writes the ids of entities in all cells overlapping the square of half-size `radius`
   * around (x, z) into `out` and returns how many were written. Callers filter by exact distance.
   */
  queryRadius(x: number, z: number, radius: number, out: number[]): number {
    const s = this.cellSize;
    const minX = Math.floor((x - radius) / s), maxX = Math.floor((x + radius) / s);
    const minZ = Math.floor((z - radius) / s), maxZ = Math.floor((z + radius) / s);
    let n = 0;
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const cell = this.cells.get(cellKey(cx, cz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) out[n++] = cell[i]!;
      }
    }
    return n;
  }
}

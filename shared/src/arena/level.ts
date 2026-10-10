import type { ArenaDef, TriMeshDef, WorldObjectDef } from './types.ts';

/**
 * Arenas built from an original level converted from the user's own installation
 * (converter: levels/<mesh>.collision.bin + levels/<act>.placements.json). Server and client
 * build them from the same bytes with these functions, so collision, spawn points and mob
 * placements are identical on both sides (prediction depends on it).
 */

/** Original world units are feet (asset-format-discovery.md §6.3); the simulation uses metres. */
export const LEVEL_UNIT_METRES = 0.3048;

/** Arena names of the form "level:<act>", e.g. "level:ca1a" (Caps/Ca1a.cap on Meshes/Ca_a.msh). */
export const LEVEL_PREFIX = 'level:';

export interface LevelCreature {
  type: number;
  name: string;
  /** Original units, Z already mirrored (glTF space). */
  position: [number, number, number];
  hp: number;
  xp: number;
  disposition: number;
  resist: number[];
}

export interface LevelObject {
  kind: 'prop' | 'item' | 'sprite' | 'chest' | 'flag';
  name: string;
  modelId: number;
  /** Original units, Z mirrored. */
  position: [number, number, number];
  /** Row-major 3x3, mirrored. */
  rotation: number[];
  hp: number;
  item?: { name: string; quantity: number };
  contents?: { name: string; quantity: number }[];
  effect?: string;
  /** Converted model file (relative to the converter output), when available. */
  model?: string;
}

export interface LevelPlacements {
  /** Lower-case mesh name, e.g. "ca_a". */
  mesh: string;
  creatures: LevelCreature[];
  objects?: LevelObject[];
}

/** Creature type ids (creature template table) that the slice can spawn, by archetype. */
export const LEVEL_ARCHETYPES: Readonly<Record<number, string>> = { 143: 'dark_mage', 145: 'skeleton_warrior', 146: 'skeleton_ghost', 147: 'shadow' };

/** Hostile disposition in the placement records. */
const HOSTILE = 3;

/** Parses "COL1" collision data (original units) into a metre-scale triangle mesh. */
export function parseLevelCollision(bytes: Uint8Array): TriMeshDef {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || dv.getUint32(0, true) !== 0x314c4f43) throw new Error('not a COL1 collision file');
  const nv = dv.getUint32(4, true);
  const nt = dv.getUint32(8, true);
  if (12 + nv * 12 + nt * 12 !== bytes.byteLength) throw new Error('collision file size mismatch');
  const vertices = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) vertices[i] = dv.getFloat32(12 + 4 * i, true) * LEVEL_UNIT_METRES;
  const indices = new Uint32Array(nt * 3);
  const io = 12 + nv * 12;
  for (let i = 0; i < nt * 3; i++) {
    const v = dv.getUint32(io + 4 * i, true);
    if (v >= nv) throw new Error('collision index out of range');
    indices[i] = v;
  }
  return { vertices, indices };
}

/**
 * Player spawn candidates: up-facing floor triangles of at least 1 m², 12–25 m (horizontally)
 * from the nearest hostile and within 2 m of its height (same floor). Deterministic: ordered by
 * area, then index. Falls back to the largest floor triangles.
 */
function spawnPoints(mesh: TriMeshDef, hostiles: { x: number; y: number; z: number }[], count: number): { x: number; y: number; z: number }[] {
  const v = mesh.vertices, ix = mesh.indices;
  const cand: { x: number; y: number; z: number; area: number; ok: boolean; i: number }[] = [];
  for (let t = 0; t < ix.length / 3; t++) {
    const a = 3 * ix[3 * t]!, b = 3 * ix[3 * t + 1]!, c = 3 * ix[3 * t + 2]!;
    const ux = v[b]! - v[a]!, uy = v[b + 1]! - v[a + 1]!, uz = v[b + 2]! - v[a + 2]!;
    const wx = v[c]! - v[a]!, wy = v[c + 1]! - v[a + 1]!, wz = v[c + 2]! - v[a + 2]!;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0 || ny / len < 0.95) continue;
    const area = len / 2;
    if (area < 1) continue;
    const x = (v[a]! + v[b]! + v[c]!) / 3, y = (v[a + 1]! + v[b + 1]! + v[c + 1]!) / 3, z = (v[a + 2]! + v[b + 2]! + v[c + 2]!) / 3;
    let nearest = Infinity;
    for (const h of hostiles) {
      if (Math.abs(h.y - y) > 2) continue;
      nearest = Math.min(nearest, Math.hypot(h.x - x, h.z - z));
    }
    cand.push({ x, y, z, area, ok: nearest >= 12 && nearest <= 25, i: t });
  }
  const pick = (list: typeof cand) => [...list].sort((p, q) => q.area - p.area || p.i - q.i).slice(0, count);
  const good = pick(cand.filter((c) => c.ok));
  return (good.length ? good : pick(cand)).map((c) => ({ x: c.x, y: c.y + 0.1, z: c.z }));
}

export function buildLevelArena(name: string, collision: Uint8Array, placements: LevelPlacements): ArenaDef {
  const mesh = parseLevelCollision(collision);
  const s = LEVEL_UNIT_METRES;
  const hostiles = placements.creatures
    .filter((c) => c.disposition === HOSTILE)
    .map((c) => ({ x: c.position[0] * s, y: c.position[1] * s, z: c.position[2] * s }));
  const mobSpawns: ArenaDef['mobSpawns'] = [];
  for (const c of placements.creatures) {
    const archetype = LEVEL_ARCHETYPES[c.type];
    if (!archetype || c.disposition !== HOSTILE || !(c.hp > 0)) continue;
    mobSpawns.push({
      archetype,
      x: c.position[0] * s,
      y: c.position[1] * s + 0.1,
      z: c.position[2] * s,
      hp: c.hp,
      xp: c.xp,
      resist: c.resist,
    });
  }
  const objects: WorldObjectDef[] = [];
  (placements.objects ?? []).forEach((o, id) => {
    const at = { x: o.position[0] * s, y: o.position[1] * s, z: o.position[2] * s };
    if (o.kind === 'item' && o.item) objects.push({ id, kind: 'item', ...at, item: o.item });
    else if (o.kind === 'chest') objects.push({ id, kind: 'chest', ...at, contents: o.contents ?? [] });
    else if (o.kind === 'prop' && o.hp > 0) objects.push({ id, kind: 'breakable', ...at, hp: o.hp });
  });
  return { name, boxes: [], meshes: [mesh], spawnPoints: spawnPoints(mesh, hostiles, 8), mobSpawns, objects };
}

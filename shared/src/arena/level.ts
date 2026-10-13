import { doorSwingFromMotion, type LevelBrushMotion } from './door_swing.ts';
import { CREATURE_TEMPLATES, npcArchetypeId } from '../game/creatures.ts';
import type { ArenaDef, BrushDef, PortalDef, TriMeshDef, WorldObjectDef } from './types.ts';

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

export interface LevelPortal {
  exit: number;
  /** Lower-case destination act, e.g. "ca1b". */
  target: string;
  /** Original units, Z mirrored. */
  position: [number, number, number];
  /** Trigger volume (original units, Z mirrored), when the cap links one. */
  trigger?: { polygon: [number, number][]; yMin: number; yMax: number };
  /** A door exit: taken with the interact key, not by walking in (portal record flag 8). */
  use?: boolean;
}

/** World-object ids of door exits (interact key): this base + the portal id. */
export const PORTAL_OBJECT_BASE = 900_000;
/** How close to a door exit's trigger the interact key reaches, metres. */
export const PORTAL_USE_REACH = 1.5;

/** A brush (cap class 0x31): name and vertices (original units, Z mirrored; the first is the pivot). */
export interface LevelBrush {
  name: string;
  points: [number, number, number][];
  /** Textured polygons: indices into `points`, texel coordinates (×32 texels) per vertex. */
  faces?: { texture: string; indices: number[]; texels: number[] }[];
  /** Its keyframe mover (doors, gates, lifts...). */
  motion?: LevelBrushMotion;
}

/** Door world-object ids start here (placement indices stay below). */
export const DOOR_OBJECT_BASE = 500_000;
/** Brushes that are doors (open with the interact key). */
export const DOOR_BRUSH = /door|gate/i;
/** Levers (Tab pulls them); in an act with levers its gates open by lever only (Ws1a/5a/9a). */
const LEVER_BRUSH = /lever/i;
const LEVER_GATE = /gate/i;
/** Brushes that block movement: doors and the walkable pieces. */
const SOLID_BRUSH = /door|gate|bridge|plat/i;
/**
 * Locked doors and their keys. Not the original's door scripting (not decoded): the keys placed
 * in the acts paired with the door they most plausibly open (Fain's Key next to the train's
 * final door; the inn's room keys).
 */
export const DOOR_LOCKS: readonly { act: RegExp; brush: string; key: string }[] = [
  { act: /^train$/, brush: 'bfinaldoor', key: "Fain's Key" },
  { act: /^cs1b-inn$/, brush: 'bDoorE_4', key: 'Room 2 Key' },
  { act: /^cs1b-inn$/, brush: 'bDoorE_5', key: 'Room 3 Key' },
];

export interface LevelPlacements {
  /** Lower-case mesh name, e.g. "ca_a". */
  mesh: string;
  creatures: LevelCreature[];
  objects?: LevelObject[];
  portals?: LevelPortal[];
  /** Music track (Music/<n>.mp3, the original CD track number); absent = silence. */
  music?: number;
  brushes?: LevelBrush[];
}

/** Horizontal radius / height of a portal trigger without a volume, metres (slice values). */
export const PORTAL_RADIUS = 1.6;
export const PORTAL_HEIGHT = 2.5;

/** Whether a point (feet, metres) is inside a portal's trigger: its volume, else the slice cylinder. */
export function inPortal(portal: PortalDef, pos: { x: number; y: number; z: number }, margin = 0): boolean {
  const t = portal.trigger;
  if (!t) return Math.hypot(portal.x - pos.x, portal.z - pos.z) <= PORTAL_RADIUS + margin && Math.abs(portal.y - pos.y) <= PORTAL_HEIGHT;
  if (pos.y < t.yMin - 0.5 || pos.y > t.yMax) return false;
  // Crossing test, then the margin as distance to the nearest edge.
  let inside = false;
  let nearest = Infinity;
  const poly = t.polygon;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > pos.z !== zj > pos.z && pos.x < ((xj - xi) * (pos.z - zi)) / (zj - zi) + xi) inside = !inside;
    const ex = xj - xi, ez = zj - zi;
    const len2 = ex * ex + ez * ez || 1;
    const k = Math.max(0, Math.min(1, ((pos.x - xi) * ex + (pos.z - zi) * ez) / len2));
    nearest = Math.min(nearest, Math.hypot(pos.x - (xi + k * ex), pos.z - (zi + k * ez)));
  }
  return inside || nearest <= margin;
}

/**
 * Where a player arriving from `fromArena` appears: on the floor next to this arena's portal
 * that leads back there, outside its trigger, else the first spawn point. The original's exit
 * triggers often sit at the dark end of a corridor, past the last floor polygon, so the nearest
 * floor around the trigger (with head room) is searched on the level mesh.
 */
export function arrivalPoint(arena: ArenaDef, fromArena: string | undefined): { x: number; y: number; z: number } {
  const back = fromArena ? arena.portals?.find((p) => p.target === fromArena) : undefined;
  const fallback = arena.spawnPoints[0] ?? { x: 0, y: 1, z: 0 };
  if (!back) return fallback;
  return floorNear(arena, back) ?? fallback;
}

/** Arrival search: ring radii (metres from the trigger centre), directions, height window. */
const ARRIVAL_RINGS = [0, 0.5, 1, 1.5, 2.5, 3.5, 5, 7, 9.5, 12, 15, 18];
const ARRIVAL_DIRECTIONS = 24;
const ARRIVAL_MAX_DROP = 8;
// Some exit triggers hang below the floor, at the bottom of a drop (Ca1a -> Ca1b): floors up to 12 m above count.
const ARRIVAL_MAX_RISE = 12;
/** Head room needed above the floor (a standing character). */
const ARRIVAL_HEADROOM = 1.9;

/** Candidate arrival points `r` metres outside a portal's trigger (around its polygon, else its circle). */
function ringAround(portal: PortalDef, r: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const poly = portal.trigger?.polygon;
  if (!poly) {
    for (let k = 0; k < ARRIVAL_DIRECTIONS; k++) {
      const ang = (k / ARRIVAL_DIRECTIONS) * Math.PI * 2;
      out.push({ x: portal.x + Math.cos(ang) * (PORTAL_RADIUS + 0.8 + r), z: portal.z + Math.sin(ang) * (PORTAL_RADIUS + 0.8 + r) });
    }
    return out;
  }
  // Along each edge (every metre), pushed out along its outward normal.
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const d = 0.8 + r;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]!;
    const [x2, z2] = poly[(i + 1) % poly.length]!;
    const len = Math.hypot(x2 - x1, z2 - z1) || 1;
    let nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
    // Outward: away from the centroid (the polygon is convex).
    if (((x1 + x2) / 2 - cx) * nx + ((z1 + z2) / 2 - cz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const steps = Math.max(1, Math.ceil(len));
    for (let k = 0; k <= steps; k++) out.push({ x: x1 + ((x2 - x1) * k) / steps + nx * d, z: z1 + ((z2 - z1) * k) / steps + nz * d });
  }
  return out.filter((p) => !inPortal(portal, { x: p.x, y: portal.trigger!.yMin, z: p.z }));
}

/**
 * The closest point (by ring, then smallest drop) outside the portal's trigger that has a
 * walkable floor below within the height window and nothing overhead for ARRIVAL_HEADROOM.
 * Pure geometry on the collision mesh, so server and tests agree.
 */
function floorNear(arena: ArenaDef, portal: PortalDef): { x: number; y: number; z: number } | null {
  // Height reference: the trigger's floor when it has a volume.
  const at = { x: portal.x, y: portal.trigger ? portal.trigger.yMin : portal.y, z: portal.z };
  const extent = portal.trigger ? Math.max(...portal.trigger.polygon.map(([x, z]) => Math.hypot(x - portal.x, z - portal.z))) : PORTAL_RADIUS;
  const mesh = arena.meshes[0];
  if (!mesh) return null;
  const v = mesh.vertices;
  const idx = mesh.indices;
  // Triangles near the search area, with their walkability.
  const reach = extent + ARRIVAL_RINGS[ARRIVAL_RINGS.length - 1]! + 2;
  const tris: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
    const minX = Math.min(v[a]!, v[b]!, v[c]!), maxX = Math.max(v[a]!, v[b]!, v[c]!);
    const minZ = Math.min(v[a + 2]!, v[b + 2]!, v[c + 2]!), maxZ = Math.max(v[a + 2]!, v[b + 2]!, v[c + 2]!);
    const minY = Math.min(v[a + 1]!, v[b + 1]!, v[c + 1]!);
    if (maxX < at.x - reach || minX > at.x + reach || maxZ < at.z - reach || minZ > at.z + reach) continue;
    if (minY > at.y + ARRIVAL_MAX_RISE + ARRIVAL_HEADROOM + 1) continue;
    tris.push(t);
  }
  /** Heights of the triangles over (x, z), and whether each is walkable (normal mostly up). */
  const column = (x: number, z: number) => {
    const out: { y: number; floor: boolean }[] = [];
    for (const t of tris) {
      const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
      const ax = v[a]!, az = v[a + 2]!, bx = v[b]!, bz = v[b + 2]!, cx = v[c]!, cz = v[c + 2]!;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const y = w0 * v[a + 1]! + w1 * v[b + 1]! + w2 * v[c + 1]!;
      // Normal's vertical share.
      const ux = bx - ax, uy = v[b + 1]! - v[a + 1]!, uz = bz - az;
      const vx = cx - ax, vy = v[c + 1]! - v[a + 1]!, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      out.push({ y, floor: Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1) > 0.7 });
    }
    return out;
  };
  for (const r of ARRIVAL_RINGS) {
    let best: { x: number; y: number; z: number; drop: number } | null = null;
    for (const { x, z } of ringAround(portal, r)) {
      const col = column(x, z);
      // Highest walkable floor within the window, then head room above it.
      let floor = -Infinity;
      for (const h of col) if (h.floor && h.y <= at.y + ARRIVAL_MAX_RISE && h.y >= at.y - ARRIVAL_MAX_DROP && h.y > floor) floor = h.y;
      if (floor === -Infinity) continue;
      if (col.some((h) => h.y > floor + 0.2 && h.y < floor + ARRIVAL_HEADROOM)) continue;
      const drop = Math.abs(at.y - floor);
      if (!best || drop < best.drop) best = { x, y: floor + 0.1, z, drop };
    }
    if (best) return { x: best.x, y: best.y, z: best.z };
  }
  return null;
}

/** Creature type ids (creature template table) that the slice can spawn, by archetype. */
export const LEVEL_ARCHETYPES: Readonly<Record<number, string>> = {
  116: 'black_knight',
  124: 'dwarf_rebel',
  125: 'dwarf_zealot',
  131: 'ogre_outlaw',
  133: 'dasher_brute',
  134: 'deceiver',
  135: 'ice_titan',
  143: 'dark_mage',
  144: 'dark_master',
  145: 'skeleton_warrior',
  146: 'skeleton_ghost',
  147: 'shadow',
};

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
 * Player spawn candidates: up-facing floor triangles of at least 1 m², at least 15 m
 * (horizontally) from every hostile on any floor, and within 30 m of one on the same floor
 * (|dy| <= 2 m), so the player starts near the action but out of reach. Deterministic: ordered
 * by area, then index. Falls back to the largest floor triangles.
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
    let nearestAny = Infinity;
    let nearestSameFloor = Infinity;
    for (const h of hostiles) {
      const d = Math.hypot(h.x - x, h.z - z);
      nearestAny = Math.min(nearestAny, d);
      if (Math.abs(h.y - y) <= 2) nearestSameFloor = Math.min(nearestSameFloor, d);
    }
    cand.push({ x, y, z, area, ok: nearestAny >= 15 && nearestSameFloor <= 30, i: t });
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
    // Citizens, guards, merchants (dispositions 0-2): peaceful, standing at their place.
    if (c.disposition >= 0 && c.disposition < HOSTILE && CREATURE_TEMPLATES[c.type]) {
      mobSpawns.push({
        archetype: npcArchetypeId(c.type),
        x: c.position[0] * s,
        y: c.position[1] * s + 0.1,
        z: c.position[2] * s,
        ...(c.hp > 0 ? { hp: c.hp } : {}),
        // Citizens (disposition 1) stroll about their place; guards and merchants stand.
        ...(c.disposition === 1 ? { wander: true } : {}),
      });
      continue;
    }
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
  const portals: PortalDef[] = (placements.portals ?? []).map((p, id) => ({
    id,
    target: `${LEVEL_PREFIX}${p.target}`,
    x: p.position[0] * s,
    y: p.position[1] * s,
    z: p.position[2] * s,
    ...(p.use ? { use: true } : {}),
    ...(p.trigger ? { trigger: { polygon: p.trigger.polygon.map(([x, z]) => [x * s, z * s] as [number, number]), yMin: p.trigger.yMin * s, yMax: p.trigger.yMax * s } } : {}),
  }));
  const act = name.slice(LEVEL_PREFIX.length);
  const brushes: BrushDef[] = [];
  (placements.brushes ?? []).forEach((b, i) => {
    // Drop the pivot (first vertex): the rest are the piece's corners.
    const pts = b.points.length > 4 ? b.points.slice(1) : b.points;
    const points = new Float32Array(pts.flatMap((p) => [p[0] * s, p[1] * s, p[2] * s]));
    const brush: BrushDef = { name: b.name, points, solid: SOLID_BRUSH.test(b.name) };
    const swing = b.motion ? doorSwingFromMotion(b.motion, s) : null;
    if (swing && DOOR_BRUSH.test(b.name)) brush.swing = swing;
    const lever = LEVER_BRUSH.test(b.name);
    if (DOOR_BRUSH.test(b.name) || lever) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < points.length; k++) {
        min[k % 3] = Math.min(min[k % 3]!, points[k]!);
        max[k % 3] = Math.max(max[k % 3]!, points[k]!);
      }
      const id = DOOR_OBJECT_BASE + i;
      const lock = DOOR_LOCKS.find((l) => l.act.test(act) && l.brush === b.name)?.key;
      objects.push({
        id,
        kind: lever ? 'lever' : 'door',
        x: (min[0]! + max[0]!) / 2,
        y: min[1]!,
        z: (min[2]! + max[2]!) / 2,
        bounds: [min[0]!, min[1]!, min[2]!, max[0]!, max[1]!, max[2]!],
        ...(lock ? { lock } : {}),
      });
      brush.door = id;
    }
    brushes.push(brush);
  });
  // Levers open the act's gates (the original's lever scripting is not decoded: all of them).
  const levers = objects.filter((o) => o.kind === 'lever');
  if (levers.length) {
    const gates = objects.filter((o) => o.kind === 'door' && LEVER_GATE.test(brushes.find((b) => b.door === o.id)?.name ?? ''));
    for (const g of gates) g.byLever = true;
    for (const l of levers) l.opens = gates.map((g) => g.id);
  }
  return { name, boxes: [], meshes: [mesh], spawnPoints: spawnPoints(mesh, hostiles, 8), mobSpawns, objects, portals, brushes };
}

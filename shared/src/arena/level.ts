import { doorSwingFromMotion, type LevelBrushMotion } from './door_swing.ts';
import { moverFromMotion } from './mover.ts';
import { CREATURE_TEMPLATES, npcArchetypeId } from '../game/creatures.ts';
import { itemSlug } from '../game/items.ts';
import type { ArenaDef, BrushDef, PortalDef, TriMeshDef, WorldObjectDef } from './types.ts';
import { SEQUENCE_ACTOR_BASE, type LevelStory } from '../game/story.ts';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../constants.ts';

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
  /** Facing direction (x, z), Z mirrored; absent in placements converted before it was read. */
  facing?: [number, number];
  /**
   * Items it holds (items.ctx names): the cap's inventory header names its weapon and shield
   * slots, replacing the type template's loadout (converter 1.24+; absent before: the template).
   */
  held?: { weapon?: string; shield?: string };
  /** Everything it carries (converter 1.24+). */
  items?: { name: string; quantity: number }[];
  /** Its talk line (Sound.ctx id, stats +0x1E4): the use key plays it; none = it says nothing. */
  talk?: number;
  /** ASM state it plays through its line (idle behaviour +0x3C). */
  gesture?: number;
  /** Its idle walk (stats +0x1DC kinds 1 / 3): points (original units, Z mirrored), pause ms at each, loop or back and forth. */
  path?: { kind: number; points: [number, number, number][]; pause: number; loop: boolean };
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
  /**
   * Converted texture file to draw `model` with, when this object's models.ctx id (or, for a
   * ground item, its items.ctx `Texture` index) names another texture than the one baked into
   * the shared model file (bookshelves, flags, potions, spell books).
   */
  texture?: string;
  /** The model's bounding box in its own frame (original units, Z mirrored): min x y z, max x y z. */
  box?: number[];
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
  /** Entry number of its exit trigger (cap type 0x13, +0x0F): arrivals through exit `entry` land here. */
  entry?: number;
  /** Its exit trigger's flags (+0x0E): 2 = arrive at the destination's start point `exit`, 4 = arrive at this point exactly. */
  flags?: number;
  /** No volume and the destination shares this act's mesh: only a script takes it (ScriptedSequenceDone). */
  scripted?: boolean;
}

/** World-object ids of door exits (interact key): this base + the portal id. */
export const PORTAL_OBJECT_BASE = 900_000;
/** How close to a door exit's trigger the interact key reaches, metres. */
export const PORTAL_USE_REACH = 1.5;
/** Base ID for dynamically spawned objects in the world (e.g. dropped items). */
export const DYNAMIC_OBJECT_BASE = 2_000_000;

/** A brush (cap class 0x31): name and vertices (original units, Z mirrored; the first is the pivot). */
export interface LevelBrush {
  name: string;
  points: [number, number, number][];
  /** Textured polygons: indices into `points`, texture coordinates per vertex (one picture every 15 units). */
  faces?: { texture: string; indices: number[]; texels: number[] }[];
  /** Its keyframe mover (doors, gates, lifts...). */
  motion?: LevelBrushMotion;
  /** Sound.ctx ids the use key plays at its hinge (door opening sounds). */
  sounds?: number[];
}

/** Door world-object ids start here (placement indices stay below). */
export const DOOR_OBJECT_BASE = 500_000;
/** Brushes that are doors (open with the interact key). */
export const DOOR_BRUSH = /door|gate/i;
/** Levers (Tab pulls them); in an act with levers its gates open by lever only (Ws1a/5a/9a). */
const LEVER_BRUSH = /lever/i;
const LEVER_GATE = /gate/i;
/** Props that do not block movement: foliage (plants, the pines' branch canopies), bottles. */
const NON_SOLID_PROP = /plant|brnch|branch|bottle|grass|flower|bush|debris/i;

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
  /** Triggers, scripted sequences and their cameras (converter 1.14+). */
  story?: LevelStory;
  /** Drake's start points (converter 1.15+): a new game begins at the first. */
  starts?: LevelStart[];
}

export interface LevelStart {
  /** Original units, Z mirrored. */
  position: [number, number, number];
  /** The original's heading, degrees, unmirrored (D3D: facing (sin, cos) in x, z). */
  heading: number;
}

/**
 * The act a new game begins in: the menu's New Game sets caps\WS9A.cap (0x4A3280; Training sets
 * caps\train.cap), the prison where Drake has just beaten the two skeletons.
 */
export const NEW_GAME_ACT = 'ws9a';

/** Horizontal radius / height of a portal trigger without a volume, metres (slice values). */
export const PORTAL_RADIUS = 1.6;
export const PORTAL_HEIGHT = 2.5;

/**
 * Whether a character standing at `pos` (feet, metres) touches a portal's trigger: its volume,
 * else the slice cylinder. As the original tests a character against a volume (0x4394F0): the
 * feet below the top, the head (feet + height) above the bottom, and the body's circle (radius)
 * against every edge, so a trigger between two turns of a spiral stair is reached from either.
 */
export function inPortal(portal: PortalDef, pos: { x: number; y: number; z: number }, margin = 0): boolean {
  const t = portal.trigger;
  if (!t) return Math.hypot(portal.x - pos.x, portal.z - pos.z) <= PORTAL_RADIUS + margin && Math.abs(portal.y - pos.y) <= PORTAL_HEIGHT;
  if (pos.y > t.yMax || pos.y + PLAYER_HEIGHT < t.yMin) return false;
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
  return inside || nearest <= margin + PLAYER_RADIUS;
}

/**
 * Where a player arriving from `fromArena` appears: on the floor next to this arena's portal
 * that leads back there, outside its trigger, facing away from the trigger into the level interior,
 * else the first spawn point. The original level code (loadlevel.c at 0x476F20) checks the Cap's
 * starts table when exit matches; otherwise interior direction and facing are derived from trigger
 * geometry so that walking forward along the spawn yaw never re-enters the return trigger.
 */
export function arrivalPoint(arena: ArenaDef, fromArena: string | undefined): { x: number; y: number; z: number; yaw: number } {
  const back = fromArena ? arena.portals?.find((p) => p.target === fromArena) : undefined;
  const start0 = arena.starts?.[0];
  const spawn0 = arena.spawnPoints[0] ?? { x: 0, y: 1, z: 0 };
  const fallback = {
    x: spawn0.x,
    y: spawn0.y,
    z: spawn0.z,
    yaw: start0?.yaw ?? 0,
  };
  if (!back) return fallback;
  return arrivalNear(arena, back) ?? fallback;
}

/**
 * How a player left the previous act through an exit, as the original records it on crossing
 * (0x462xxx, the exit trigger's touch): its exit number (low byte, the portal record's +4), and
 * the player's feet minus the exit's point (the trigger's +0x44, the portal position), metres.
 */
export interface ExitCrossing {
  exit: number;
  /** The exit trigger's flag 2: the destination's start point `exit` instead of an entry. */
  toStart?: boolean;
  offset: { x: number; y: number; z: number };
}

/**
 * Where a player arriving through an exit appears, as the level load does it (0x476F20):
 * - an exit with flag 2 loads the destination at its start point `exit` (position and heading);
 * - otherwise the destination's exit trigger whose entry number (+0x0F) is the exit number gives
 *   the point, plus the crossing offset (unless that trigger has flag 4), and the player keeps
 *   his heading (`yaw` undefined). Paired acts share their geometry around the two exits, so the
 *   player goes on from the same spot of the same stair or corridor.
 * Falls back to arrivalPoint (a search beside the return exit) when there is no such entry or
 * no floor there.
 */
export function exitArrival(
  arena: ArenaDef,
  fromArena: string | undefined,
  via: ExitCrossing | undefined,
): { x: number; y: number; z: number; yaw?: number } {
  if (via) {
    const n = via.exit & 0xff;
    const start = via.toStart ? arena.starts?.[n] : undefined;
    if (start) {
      const y = floorAt(arena, start.x, start.z, start.y, 4);
      if (y !== null) return { x: start.x, y: y + 0.1, z: start.z, yaw: start.yaw };
    }
    if (!via.toStart) {
      const entries = (arena.portals ?? []).filter((p) => p.entry === n);
      const entry = entries.find((p) => p.target === fromArena) ?? entries[0];
      if (entry) {
        const o = entry.fixedEntry ? { x: 0, y: 0, z: 0 } : via.offset;
        const x = entry.x + o.x, z = entry.z + o.z;
        const y = floorAt(arena, x, z, entry.y + o.y, ARRIVAL_SNAP);
        if (y !== null) return { x, y: y + 0.1, z };
      }
    }
  }
  return arrivalPoint(arena, fromArena);
}

/** How far (metres) the original's entry point may be from the floor it lands on. */
const ARRIVAL_SNAP = 1.5;

/** Arrival search: ring radii (metres from the trigger boundary), height window, and headroom. */
const ARRIVAL_RINGS = [1.2, 1.8, 2.5, 3.5, 5, 7, 9.5, 12, 15, 18];
const ARRIVAL_MAX_DROP = 8;
// Some exit triggers hang below the floor, at the bottom of a drop (Ca1a -> Ca1b): floors up to 12 m above count.
const ARRIVAL_MAX_RISE = 12;
/** Head room needed above the floor (a standing character). */
const ARRIVAL_HEADROOM = 1.9;

/**
 * Finds the arrival position and facing yaw outside a return portal's trigger (fallback when the
 * original's entry point has no floor, see exitArrival): evaluates outward normals along polygon
 * edges and radial directions, choosing a walkable floor that faces away from the trigger and whose
 * forward walk path (3-4m) does not re-enter any portal.
 */
function arrivalNear(arena: ArenaDef, portal: PortalDef): { x: number; y: number; z: number; yaw: number } | null {
  // 2. Geometry on collision mesh
  const at = { x: portal.x, y: portal.trigger ? portal.trigger.yMin : portal.y, z: portal.z };
  const poly = portal.trigger?.polygon;
  const extent = poly ? Math.max(...poly.map(([x, z]) => Math.hypot(x - portal.x, z - portal.z))) : PORTAL_RADIUS;
  const mesh = arena.meshes[0];
  if (!mesh) return null;
  const v = mesh.vertices;
  const idx = mesh.indices;
  const reach = extent + ARRIVAL_RINGS[ARRIVAL_RINGS.length - 1]! + 4;
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

  /** Heights of triangles over (x, z) with walkability flag. */
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
      const ux = bx - ax, uy = v[b + 1]! - v[a + 1]!, uz = bz - az;
      const vx = cx - ax, vy = v[c + 1]! - v[a + 1]!, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      out.push({ y, floor: Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1) > 0.7 });
    }
    return out;
  };

  let globalBest: { x: number; y: number; z: number; yaw: number; score: number; forwardFloors: number } | null = null;

  for (const r of ARRIVAL_RINGS) {
    const candidates: { x: number; z: number; nx: number; nz: number; yaw: number }[] = [];
    if (poly && poly.length >= 3) {
      const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
      const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      for (let i = 0; i < poly.length; i++) {
        const [x1, z1] = poly[i]!;
        const [x2, z2] = poly[(i + 1) % poly.length]!;
        const len = Math.hypot(x2 - x1, z2 - z1) || 1;
        let nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
        if (((x1 + x2) / 2 - cx) * nx + ((z1 + z2) / 2 - cz) * nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        // Yaw pointing along outward normal: forward in physics is (-sin yaw, -cos yaw)
        const yaw = Math.atan2(-nx, -nz);
        const steps = Math.max(1, Math.ceil(len));
        for (let k = 0; k <= steps; k++) {
          const px = x1 + ((x2 - x1) * k) / steps + nx * r;
          const pz = z1 + ((z2 - z1) * k) / steps + nz * r;
          candidates.push({ x: px, z: pz, nx, nz, yaw });
        }
      }
    }
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * Math.PI * 2;
      const nx = Math.cos(ang), nz = Math.sin(ang);
      const yaw = Math.atan2(-nx, -nz);
      candidates.push({
        x: portal.x + nx * (extent + r),
        z: portal.z + nz * (extent + r),
        nx,
        nz,
        yaw,
      });
    }

    let ringBest: { x: number; y: number; z: number; yaw: number; score: number; forwardFloors: number } | null = null;
    for (const c of candidates) {
      const col = column(c.x, c.z);
      let colBest: { y: number; drop: number } | null = null;
      for (const h of col) {
        if (!h.floor || h.y > at.y + ARRIVAL_MAX_RISE || h.y < at.y - ARRIVAL_MAX_DROP) continue;
        if (col.some((other) => other.y > h.y + 0.2 && other.y < h.y + ARRIVAL_HEADROOM)) continue;
        const drop = Math.abs(at.y - h.y);
        if (!colBest || drop < colBest.drop) colBest = { y: h.y, drop };
      }
      if (!colBest) continue;
      if (inPortal(portal, { x: c.x, y: colBest.y, z: c.z }, 0.2)) continue;

      let inAny = false;
      for (const p of arena.portals ?? []) {
        if (inPortal(p, { x: c.x, y: colBest.y, z: c.z }, 0.1)) {
          inAny = true;
          break;
        }
      }
      if (inAny) continue;

      // Forward walk check along yaw
      const fwdX = -Math.sin(c.yaw), fwdZ = -Math.cos(c.yaw);
      let reenters = false;
      let forwardFloors = 0;
      for (let d = 0.5; d <= 4.0; d += 0.5) {
        const tx = c.x + fwdX * d, tz = c.z + fwdZ * d;
        const tcol = column(tx, tz);
        const tf = tcol.find((h) => h.floor && Math.abs(h.y - colBest!.y) <= 2.0);
        if (tf) forwardFloors++;
        for (const p of arena.portals ?? []) {
          if (inPortal(p, { x: tx, y: tf ? tf.y : colBest.y, z: tz }, 0.05)) {
            reenters = true;
            break;
          }
        }
        if (reenters) break;
      }
      if (reenters) continue;

      const score = forwardFloors * 10 - colBest.drop * 2;
      const candResult = { x: c.x, y: colBest.y + 0.1, z: c.z, yaw: c.yaw, score, forwardFloors };
      if (!ringBest || score > ringBest.score) ringBest = candResult;
      if (!globalBest || score > globalBest.score) globalBest = candResult;
    }
    // High-confidence interior arrival found: at least 2m forward clear floor
    if (ringBest && ringBest.forwardFloors >= 4) {
      return { x: ringBest.x, y: ringBest.y, z: ringBest.z, yaw: ringBest.yaw };
    }
  }

  return globalBest ? { x: globalBest.x, y: globalBest.y, z: globalBest.z, yaw: globalBest.yaw } : null;
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

/** ASM_HIT_POINTS_DEPLETED: a creature's death clip. */
const ASM_DEATH = 78;

/**
 * Placements of the creatures a sequence kills (a RunAnimation of the death clip on their
 * track): actors of the script only (Ws9a's cell guards, Du1c / Du3c's), never fought or respawned.
 */
function scriptedDeaths(story: LevelStory | undefined): Set<number> {
  const out = new Set<number>();
  for (const q of story?.sequences ?? []) {
    for (const t of q.tracks) {
      const a = q.actors[t.actor - SEQUENCE_ACTOR_BASE];
      if (!a || !('creature' in a)) continue;
      if (t.steps.some((i) => q.steps[i]?.action === 'RunAnimation' && q.steps[i]!.args['animation'] === ASM_DEATH)) out.add(a.creature);
    }
  }
  return out;
}

/**
 * A placement's own loadout, talk line and idle walk (converter 1.24+): what it holds replaces
 * the archetype's template loadout; placements converted before keep the template.
 */
function placementExtras(c: LevelCreature, s: number): Partial<ArenaDef['mobSpawns'][number]> {
  const out: Partial<ArenaDef['mobSpawns'][number]> = {};
  if (c.held) {
    out.weapon = c.held.weapon ? itemSlug(c.held.weapon) : null;
    out.shield = c.held.shield ? itemSlug(c.held.shield) : null;
  }
  if (c.talk !== undefined) out.talk = c.talk;
  if (c.gesture !== undefined) out.gesture = c.gesture;
  if (c.path && c.path.points.length > 1) {
    out.path = { points: c.path.points.map((p) => ({ x: p[0] * s, y: p[1] * s, z: p[2] * s })), pause: c.path.pause, loop: c.path.loop };
  }
  return out;
}

export function buildLevelArena(name: string, collision: Uint8Array, placements: LevelPlacements): ArenaDef {
  const mesh = parseLevelCollision(collision);
  const s = LEVEL_UNIT_METRES;
  const hostiles = placements.creatures
    .filter((c) => c.disposition === HOSTILE)
    .map((c) => ({ x: c.position[0] * s, y: c.position[1] * s, z: c.position[2] * s }));
  const mobSpawns: ArenaDef['mobSpawns'] = [];
  const scripted = scriptedDeaths(placements.story);
  const puppets: NonNullable<ArenaDef['puppets']> = [];
  placements.creatures.forEach((c, placement) => {
    // Killed by a sequence (Ws9a's two cell guards): the triggering player's client plays them.
    if (scripted.has(placement)) {
      const archetype = LEVEL_ARCHETYPES[c.type] ?? (CREATURE_TEMPLATES[c.type] ? npcArchetypeId(c.type) : null);
      if (archetype) {
        puppets.push({
          archetype,
          placement,
          x: c.position[0] * s,
          y: c.position[1] * s + 0.1,
          z: c.position[2] * s,
          ...(c.facing ? { yaw: Math.atan2(-c.facing[0], -c.facing[1]) } : {}),
          ...(c.held ? { weapon: c.held.weapon ? itemSlug(c.held.weapon) : null, shield: c.held.shield ? itemSlug(c.held.shield) : null } : {}),
        });
      }
      return;
    }
    // Citizens, guards, merchants (dispositions 0-2): peaceful, standing at their place.
    if (c.disposition >= 0 && c.disposition < HOSTILE && CREATURE_TEMPLATES[c.type]) {
      mobSpawns.push({
        archetype: npcArchetypeId(c.type),
        placement,
        x: c.position[0] * s,
        y: c.position[1] * s + 0.1,
        z: c.position[2] * s,
        ...(c.hp > 0 ? { hp: c.hp } : {}),
        ...(c.facing ? { yaw: Math.atan2(-c.facing[0], -c.facing[1]) } : {}),
        ...placementExtras(c, s),
      });
      return;
    }
    const archetype = LEVEL_ARCHETYPES[c.type];
    if (!archetype || c.disposition !== HOSTILE || !(c.hp > 0)) return;
    mobSpawns.push({
      archetype,
      placement,
      x: c.position[0] * s,
      y: c.position[1] * s + 0.1,
      z: c.position[2] * s,
      hp: c.hp,
      xp: c.xp,
      resist: c.resist,
      ...(c.facing ? { yaw: Math.atan2(-c.facing[0], -c.facing[1]) } : {}),
      ...placementExtras(c, s),
    });
  });
  const objects: WorldObjectDef[] = [];
  const solids: { points: Float32Array; object?: number }[] = [];
  (placements.objects ?? []).forEach((o, id) => {
    // Props block movement with their model's box, but foliage, bottles and anything under a
    // foot high (tools, fire pits) - the original's prop records carry no collision volume.
    if (o.kind === 'prop' && o.box && !NON_SOLID_PROP.test(`${o.name} ${o.model ?? ''}`) && o.box[4]! - o.box[1]! >= 1) {
      const b = o.box;
      const r = o.rotation;
      const pts: number[] = [];
      for (const x of [b[0]!, b[3]!]) for (const y of [b[1]!, b[4]!]) for (const z of [b[2]!, b[5]!]) {
        pts.push(
          (r[0]! * x + r[3]! * y + r[6]! * z + o.position[0]) * s,
          (r[1]! * x + r[4]! * y + r[7]! * z + o.position[1]) * s,
          (r[2]! * x + r[5]! * y + r[8]! * z + o.position[2]) * s,
        );
      }
      solids.push({ points: new Float32Array(pts), ...(o.hp > 0 ? { object: id } : {}) });
    }
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
    ...(p.exit !== undefined ? { exit: p.exit } : {}),
    ...(p.entry !== undefined ? { entry: p.entry } : {}),
    ...(p.flags && p.flags & 2 ? { toStart: true } : {}),
    ...(p.flags && p.flags & 4 ? { fixedEntry: true } : {}),
    ...(p.scripted ? { scripted: true } : {}),
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
    else if (b.motion) {
      const mover = moverFromMotion(b.motion, s);
      if (mover) brush.mover = mover;
    }
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
        ...(b.sounds?.length ? { sounds: b.sounds } : {}),
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
  return {
    name, boxes: [], meshes: [mesh], spawnPoints: spawnPoints(mesh, hostiles, 8), mobSpawns, objects, portals, brushes, solids,
    ...(placements.story ? { story: placements.story } : {}),
    ...(puppets.length ? { puppets } : {}),
    // Mirrored, the original's facing (sin h, cos h) becomes (sin h, -cos h): yaw -h (0 = -Z).
    ...(placements.starts?.length
      ? { starts: placements.starts.map((p) => ({ x: p.position[0] * s, y: p.position[1] * s + 0.1, z: p.position[2] * s, yaw: (-p.heading * Math.PI) / 180 })) }
      : {}),
    mesh: placements.mesh,
  };
}

/**
 * The walkable floor at (x, z) nearest to height `nearY` (metres), within `window` metres up or
 * down, or null: where a character set down at a point of a level stands (e.g. Drake at the end
 * of a scripted walk, whose target height the scripts do not keep).
 */
export function floorAt(arena: ArenaDef, x: number, z: number, nearY: number, window = 8): number | null {
  const mesh = arena.meshes[0];
  if (!mesh) return null;
  const v = mesh.vertices, idx = mesh.indices;
  let best: number | null = null;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
    const ax = v[a]!, az = v[a + 2]!, bx = v[b]!, bz = v[b + 2]!, cx = v[c]!, cz = v[c + 2]!;
    if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
    const y = w0 * v[a + 1]! + w1 * v[b + 1]! + (1 - w0 - w1) * v[c + 1]!;
    const uy = v[b + 1]! - v[a + 1]!, vy = v[c + 1]! - v[a + 1]!;
    const nx = uy * (cz - az) - (bz - az) * vy, ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * vy - uy * (cx - ax);
    // Floors only, facing up (every converted mesh winds its floors that way): never a ceiling.
    if (ny / (Math.hypot(nx, ny, nz) || 1) <= 0.7) continue;
    if (Math.abs(y - nearY) <= window && (best === null || Math.abs(y - nearY) < Math.abs(best - nearY))) best = y;
  }
  return best;
}

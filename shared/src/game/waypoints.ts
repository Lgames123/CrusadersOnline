/**
 * Waypoints (not original): a teleport crystal in every act of the campaign, usable only by a
 * character who finished the story (StoryState.completedAt). The use key at a crystal opens the
 * map; picking an area sends him there, next to that act's crystal.
 *
 * The original has no fast travel. Acts of one place recur through the story (Cador Sul is
 * cs1a-cs4a / cs1b-cs4b), so the map groups them by chapter: the main quest each act belongs to,
 * read from the acts' quest triggers and the portal graph (see the context note of 2026-10-20).
 */
import type { ArenaDef } from '../arena/types.ts';
import { LEVEL_UNIT_METRES, inPortal, respawnPoint } from '../arena/level.ts';
import { inStoryVolume } from './story.ts';

export type WaypointRegion = 'ci' | 'cs' | 'ws' | 'ca' | 'du' | 'gl' | 'co' | 'cm' | 'es' | 'bs';

export interface WaypointRegionInfo {
  name: string;
  /**
   * The region's label scroll on the original's map (crusaders.exe 0x4549F0: textures map1 /
   * map1a, map2, map3, map4 drawn at 64,47.5 / 319,47.5 / 64,302.5 / 319,302.5, so 511x383 px
   * from its top left): centre and size, in those pixels.
   */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WAYPOINT_REGIONS: Readonly<Record<WaypointRegion, WaypointRegionInfo>> = {
  ci: { name: 'The Citadel', x: 47, y: 59, w: 66, h: 22 },
  cs: { name: 'Cador Sul', x: 87, y: 161, w: 70, h: 22 },
  ws: { name: 'The Stronghold (west)', x: 241, y: 184, w: 72, h: 32 },
  ca: { name: 'The Catacombs', x: 64, y: 244, w: 72, h: 24 },
  gl: { name: 'The Glaciers', x: 242, y: 361, w: 75, h: 28 },
  du: { name: 'Duskwood', x: 290, y: 274, w: 70, h: 22 },
  co: { name: 'Corantha', x: 461, y: 280, w: 78, h: 25 },
  cm: { name: 'The Coranthan Mines', x: 461, y: 350, w: 78, h: 35 },
  es: { name: 'The Stronghold (east)', x: 319, y: 184, w: 72, h: 32 },
  bs: { name: "Necros's Battleship", x: 174, y: 78, w: 62, h: 34 },
};

/** The original map's size in pixels (the four tiles less their one-pixel overlap). */
export const WAYPOINT_MAP_SIZE = { w: 511, h: 383 } as const;

export interface WaypointChapter {
  /** 1-5. */
  act: number;
  title: string;
  /** Act names ("cs2b"), in travel order. */
  acts: readonly string[];
}

/**
 * The campaign's acts by chapter. Read from the quest triggers each act holds (main quests 0-9,
 * rules/strings.json 3100-3109) and the exits between them: Ws9a's escape and Ci1b's meeting
 * with Celestia; Co1a / Cm2b / Co2a / Du2a / Co3a for the Horn; Ci3b / Gl1b for Ursan; Du1c /
 * Gl3c / Du3c / Co4a for the Solidify spell and King Dain; Es4a / Ws5a / Bs1a for Necros. The
 * training level is not part of the campaign; the inns (one door off Cador Sul, too cramped for a
 * crystal) have none.
 */
export const WAYPOINT_CHAPTERS: readonly WaypointChapter[] = [
  { act: 1, title: 'Escape and the Citadel', acts: ['ws9a', 'ws1a', 'cs1b', 'cs1a', 'ci1a', 'ci1b', 'ci9a', 'ci9b'] },
  {
    act: 2,
    title: 'The Horn of Shattering',
    acts: [
      'ci2a', 'ci2b', 'cs2a', 'cs2b', 'ws2a', 'ca1a', 'ca1b', 'ca1c', 'ca1d', 'du1a', 'du1b', 'es1a', 'co1a', 'cm1a',
      'cm1b', 'co8a', 'cm2a', 'cm2b', 'co2a', 'du2a', 'du2b', 'es2a', 'du9a', 'du9b', 'es9a', 'co3a', 'co9a', 'du3a', 'du3b', 'es3a',
    ],
  },
  { act: 3, title: 'Captain Ursan', acts: ['cs3a', 'cs3b', 'ci3a', 'ci3b', 'ws3a', 'ca2a', 'ca2b', 'ca2c', 'ca2d', 'gl2a', 'gl2b', 'gl1a', 'gl1b'] },
  {
    act: 4,
    title: 'The Solidify Spell',
    acts: [
      'du1c', 'du8c', 'du9c', 'gl3a', 'gl3b', 'gl3c', 'gl4a', 'gl4b', 'gl4c', 'du2c', 'du3c', 'du4a', 'du4b', 'co4a', 'cs4a', 'cs4b',
      'ci4a', 'ci4b', 'ws4a', 'ca3a', 'ca3b', 'ca3c', 'ca3d',
    ],
  },
  { act: 5, title: 'Necros', acts: ['es4a', 'es4b', 'ws5a', 'bs1a', 'cs5b'] },
];

/** Act name -> its chapter. */
const CHAPTER_OF = new Map<string, WaypointChapter>(WAYPOINT_CHAPTERS.flatMap((c) => c.acts.map((a) => [a, c] as const)));

/** Whether an act has a crystal (every campaign act). */
export function isWaypointAct(act: string): boolean {
  return CHAPTER_OF.has(act);
}

export function waypointChapter(act: string): WaypointChapter | undefined {
  return CHAPTER_OF.get(act);
}

export function waypointRegion(act: string): WaypointRegion {
  return act.slice(0, 2) as WaypointRegion;
}

/**
 * What the map calls an act: its region, and when the chapter has several acts there, the
 * part in travel order ("The Catacombs — part 3").
 */
export function waypointLabel(act: string): string {
  const region = WAYPOINT_REGIONS[waypointRegion(act)]?.name ?? act.toUpperCase();
  const parts = CHAPTER_OF.get(act)?.acts.filter((a) => waypointRegion(a) === waypointRegion(act)) ?? [];
  return parts.length <= 1 ? region : `${region} — part ${parts.indexOf(act) + 1}`;
}

/**
 * A friendly name for an act or zone ("level:cs1b-inn" → "Cador Sul Inn", "ca2b" → "The
 * Catacombs", "train" → "Training Grounds"): its region's name, for display only; a dungeon
 * instance names its base act. Unknown names stay as they are, upper-cased.
 */
export function areaName(zone: string): string {
  const act = zone.toLowerCase().replace(/^level:/, '').split('@')[0]!;
  if (act === 'train') return 'Training Grounds';
  const inn = act.endsWith('-inn');
  const region = WAYPOINT_REGIONS[act.slice(0, 2) as WaypointRegion]?.name;
  if (!region) return act.toUpperCase();
  return inn ? `${region.replace(/^The /, '')} Inn` : region;
}

/** Metres from the crystal within which the use key opens the map (the server checks it too). */
export const WAYPOINT_REACH = 2.5;
/**
 * How far from a crystal a player at `p` stands for using it (metres, horizontal), or null when
 * out of reach (`slack` widens it: the server's tolerance). Where the arrival spot is out of the
 * crystal's reach (Ws9a: the crystal stands behind the bars of a cell, the arrival in the
 * corridor), the arrival spot is used as well.
 */
export function crystalReach(spot: { crystal: { x: number; y: number; z: number }; arrival?: { x: number; y: number; z: number } }, p: { x: number; y: number; z: number }, slack = 0): number | null {
  let best: number | null = null;
  const points = [spot.crystal];
  if (spot.arrival && Math.hypot(spot.arrival.x - spot.crystal.x, spot.arrival.z - spot.crystal.z) > WAYPOINT_REACH) points.push(spot.arrival);
  for (const q of points) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d <= WAYPOINT_REACH + slack && Math.abs(q.y - p.y) < 2.5 && (best === null || d < best)) best = d;
  }
  return best;
}

/** Seconds between two teleports of a player. */
export const WAYPOINT_COOLDOWN = 10;

export interface WaypointSpot {
  /** Where the crystal stands (its base, on the floor). */
  crystal: { x: number; y: number; z: number };
  /** Where a player teleported here appears, facing the crystal. */
  arrival: { x: number; y: number; z: number; yaw: number };
}

/** Ring radii (metres) searched around the area's beginning for the crystal. */
const RINGS = [2.5, 3.5, 4.5, 6, 8, 10, 13, 16, 20];
/** Head room needed over a spot. */
const HEADROOM = 2.6;
/** Metres the arrival is from the crystal. */
const ARRIVAL_GAP = 1.8;
/** Farther arrivals, when none beside the crystal walks back to the area's beginning. */
const ARRIVAL_GAPS = [ARRIVAL_GAP, 2.5, 3.5, 4.5, 6, 8];
/** Clearance kept from triggers, props, objects and brushes. */
const CLEAR = 1.2;

/**
 * Where an act's crystal stands: near the beginning of the area (respawnPoint: start 0 or its
 * first entry), on a flat floor with head room, clear of every exit, story trigger, sign, shop,
 * prop and door, with a free spot beside it for arrivals. Deterministic, so every zone of the act
 * puts it at the same place. Null when the act has no such floor.
 */
export function waypointSpot(arena: ArenaDef): WaypointSpot | null {
  const mesh = arena.meshes[0];
  if (!mesh) return null;
  const base = respawnPoint(arena);
  const v = mesh.vertices, idx = mesh.indices;
  const reach = RINGS[RINGS.length - 1]! + ARRIVAL_GAPS[ARRIVAL_GAPS.length - 1]! + 3;
  const tris: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
    if (Math.max(v[a]!, v[b]!, v[c]!) < base.x - reach || Math.min(v[a]!, v[b]!, v[c]!) > base.x + reach) continue;
    if (Math.max(v[a + 2]!, v[b + 2]!, v[c + 2]!) < base.z - reach || Math.min(v[a + 2]!, v[b + 2]!, v[c + 2]!) > base.z + reach) continue;
    if (Math.min(v[a + 1]!, v[b + 1]!, v[c + 1]!) > base.y + 12) continue;
    tris.push(t);
  }
  /** Surfaces over (x, z): height and whether it is a flat floor (normal within ~25° of up). */
  const column = (x: number, z: number) => {
    const out: { y: number; flat: boolean }[] = [];
    for (const t of tris) {
      const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
      const ax = v[a]!, az = v[a + 2]!, bx = v[b]!, bz = v[b + 2]!, cx = v[c]!, cz = v[c + 2]!;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      const y = w0 * v[a + 1]! + w1 * v[b + 1]! + (1 - w0 - w1) * v[c + 1]!;
      const ux = bx - ax, uy = v[b + 1]! - v[a + 1]!, uz = bz - az;
      const vx = cx - ax, vy = v[c + 1]! - v[a + 1]!, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      out.push({ y, flat: Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1) > 0.9 });
    }
    return out;
  };
  /** The floor at (x, z) within `drop` metres of `nearY`, with head room, or null. */
  const floor = (x: number, z: number, nearY: number, drop: number): number | null => {
    const col = column(x, z);
    let best: number | null = null;
    for (const h of col) {
      if (!h.flat || Math.abs(h.y - nearY) > drop) continue;
      if (col.some((o) => o.y > h.y + 0.1 && o.y < h.y + HEADROOM)) continue;
      if (best === null || Math.abs(h.y - nearY) < Math.abs(best - nearY)) best = h.y;
    }
    return best;
  };
  const story = arena.story;
  const boxes: { min: [number, number, number]; max: [number, number, number] }[] = [];
  const hull = (pts: Float32Array) => {
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, pts[i + k]!);
        max[k] = Math.max(max[k]!, pts[i + k]!);
      }
    }
    if (min[0] <= max[0]) boxes.push({ min, max });
  };
  for (const s of arena.solids ?? []) hull(s.points);
  for (const b of arena.brushes ?? []) hull(b.points);
  const clear = (x: number, y: number, z: number): boolean => {
    const at = { x, y, z };
    for (const p of arena.portals ?? []) if (inPortal(p, at, CLEAR + 0.6)) return false;
    for (const b of boxes) {
      if (y + HEADROOM < b.min[1] || y > b.max[1] + 0.3) continue;
      if (x > b.min[0] - CLEAR && x < b.max[0] + CLEAR && z > b.min[2] - CLEAR && z < b.max[2] + CLEAR) return false;
    }
    for (const o of arena.objects ?? []) if (Math.hypot(o.x - x, o.z - z) < CLEAR + 0.3 && Math.abs(o.y - y) < 3) return false;
    for (const m of arena.mobSpawns) if (Math.hypot(m.x - x, m.z - z) < CLEAR && Math.abs(m.y - y) < 3) return false;
    if (story) {
      const u = LEVEL_UNIT_METRES;
      // The volume and a ring of points around it: a trigger brushed by a crystal's visitor counts.
      for (const [dx, dz] of [[0, 0], [CLEAR, 0], [-CLEAR, 0], [0, CLEAR], [0, -CLEAR]] as const) {
        const ox = (x + dx) / u, oy = (y + 0.9) / u, oz = (z + dz) / u;
        for (const t of story.triggers) if (t.volume && inStoryVolume(t.volume, ox, oy, oz)) return false;
        for (const t of story.messages ?? []) if (t.volume && inStoryVolume(t.volume, ox, oy, oz)) return false;
        for (const t of story.shops ?? []) if (inStoryVolume(t.volume, ox, oy, oz)) return false;
        for (const t of story.soundTriggers ?? []) if (inStoryVolume(t.volume, ox, oy, oz)) return false;
      }
    }
    return true;
  };
  /** Whether the straight walk from a to b (feet on the floor) crosses no surface of the level, at the waist and the head. */
  const open = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean => {
    for (const h of [0.9, 1.6]) {
      const px = ax, py = ay + h, pz = az, dx = bx - ax, dy = by + h - py, dz = bz - az;
      for (const t of tris) {
        const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
        // Möller–Trumbore, segment parameter in (0, 1).
        const e1x = v[b]! - v[a]!, e1y = v[b + 1]! - v[a + 1]!, e1z = v[b + 2]! - v[a + 2]!;
        const e2x = v[c]! - v[a]!, e2y = v[c + 1]! - v[a + 1]!, e2z = v[c + 2]! - v[a + 2]!;
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-9) continue;
        const f = 1 / det;
        const sx = px - v[a]!, sy = py - v[a + 1]!, sz = pz - v[a + 2]!;
        const u = f * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const w = f * (dx * qx + dy * qy + dz * qz);
        if (w < 0 || u + w > 1) continue;
        const s = f * (e2x * qx + e2y * qy + e2z * qz);
        if (s > 0 && s < 1) return false;
      }
    }
    return true;
  };
  /** Whether a spot walks back to the area's beginning: straight, or round one corner. */
  const reaches = (x: number, y: number, z: number): boolean =>
    open(x, y, z, base.x, base.y, base.z) ||
    [[x, base.z], [base.x, z]].some(([cx, cz]) => {
      const cy = floor(cx!, cz!, y, 1);
      return cy !== null && open(x, y, z, cx!, cy, cz!) && open(cx!, cy, cz!, base.x, base.y, base.z);
    });
  /** Room for a body: no surface within 0.7 m around the spot (a far arrival, not pressed against bars or a wall). */
  const roomy = (x: number, y: number, z: number): boolean => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (!open(x, y, z, x + Math.sin(a) * 0.7, y, z + Math.cos(a) * 0.7)) return false;
    }
    return true;
  };
  /** The crystal's footprint: flat floor under its middle and around its rim, level within 0.3 m. */
  const pad = (x: number, z: number, y: number): boolean => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const fy = floor(x + Math.cos(a) * 0.8, z + Math.sin(a) * 0.8, y, 0.3);
      if (fy === null) return false;
    }
    return true;
  };
  for (const r of RINGS) {
    for (let k = 0; k < 24; k++) {
      // Start ahead of the start point's heading (forward = (-sin yaw, -cos yaw)) and sweep round.
      const ang = base.yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((Math.PI * 2) / 24);
      const x = base.x - Math.sin(ang) * r, z = base.z - Math.cos(ang) * r;
      const y = floor(x, z, base.y, 3);
      if (y === null || !pad(x, z, y) || !clear(x, y, z)) continue;
      // The arrival: beside the crystal on the way back to the start point, else any side; it
      // must walk back to the start point (Ws9a's crystal stands in a barred cell beside Drake's
      // open one: whoever arrives waits in the corridor, in front of the bars).
      const back = Math.atan2(base.x - x, base.z - z);
      for (const gap of ARRIVAL_GAPS) {
        const steps = gap === ARRIVAL_GAP ? 8 : 16;
        for (let j = 0; j < steps; j++) {
          const dir = back + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * ((Math.PI * 2) / steps);
          const ax = x + Math.sin(dir) * gap, az = z + Math.cos(dir) * gap;
          const ay = floor(ax, az, y, gap === ARRIVAL_GAP ? 0.5 : 1);
          if (ay === null || !clear(ax, ay, az) || !reaches(ax, ay, az) || (gap !== ARRIVAL_GAP && !roomy(ax, ay, az))) continue;
          // Facing the crystal (forward = (-sin yaw, -cos yaw) = -dir): the chase camera stays clear of it.
          return { crystal: { x, y, z }, arrival: { x: ax, y: ay + 0.1, z: az, yaw: dir } };
        }
      }
    }
  }
  return null;
}

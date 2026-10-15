import type { DoorSwing } from './door_swing.ts';
import type { MoverDef } from './mover.ts';
import type { LevelStory } from '../game/story.ts';

/**
 * Static level description shared by renderer (client) and collision world (client + server).
 * Synthetic arenas use primitive boxes; converted original levels use triangle meshes (level.ts).
 */
export interface BoxDef {
  /** Centre, metres. */
  x: number;
  y: number;
  z: number;
  /** Half extents, metres. */
  hx: number;
  hy: number;
  hz: number;
  /** Rotation about the X axis (ramps), radians. */
  rotX?: number;
  /** Rotation about the Y axis, radians. */
  rotY?: number;
  /** Render hint. */
  kind: 'floor' | 'wall' | 'pillar' | 'ramp' | 'platform';
}

export interface TriMeshDef {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Interactive object of an original level (from its .cap placements); `id` is the index in the
 * placements list, identical on server and client.
 */
export interface WorldObjectDef {
  id: number;
  kind: 'item' | 'chest' | 'breakable' | 'door' | 'lever';
  /** Metres. */
  x: number;
  y: number;
  z: number;
  /** Breakables: hit points. */
  hp?: number;
  /** Ground items. */
  item?: { name: string; quantity: number };
  /** Chests. */
  contents?: { name: string; quantity: number }[];
  /** Doors: bounds (metres, [min x, y, z, max x, y, z]) and the key that unlocks it, if locked. */
  bounds?: [number, number, number, number, number, number];
  lock?: string;
  /** Doors opened by a lever only (not by hand). */
  byLever?: boolean;
  /** Levers: the doors (object ids) pulling it opens. */
  opens?: number[];
  /** Doors: Sound.ctx ids played at the hinge by the use key (the original's sound actions). */
  sounds?: number[];
}

/**
 * A brush of an original level (doors, gates, bridges, wheels...): a convex piece of geometry,
 * hull points in metres (x, y, z flat). Doors are also world objects (`door` = object id): open,
 * their collider is disabled.
 */
export interface BrushDef {
  name: string;
  points: Float32Array;
  /** Solid for movement (doors, gates, bridges, platforms); the rest is drawn only. */
  solid: boolean;
  /** World object id when the brush is a door or a lever. */
  door?: number;
  /** A door that swings about its hinge (the original's turning mover, door_swing.ts). */
  swing?: DoorSwing;
  /** Any other keyframe mover (gates, cell doors, levers, platforms, wheels...; mover.ts). */
  mover?: MoverDef;
}

/** Level exit: walking into its trigger moves the player to another zone (arena). */
export interface PortalDef {
  id: number;
  /** Destination arena name, e.g. "level:ca1b". */
  target: string;
  /** Trigger centre, metres. */
  x: number;
  y: number;
  z: number;
  /** Exit number within the level (Cap 0x06 start point index or exit record id). */
  exit?: number;
  /** The original trigger volume (metres): an x/z polygon between two heights. */
  trigger?: { polygon: [number, number][]; yMin: number; yMax: number };
  /** Door exit: taken with the interact key instead of walking in. */
  use?: boolean;
}

export interface ArenaDef {
  name: string;
  boxes: BoxDef[];
  meshes: TriMeshDef[];
  spawnPoints: { x: number; y: number; z: number }[];
  /** Original levels: the act's start points (metres; yaw radians, 0 = -Z). A fresh character starts at the first. */
  starts?: { x: number; y: number; z: number; yaw: number }[];
  /**
   * Hostile spawns: archetype id (game/combat.ts) and position; original levels also carry the
   * placement's own HP, XP value and resists, which override the archetype's.
   */
  mobSpawns: {
    archetype: string; x: number; y: number; z: number; hp?: number; xp?: number; resist?: number[]; wander?: boolean;
    /** Heading (radians, 0 = -Z). */ yaw?: number;
    /** Original levels: the creature's index in the act's placements (sequences name actors by it). */ placement?: number;
  }[];
  /** Items, chests and breakable props (original levels). */
  objects?: WorldObjectDef[];
  /** Exits to other zones (original levels). */
  portals?: PortalDef[];
  /** Brushes (original levels). */
  brushes?: BrushDef[];
  /**
   * Solid props (original levels): convex hulls (metres, x y z flat). `object`: a breakable's
   * world-object id, its collider gone while it is broken.
   */
  solids?: { points: Float32Array; object?: number }[];
  /**
   * Original levels: creatures only a scripted sequence plays (it kills them). Not simulated;
   * the client of the player who triggers the sequence shows them, as the server's mobs are shared.
   */
  puppets?: { archetype: string; placement: number; x: number; y: number; z: number; /** Radians, 0 = -Z. */ yaw?: number }[];
  /** Triggers, scripted sequences and cameras (original levels; original units, Z mirrored). */
  story?: LevelStory;
  /** Original levels: the mesh the act is built on (acts of one mesh share its coordinates). */
  mesh?: string;
}

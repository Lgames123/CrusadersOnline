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
  kind: 'item' | 'chest' | 'breakable' | 'door';
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
  door?: number;
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
}

export interface ArenaDef {
  name: string;
  boxes: BoxDef[];
  meshes: TriMeshDef[];
  spawnPoints: { x: number; y: number; z: number }[];
  /**
   * Hostile spawns: archetype id (game/combat.ts) and position; original levels also carry the
   * placement's own HP, XP value and resists, which override the archetype's.
   */
  mobSpawns: { archetype: string; x: number; y: number; z: number; hp?: number; xp?: number; resist?: number[] }[];
  /** Items, chests and breakable props (original levels). */
  objects?: WorldObjectDef[];
  /** Exits to other zones (original levels). */
  portals?: PortalDef[];
  /** Brushes (original levels). */
  brushes?: BrushDef[];
}

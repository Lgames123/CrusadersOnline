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
  kind: 'item' | 'chest' | 'breakable';
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
}

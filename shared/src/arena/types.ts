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
}

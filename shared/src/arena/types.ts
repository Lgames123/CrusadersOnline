/**
 * Static level description shared by renderer (client) and collision world (client + server).
 * Synthetic arenas use primitive boxes; converted levels will add triangle meshes.
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
}

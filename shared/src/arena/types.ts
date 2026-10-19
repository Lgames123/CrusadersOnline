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
  /**
   * Ground items (`itemId`: catalog id of a dropped item, so it is picked up as itself; `model` /
   * `texture`: its items.ctx Model and Texture, to draw a `loose` one).
   */
  item?: { name: string; quantity: number; itemId?: string; model?: number; texture?: number };
  /** Dynamic ground items drawn as themselves (a kill's loot), not in the chest of player drops. */
  loose?: boolean;
  /** Chests. */
  contents?: { name: string; quantity: number }[];
  /** Doors: bounds (metres, [min x, y, z, max x, y, z]). */
  bounds?: [number, number, number, number, number, number];
  /**
   * Doors: the original's mover triggers that open it (level.ts doorUseAt). Absent in levels
   * converted before 1.33 (any side opens it); empty = the player never opens it by hand.
   */
  useFrom?: DoorUse[];
  /** Doors with `useFrom`: the shut slab in x/z, to tell its two sides apart (doorSide). */
  plane?: DoorPlane;
  /** Doors opened by a lever only (not by hand); also brushes only the story moves (Ca*a's bPlat rings). */
  byLever?: boolean;
  /** Levers: the doors (object ids) pulling it opens. */
  opens?: number[];
  /** Doors: Sound.ctx ids played at the hinge by the use key (the original's sound actions). */
  sounds?: number[];
}

/**
 * One mover trigger of a door (0x460320): activation bit 0 = walking in, bit 3 = the use key,
 * 0x20 = walking in carrying `item`. `side` is the door side its volume lies on (doorSide).
 */
export interface DoorUse {
  activation: number;
  /** Metres. */
  trigger: { polygon: [number, number][]; yMin: number; yMax: number };
  item?: string;
  side: number;
}

/** A shut door slab in x/z (metres): centre, unit normal, unit length axis and half its length. */
export interface DoorPlane {
  cx: number;
  cz: number;
  nx: number;
  nz: number;
  half: number;
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
  /** Triangles of its faces (into `points`): solid non-door pieces collide as these, not as a hull. */
  indices?: Uint32Array;
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
  /** Exit number (portal record +4): arrivals through it pick the destination entry with this number. */
  exit?: number;
  /** The original trigger volume (metres): an x/z polygon between two heights. */
  trigger?: { polygon: [number, number][]; yMin: number; yMax: number };
  /** Door exit: taken with the interact key instead of walking in. */
  use?: boolean;
  /** Entry number of its exit trigger: arrivals through exit `entry` land at this exit (see exitArrival). */
  entry?: number;
  /** Exit trigger flag 2: arrivals through this exit go to the destination's start point `exit`. */
  toStart?: boolean;
  /** Exit trigger flag 4: arrivals land on this exit's point exactly, not offset. */
  fixedEntry?: boolean;
  /** Taken only by a script, never by walking in (no volume, same mesh as the destination). */
  scripted?: boolean;
  /** Fired only by learning a spell in its volume (exit activation 0x10000; Gl3c's Revelation pad). */
  onLearn?: boolean;
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
    archetype: string; x: number; y: number; z: number; hp?: number; xp?: number; resist?: number[];
    /** Heading (radians, 0 = -Z). */ yaw?: number;
    /** Original levels: the creature's index in the act's placements (sequences name actors by it). */ placement?: number;
    /** Original levels: the item ids it holds (null: nothing), replacing the archetype's loadout. */
    weapon?: string | null;
    shield?: string | null;
    /**
     * Original levels: what its corpse gives (gold, potions, its weapon and shield...: the
     * placement's inventory, 0x00471940); absent: the archetype's gold roll and loot table.
     */
    carries?: { name: string; quantity: number }[];
    /** Original levels: its talk line (Sound.ctx id) and the ASM state it gestures with meanwhile. */
    talk?: number;
    gesture?: number;
    /** Original levels: its idle walk (metres): pause ms at each point, loop or back and forth. */
    path?: { points: { x: number; y: number; z: number }[]; pause: number; loop: boolean };
    /** Original levels: its unarmed damage per type (added to its weapon's; converter 1.30+). */
    damage?: number[];
    /** Original levels: its model scale (absent: 1; converter 1.30+). */
    scale?: number;
    /** Original levels: its spell mask (the placement's; absent: the template table's). */
    spells?: number;
    /**
     * Original levels: kept out of the world until a scripted sequence makes it appear (its track
     * opens with Appear 0 and later shows it: Necros at the end of seqNecros). Not seen, not hit,
     * not thinking; a player's finished sequence brings it in, and it hides again when it respawns.
     */
    hidden?: boolean;
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
  puppets?: { archetype: string; placement: number; x: number; y: number; z: number; /** Radians, 0 = -Z. */ yaw?: number; /** Held item ids (null: nothing); absent: the archetype's. */ weapon?: string | null; shield?: string | null }[];
  /** Triggers, scripted sequences and cameras (original levels; original units, Z mirrored). */
  story?: LevelStory;
  /** Original levels: the mesh the act is built on (acts of one mesh share its coordinates). */
  mesh?: string;
  /**
   * A pit a fall cannot leave (FALL_CATCHES, metres): falling into `pit` puts the player at his
   * respawn spot; a checkpoint's volume makes its spot his respawn spot.
   */
  fallCatch?: {
    pit: { polygon: [number, number][]; yMin: number; yMax: number };
    checkpoints: { volume: { polygon: [number, number][]; yMin: number; yMax: number }; spot: { x: number; y: number; z: number } }[];
  };
}

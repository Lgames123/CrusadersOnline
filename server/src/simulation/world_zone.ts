import {
  SHOP_REOPEN_MS,
  entryPrice,
  giftFlag,
  isGiftShop,
  merchantBuys,
  shopStock,
  tradePrice,
  type ShopEntry,
  ANIM,
  BUILTIN_ITEMS,
  LEVEL_PREFIX,
  LEVEL_UNIT_METRES,
  floorAt,
  applyQuestAction,
  emptyStoryState,
  estimateSequenceMs,
  stagedPlayerSpot,
  stagedPlayerYaw,
  inStoryVolume,
  storyFlag,
  type StorySequence,
  type StoryState,
  type StoryCreatureOp,
  type StoryTrigger,
  type StoryShop,
  TICK_MS,
  setDoorPose,
  setBrushPose,
  stepDoorMotion,
  useMover,
  stepMover,
  moverPose,
  shutMover,
  MOVER_SHUT,
  MOVER_PARKED,
  MOVER_DONE,
  type MoverDef,
  type MoverMotion,
  swingKeyAwayFrom,
  swingPoint,
  swingPose,
  type DoorMotion,
  type DoorSwing,
  inPortal,
  UNARMED,
  PORTAL_OBJECT_BASE,
  PORTAL_USE_REACH,
  DYNAMIC_OBJECT_BASE,
  exitArrival,
  respawnPoint,
  type ExitCrossing,
  GOLD_ITEM,
  itemSlug,
  takeOne,
  addItem,
  mergeInventoryStacks,
  splitInventoryStack,
  moveInventoryGridItem,
  equipmentOf,
  sanitizeInventory,
  setEquipped,
  isEquippable,
  startingInventory,
  INVENTORY_SLOTS,
  type InventoryEntry,
  type InventoryItemView,
  type ShopItemView,
  type ItemCatalog,
  type ItemDef,
  COMBO_MULTIPLIERS,
  COMBO_QUEUE_FRACTION,
  DEFAULT_MOVEMENT_STATS,
  uniformMovementStats,
  locomotionAnim,
  isLocomotionAnim,
  movementAnim,
  looksGrounded,
  movementFacingOffset,
  attackAnim,
  BUILTIN_SPELLS,
  TICK_RATE,
  CASTABLE_SPELLS,
  CREATURE_CAST,
  CREATURE_SPELLS,
  creatureSpellBits,
  creatureSpellClipSeconds,
  PLAYER_CREATURE_TYPE,
  UNHOLY_TYPES,
  MANA_REGEN_TICKS,
  MAX_SPELL_LEVEL,
  SPELL_CONJURE_TICKS,
  SPELL_INFO,
  SPELL_RULES,
  SPELLS,
  CREATURE_TEMPLATES,
  dequantizePitch,
  spellClipSeconds,
  originalMaxMana,
  type KnownSpell,
  type SpellId,
  type SpellTable,
  type StatusTag,
  isLayeredSwing,
  SIDE_SWING_RECHAIN_TICKS,
  enabledFeatures,
  gameplayFeatures,
  type GameplayFeatures,
  UPPER_SWING_CODES,
  type AttackKind,
  INPUT,
  INTEREST_RADIUS,
  MAX_INPUT_FRAMES,
  MOB_ARCHETYPES,
  PLAYER_ARC_DEG,
  ORIGINAL_BLOCK_COS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  CHARACTER_GROUPS,
  PLAYER_REACH,
  PLAYER_RESPAWN_TICKS,
  SC,
  SpatialHashGrid,
  TICK_DT,
  createCharacter,
  createEntityState,
  createInputFrame,
  createMovementWorld,
  setDoorOpen,
  decodeInput,
  dequantizeAngle,
  encodeSnapshot,
  inMeleeArc,
  forwardXZ,
  attackSweep,
  hitShove,
  damageVector,
  levelForXp,
  originalDamageMultiplier,
  originalSpeedMultiplier,
  originalDamageTaken,
  originalFlinch,
  originalWeaponHit,
  playerMaxHp,
  playerRules,
  attackTiming,
  clipSwingTiming,
  chooseMobSequence,
  chooseMobSpecial,
  lineOfSight,
  mobBand,
  MOB_HOP_SWING_DELAY,
  MOB_HOP_TICKS,
  MOB_NEAR_SENSE_RANGE,
  MOB_POST_TICKS,
  MOB_SHIELD_TICKS,
  MOB_SIGHT_HALF_ANGLE,
  MOB_SIGHT_RANGE,
  MOB_SPECIAL_ROLL,
  MOB_TURN_RATE,
  MOB_UPPER_SWING_CODES,
  type MobAttack,
  type MobSequence,
  RUSH_CONTACT_SLACK,
  RUSH_PUSH_SHARE,
  RUSH_STEP_CHANCE,
  RUSH_STEPS_PER_SECOND,
  ACTION_IMPACT,
  ACTION_IMPACT_FRONT_ALT,
  ACTION_IMPACT_LEFT_ALT,
  ACTION_IMPACT_LOW_FRONT,
  ACTION_IMPACT_RIGHT_FRONT,
  ACTION_IMPACT_TWO_STEPS_BACK,
  IMPACT_VARIANTS,
  ACTION_KNOCKDOWN,
  ACTION_STUN,
  hitReactionTicks,
  isHitAction,
  startHitReaction,
  startTimedAction,
  ACTION_ATTACK,
  ACTION_BASH,
  ACTION_LUNGE,
  quantizeAngle,
  quantizePosition,
  removeCharacter,
  setCharacterState,
  snapshotMaxBytes,
  stepCharacter,
  yawTowards,
  type ArenaDef,
  type PortalDef,
  type Attributes,
  type Character,
  type CombatEventMsg,
  type DamageVector,
  type Difficulty,
  type EntityKind,
  type EntityState,
  type InputFrame,
  type MobArchetype,
  type MovementStats,
  type MovementWorld,
  type Rapier,
  type ServerControlMsg,
  type WorldObjectDef,
  type WorldObjectState,
  type SwingTiming,
} from '@crusaders/shared';
import { InputQueue } from './input_queue.ts';
import { SpellRuntime, type ActiveStatus, type SpellHost } from './spell_runtime.ts';

/** Snapshots older than this are not used as delta baselines (full snapshot instead). */
const MAX_BASELINE_AGE = 20;
const HISTORY_TICKS = 32;
const MOVE_MASK = INPUT.FORWARD | INPUT.BACK | INPUT.LEFT | INPUT.RIGHT;

export type PersistReason = 'periodic' | 'leave' | 'shutdown' | 'progress';

export interface ZoneOutbox {
  /** Binary frames are snapshots; strings are JSON control messages. */
  send(connId: number, data: Uint8Array | string): void;
  /** Immediate save request (e.g. after a kill reward or level-up). */
  persist?(records: PersistRecord[], reason: PersistReason): void;
  /**
   * A player walked into a portal trigger leading to `target` (once per entry), or a scripted
   * sequence loads another act; `keep`: arrive at this position if `target` is on the same mesh;
   * `via`: the exit taken and where the player crossed it (where he arrives, see exitArrival).
   */
  portal?(connId: number, target: string, keep?: { x: number; y: number; z: number; mesh: string }, via?: ExitCrossing): void;
}

export interface JoinOptions {
  name: string;
  /** Persistent character id, or null for ephemeral guests. */
  characterId: string | null;
  /** Saved feet position; null/invalid => next spawn point. */
  position?: { x: number; y: number; z: number } | null;
  yaw?: number;
  experience?: number;
  gold?: number;
  hp?: number;
  /** Saved inventory; absent or empty => the starting kit. */
  inventory?: InventoryEntry[];
  mana?: number;
  /** Known spells (levels) and the selected one. */
  spells?: KnownSpell[];
  selectedSpell?: SpellId | null;
  /** Arriving through a portal from this arena: placed at the portal leading back there. */
  arrivingFrom?: string;
  /** The exit taken to arrive (the original's entry point and offset, see exitArrival). */
  arrivingVia?: ExitCrossing;
  /** A story level change: arrive here if this arena is on `arrivingMesh` (another act of the same level). */
  arrivingAt?: { x: number; y: number; z: number };
  arrivingMesh?: string;
  /** Story progress: triggers fired and the quest book (story.ts). */
  story?: StoryState;
}

/** Player state carried across a zone transfer (everything but the position). */
export type TransferState = Omit<JoinOptions, 'position' | 'arrivingFrom' | 'arrivingVia' | 'arrivingAt' | 'arrivingMesh'>;

/** State a zone hands back for saving (see persistence/characters.ts). */
export interface PersistRecord {
  characterId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  level: number;
  experience: number;
  gold: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  spells: KnownSpell[];
  selectedSpell: SpellId | null;
  /** Full inventory, present only when it changed since the previous record. */
  inventory?: InventoryEntry[];
  /** Arena the character is in (characters.zone_id). */
  zone?: string;
  /** Forget the saved position (zone transfer: spawn at the destination's arrival point). */
  resetPosition?: boolean;
  story: StoryState;
}

export interface WorldZoneOptions {
  /** Random source in [0, 1); injectable for deterministic tests. */
  random?: () => number;
  /** Selects the default.ctx attribute and resist columns (default: medium). */
  difficulty?: Difficulty;
  /** Item definitions (default: the built-in catalog). */
  items?: ItemCatalog;
  /** Non-original gameplay features to switch on (features.ts; default: none, the original). */
  features?: Partial<GameplayFeatures>;
  /** Shorthand for features.reactiveBlock. */
  reactiveBlock?: boolean;
  /** Drake's spell table (default.ctx S rows; default: the slice values). */
  spells?: SpellTable;
}


/** World objects (original levels): interaction reach and respawn delays (slice values). */
const INTERACT_RANGE = 2.5;
const INTERACT_HEIGHT = 2;
/** Doors: reach from the door's bounds (they are up to 24 ft wide). */
const DOOR_INTERACT_RANGE = 1.8;
/** Mobs only notice players within this height difference (slice value). */
const AGGRO_HEIGHT = 3;
/** Height above the feet of a creature's line of sight (slice value). */
const EYE_HEIGHT = 1.5;
/** Signed difference a - b of two headings, wrapped to [-pi, pi]. */
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const OBJECT_RESPAWN_TICKS = 20 * 300; // 5 min: broken props come back (level items and chests never do)
const BREAKABLE_RADIUS = 0.5;
/** Hit-set key offset so swings can record breakables next to entity ids. */
const OBJECT_HIT_KEY = 1_000_000;
/** Dropped items: expire after 5 minutes (5 * 60 * 20 ticks), max 20 per player on ground. */
export const DROPPED_ITEM_LIFETIME_TICKS = 20 * 60 * 5;
export const MAX_DROPPED_ITEMS_PER_PLAYER = 20;

interface WorldObject {
  def: WorldObjectDef;
  state: WorldObjectState;
  hp: number;
  respawnAt: number;
  /** Swinging doors: the swing, the slab's shut footprint (x/z hull, metres) and the motion. */
  swing?: { def: DoorSwing; points: Float32Array; hull: [number, number][]; motion: DoorMotion | null; blocked: boolean };
  /** Other movers (gates, cell doors, levers): the original's keyframe mover and its motion. */
  mover?: { def: MoverDef; motion: MoverMotion };
  /** Dynamically dropped item in the world: never respawns, removed upon pickup or expiry. */
  dynamic?: boolean;
  /** Key of player who dropped this item (characterId or connection id). */
  ownerKey?: string;
  /** Tick at which the dropped item expires (5 minutes from drop). */
  expiresAt?: number;
}

type GroundGrant = { name: string; quantity: number; itemId?: string };

/** One change in an OBJECT_STATE message. */
interface ObjectChange {
  id: number;
  state: WorldObjectState;
  def?: WorldObjectDef;
  /** Entity that caused it (pickup, opening, destruction). */
  by?: number;
  /** Item names granted to `by`. */
  loot?: string[];
  /** Breakables: damage of this hit and remaining HP. */
  damage?: number;
  hp?: number;
  /** Breakables: the attacker's blade sweep (unit x, z), for the hit's sparks. */
  sweep?: [number, number];
  /** Swinging doors: the motion as of now. */
  swing?: DoorMotion;
  /** Other movers: the motion as of now. */
  mover?: MoverMotion;
}

/** Convex hull (x/z) of a brush's points, counter-clockwise (monotone chain). */
function hullXZ(points: Float32Array): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < points.length; i += 3) pts.push([points[i]!, points[i + 2]!]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  const upper: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Whether a circle (x, z, r) touches a convex polygon. */
function circleTouchesPolygon(poly: [number, number][], x: number, z: number, r: number): boolean {
  let inside = true;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % poly.length]!;
    const ex = bx - ax;
    const ez = bz - az;
    if (ex * (z - az) - ez * (x - ax) < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    if (Math.hypot(ax + t * ex - x, az + t * ez - z) < r) return true;
  }
  return inside;
}

/**
 * Peaceful creatures watching the player (brain mode 2, 0x40C190 / 0x408980): within 12 ft they
 * stop and face him; they go back to their idle behaviour once he is beyond 20 ft, at least 3 s
 * after they began. Their talk target (0x40DEB0) is one in this mode within 12 ft.
 */
const WATCH_NEAR = 12 * 0.3048;
const WATCH_FAR = 20 * 0.3048;
const WATCH_MIN_TICKS = 20 * 3;
/** Path walkers (0x405AC0): an arrival is this close to the point (metres; not decoded, slice value). */
const PATH_ARRIVE = 0.4;

/**
 * Citizens and an assault (logged in the original, Cs1a): the one struck flinches (ASM_IMPACT_*),
 * then it and every citizen who sees the player (raiseAlarm) stands on the alert facing it
 * (ASM_COMBAT_STANDING, ~0.25 s) and runs away from it (~7 s). Frightened, they stay wary: a
 * player coming within ~30 ft sets them off again at once.
 */
const ALERT_TICKS = 5;
const FLEE_TICKS = 20 * 7;
const WARY_RADIUS = 9;
const REALERT_TICKS = 2;
/** Talking: reach (12 ft, 0x40DEB0, plus slack) and turn rate (logged ~90 degrees a second). */
const TALK_REACH = WATCH_NEAR + 0.5;
const TALK_TURN_RATE = Math.PI / 2;
/** Longest line a client may ask a creature to gesture through (the longest NPC line is ~14 s). */
const TALK_MAX_MS = 20_000;
/** How long a frightened citizen stays wary (not measured: the capture ended first). */
const WARY_TICKS = 20 * 60;

/** Spectral ally: keeps within this of its owner (walking beyond, running beyond twice it), gives up a fight beyond the leash (not decoded; slice values). */
const ALLY_FOLLOW = 3;
const ALLY_LEASH = 25;

/** Metres below the lowest level geometry at which a falling player is caught. */
const FALL_MARGIN = 20;

/** Saved positions outside these bounds are discarded (fell out of the world, corrupt data). */
const MIN_VALID_Y = -50;
const MAX_VALID_COORD = 10_000;

function validPosition(p: JoinOptions['position']): p is { x: number; y: number; z: number } {
  return !!p && [p.x, p.y, p.z].every(Number.isFinite) && p.y > MIN_VALID_Y &&
    Math.abs(p.x) < MAX_VALID_COORD && Math.abs(p.z) < MAX_VALID_COORD;
}

interface Swing {
  combo: number;
  /** Directional attacks are single hits outside the combo chain. */
  kind: AttackKind;
  start: number;
  timing: SwingTiming;
  hit: Set<number>;
  /** A creature's swing on the upper body (during its forward hop): the legs keep their clip. */
  upper?: boolean;
  /** A creature attack's reach (centre to centre, m). */
  reach?: number;
}

interface ActorBase {
  entityId: number;
  name: string;
  character: Character;
  /** uint16 quantized yaw. */
  yaw: number;
  anim: number;
  hp: number;
  maxHp: number;
  swing: Swing | null;
  /** Tick at which a dead actor comes back; 0 while alive. */
  deadUntil: number;
  /** Tick until which a hit reaction (impact, stun, knock-down) keeps the actor from acting; 0 = none. */
  hitUntil: number;
  /** Characters the current shield rush has already put into their impact. */
  rushHit: Set<number>;
  /** Timed spell effects on it (spell_runtime.ts): slowed, frozen, heroism, stone skin... */
  statuses: Map<StatusTag, ActiveStatus>;
  /** Slowed: the part of a tick carried over (it acts on whole ticks only). */
  timeAcc: number;
}

interface Player extends ActorBase {
  kind: 'player';
  /** Movement stats: the original's, the server's features, and the clip rate (speed multiplier). */
  moveStats: MovementStats;
  connId: number;
  characterId: string | null;
  /** Where he comes back after dying: the beginning of the area he entered by (respawnPoint). */
  respawnSpot: { x: number; y: number; z: number };
  queue: InputQueue;
  lastProcessedInput: number;
  ackTick: number;
  history: Map<number, Map<number, EntityState>>;
  known: Set<number>;
  malformed: number;
  xp: number;
  gold: number;
  level: number;
  queuedAttack: boolean;
  /** Swings started (entity flags bit 3 flips with it, so clients restart a repeated layered swing). */
  swingSerial: number;
  mana: number;
  maxMana: number;
  spells: KnownSpell[];
  selectedSpell: SpellId | null;
  /**
   * The spell being cast: conjuring (ASM_SPELL_CONJURE, self spells) until `clipAt`, then its own
   * state; it takes effect at `releaseAt` (the clip's SPELL event) and is over at `end`. `upper`:
   * cast while moving, on the upper body (the feet are free).
   */
  cast: { spell: SpellId; level: number; clipAt: number; releaseAt: number; end: number; released: boolean; upper: boolean } | null;
  /** View pitch of the latest input (radians, up positive): spells aim with it. */
  pitch: number;
  /** Speed multiplier before spell effects (stats +0x24C). */
  baseClipRate: number;
  /** Tick of the next mana point while below the maximum. */
  manaRegenAt: number;
  /** Torch light around the player (radius in metres) until `until`. */
  light: { radius: number; level: number; until: number } | null;
  /** Body yaw offset from the view yaw (diagonal movement), radians; replicated in the yaw. */
  facingOffset: number;
  statsDirty: boolean;
  attributes: Attributes;
  resist: DamageVector;
  inventory: InventoryEntry[];
  inventoryDirty: boolean;
  /** Equipment change requested mid-swing, applied when the swing ends. */
  pendingEquip: { slot: number; equip: boolean; itemId?: string; to?: { x: number; y: number } } | null;
  weapon: ItemDef;
  armor: ItemDef | null;
  damageMultiplier: number;
  shield: ItemDef | null;
  /** Portals whose trigger the player is standing in (fires on entry only). */
  inPortal: Set<number>;
  /** Shield raised this tick (BLOCK held, shield equipped, not swinging or flinching). */
  blocking: boolean;
  /** Story progress (fired triggers, quest book). */
  story: StoryState;
  storyFlags: Set<string>;
  /** Walk-in sound triggers the player stands in (each plays on entering). */
  insideSounds: Set<number>;
  /** The shop visit in progress: this visit's copy of its items (0x46D3D0). */
  shop: { id: number; stock: ShopEntry[]; openedAt: number; gift: boolean } | null;
  /** A scripted sequence the client is playing; the server finishes it by `until` at the latest. */
  cutscene: { sequence: StorySequence; until: number } | null;
}

interface Mob extends ActorBase {
  kind: 'mob';
  archetype: MobArchetype;
  weapon: ItemDef;
  shield: ItemDef | null;
  /** Tick until which the shield is raised (AI block); 0 = lowered. */
  blockUntil: number;
  nextBlockTick: number;
  spawn: { x: number; y: number; z: number };
  /** Heading at its placement (radians, quantized). */
  spawnYaw: number;
  state: 'idle' | 'chase' | 'return' | 'flee' | 'talk' | 'watch';
  threat: Map<number, number>;
  /**
   * The original's melee brain (0x00409520): deciding, running in (beyond 12 ft), walking in
   * (shield up) to its engage distance, an attack sequence, the pause after it, and what follows
   * an attack (shield up, or stepping back without a shield).
   */
  brain: 'decide' | 'run' | 'walkIn' | 'attack' | 'pause' | 'post' | 'spell';
  /** The decision before the current one (an attack is followed by 'post'). */
  lastPick: 'run' | 'walkIn' | 'attack' | 'post' | 'spell' | null;
  /**
   * A caster's spell phase (0x0040AA20): which choice of 0x004096A0 led to it, the cast playing
   * (its template mask bit, the target, the clip's SPELL event — null when the clip has none —
   * and its end) and the end of the cooldown (+0xE0, from the start of the last cast).
   */
  spellPick: 'close' | 'ranged' | null;
  mobCast: { bit: number; target: number; releaseAt: number | null; end: number; released: boolean } | null;
  spellReadyAt: number;
  /** End of the pause / the post-attack phase. */
  brainUntil: number;
  /** The attack sequence playing: the hop, its upper-body swing, the swings after it. */
  seq: (MobSequence & { upperAt: number; hopUntil: number }) | null;
  /** Shield raised on the upper body until this tick (after an attack). */
  shieldUntil: number;
  /** Walking in with the shield raised (this tick). */
  walkShield: boolean;
  /** Swings started (entity flags bit 3 flips with it, so clients restart a repeated upper swing). */
  swingSerial: number;
  /** Tick at which a shield rush's reel turns into the knock-down (0 = none). */
  knockdownAt: number;
  /**
   * Its idle walk (stats +0x1DC, 0x405AC0): the point it heads for, the direction along the path
   * (0x405FF0) and the end of its pause at the last point reached.
   */
  path: { points: { x: number; y: number; z: number }[]; pause: number; loop: boolean } | null;
  pathIndex: number;
  pathForward: boolean;
  pathWaitUntil: number;
  /** Watching a player (brain mode 2): since this tick; the player it faces. */
  watchSince: number;
  watchTo: number;
  /** Its talk line (Sound.ctx id; -1 = it has none: the use key does nothing). */
  talkLine: number;
  /** It gestures through its line (idle behaviour +0x3C set; 0x40E8C0): else it just faces the player. */
  gestures: boolean;
  /** Fleeing citizen: on the alert until this tick, then running from `fleeFrom` until `fleeUntil`. */
  alertUntil: number;
  fleeUntil: number;
  fleeFrom: { x: number; z: number };
  /** Frightened before: until this tick a player coming close sets it off again. */
  waryUntil: number;
  /** Talking: to this player (entity id) until this tick. */
  talkTo: number;
  talkUntil: number;
  input: InputFrame;
  stats: MovementStats;
  /** Original levels: index in the act's placements (scripted sequences name actors by it). */
  placement?: number;
  /**
   * Told by a relay to fight the nearest enemy (op 0x0D, brain flag 0x400, 0x40DC90): it notices
   * players in sight at any range and any angle. Cleared when it respawns.
   */
  fightsNearest?: boolean;
  /** A spectral ally (disposition 6): the player it fights for (entity id). */
  ally?: number;
  /** Its weapon's damage when not the item's (the spectral ally's, by spell level). */
  damage?: DamageVector;
}

type Actor = Player | Mob;

const alive = (a: Actor) => a.deadUntil === 0;
/** Unarmed peaceful creatures (citizens, merchants): no flinch, no fighting back - they run. */
/** The edge picking a blow's impact sound (0x44CEF0 / 0x44D290): outgoing SLASH above BASH. */
const sharpEdge = (a: { weapon: { damage?: readonly number[] } }) => !!a.weapon.damage && a.weapon.damage[1]! < a.weapon.damage[0]!;
const isCitizen = (m: Mob) => m.archetype.passive && m.weapon.id === UNARMED.id;
/** Minimum distance between two characters' centres (two capsule radii). */
const CHARACTER_SPACING = 2 * PLAYER_RADIUS;
/** Quick shield block clip (PE07, 20 frames at 1000/30 fps). */
const MOB_BLOCK_ANIM_TICKS = Math.round((20 / (1000 / 30)) * 20);
/** A blocked rush step's 5 % roll, over the original's steps in one tick. */
const RUSH_TICK_CHANCE = 1 - (1 - RUSH_STEP_CHANCE) ** (RUSH_STEPS_PER_SECOND / TICK_RATE);

/**
 * One authoritative world zone: shared collision world, player characters driven only by
 * client inputs, server-driven mobs, authoritative melee, and per-client interest-filtered
 * delta snapshots. Pure (no I/O), so it runs inside a worker thread or directly in tests.
 */
export class WorldZone {
  readonly name: string;
  readonly arena: ArenaDef;
  tick = 0;

  private readonly mw: MovementWorld;
  private readonly outbox: ZoneOutbox;
  private readonly random: () => number;
  private readonly difficulty: Difficulty;
  private readonly reactiveBlock: boolean;
  private readonly features: GameplayFeatures;
  /** Players' movement stats (the original's, plus feature diagonalMoves). */
  private readonly playerStats: MovementStats;
  private readonly spells: SpellTable;
  private readonly items: ItemCatalog;
  private readonly grid = new SpatialHashGrid(32);
  private readonly players = new Map<number, Player>(); // by connId
  /** Relays touched by a player whose timer (StoryTrigger.delay) is running: fire at `due`. */
  private pendingRelays: { connId: number; trigger: StoryTrigger; due: number; played: boolean }[] = [];
  private readonly actors = new Map<number, Actor>(); // by entityId
  private readonly states = new Map<number, EntityState>();
  private nextEntityId = 1;
  private spawnIndex = 0;
  /** Respawn points by way in (respawnFor). */
  private respawns = new Map<string, { x: number; y: number; z: number }>();
  private encodeBuf = new DataView(new ArrayBuffer(16 * 1024));
  private readonly scratchIds: number[] = [];
  private readonly scratchFrames: InputFrame[] = Array.from({ length: MAX_INPUT_FRAMES }, createInputFrame);
  private readonly frame = createInputFrame();
  private readonly objects = new Map<number, WorldObject>();
  private nextDynamicObjectId = DYNAMIC_OBJECT_BASE;
  /** Dropped item IDs per player (oldest to newest, capped at MAX_DROPPED_ITEMS_PER_PLAYER). */
  private readonly playerDroppedItems = new Map<string, number[]>();
  /** Height below which a player has fallen out of the level (catchFall). */
  private readonly fallLimit: number;
  /** The spell objects and timed effects (spell_runtime.ts). */
  private readonly magic: SpellRuntime;

  constructor(rapier: Rapier, name: string, arena: ArenaDef, outbox: ZoneOutbox, opts: WorldZoneOptions = {}) {
    this.name = name;
    this.arena = arena;
    this.outbox = outbox;
    this.random = opts.random ?? Math.random;
    this.difficulty = opts.difficulty ?? 'medium';
    this.features = gameplayFeatures({ ...opts.features, ...(opts.reactiveBlock ? { reactiveBlock: true } : {}) });
    this.reactiveBlock = this.features.reactiveBlock;
    this.playerStats = { ...DEFAULT_MOVEMENT_STATS, diagonalMoves: this.features.diagonalMoves };
    this.spells = opts.spells ?? BUILTIN_SPELLS;
    this.items = opts.items ?? BUILTIN_ITEMS;
    this.mw = createMovementWorld(rapier, arena);
    // Lowest level geometry (mesh or boxes) less a margin: below it, a player has fallen out.
    let lowest = Infinity;
    for (const m of arena.meshes) for (let i = 1; i < m.vertices.length; i += 3) lowest = Math.min(lowest, m.vertices[i]!);
    for (const b of arena.boxes) lowest = Math.min(lowest, b.y - b.hy);
    this.fallLimit = (Number.isFinite(lowest) ? lowest : 0) - FALL_MARGIN;
    for (const s of arena.mobSpawns) this.spawnMob(s.archetype, s);
    for (const def of arena.objects ?? []) this.objects.set(def.id, { def, state: 'present', hp: def.hp ?? 0, respawnAt: 0 });
    for (const b of arena.brushes ?? []) {
      const o = b.door !== undefined ? this.objects.get(b.door) : undefined;
      if (o && b.swing) o.swing = { def: b.swing, points: b.points, hull: hullXZ(b.points), motion: null, blocked: false };
      else if (o && b.mover) o.mover = { def: b.mover, motion: shutMover() };
    }
    this.magic = new SpellRuntime(this.spellHost());
  }

  /** What the spell runtime may do to the zone's characters. */
  private spellHost(): SpellHost {
    const actor = (a: unknown) => a as Actor;
    return {
      mw: this.mw,
      tick: () => this.tick,
      random: () => this.random(),
      characters: () => this.actors.values(),
      alive: (a) => alive(actor(a)),
      hostile: (a, b) => this.hostile(actor(a), actor(b)),
      creatureType: (a) => this.creatureType(actor(a)),
      resist: (a, t) => {
        const x = actor(a);
        return x.kind === 'player' ? (x.resist[t] ?? 1) * (x.armor?.protection?.[t] ?? 1) : x.archetype.resist[t] ?? 1;
      },
      damage: (a, t, vector, push) => {
        const target = actor(t);
        if (!alive(target)) return;
        this.applyDamage(actor(a), target, vector);
        if (push && alive(target)) this.moveBy(target, push.x * push.d, push.z * push.d);
      },
      drain: (a, v, amount) => {
        const victim = actor(v);
        const take = Math.min(victim.hp, amount);
        if (take <= 0 || !alive(victim)) return 0;
        victim.hp -= take;
        if (victim.kind === 'player') victim.statsDirty = true;
        // Drawn dry: the death (no blow of its own).
        if (victim.hp <= 1e-6) {
          victim.hp = 0;
          this.loseHp(actor(a), victim, 0);
        }
        return take;
      },
      heal: (a, amount) => {
        const x = actor(a);
        if (!alive(x)) return;
        x.hp = Math.min(x.maxHp, x.hp + amount);
        if (x.kind === 'player') x.statsDirty = true;
      },
      emit: (at, d) => this.broadcastAt(at, { op: SC.SPELL_EVENT, d }),
      statusChanged: (a) => {
        const x = actor(a);
        if (x.kind !== 'player') return;
        // Haste (SPED) and slows change the clip rate the movement follows (the client predicts it from PLAYER_STATS speed).
        x.moveStats = { ...x.moveStats, clipRate: x.baseClipRate * this.playerRate(x) };
        x.statsDirty = true;
      },
      summonAlly: (owner, level, at, yaw, until) => this.summonAlly(actor(owner), level, at, yaw, until),
      dismissAlly: (a) => this.removeMob(actor(a) as Mob),
    };
  }

  /** A player's speed from spell effects (haste, slows; a freeze stops his input instead). */
  private playerRate(p: Player): number {
    let rate = 1;
    for (const st of p.statuses.values()) if (st.rate !== undefined && st.rate > 0) rate *= st.rate;
    return rate;
  }

  /**
   * Whether `a` may harm `b`: players and their spectral allies on one side, creatures on the
   * other. Allies leave peaceful creatures alone.
   */
  /** The creature type spells test (holy wrath, soul drinker): Drake is 142. */
  private creatureType(a: Actor): number {
    return a.kind === 'player' ? PLAYER_CREATURE_TYPE : a.archetype.type ?? 0;
  }

  private hostile(a: Actor, b: Actor): boolean {
    if (a === b) return false;
    const players = (x: Actor) => x.kind === 'player' || x.ally !== undefined;
    if (players(a) === players(b)) return false;
    if (a.kind === 'mob' && a.ally !== undefined && b.kind === 'mob' && b.archetype.passive) return false;
    return true;
  }

  /** Summons a spectral ally (type 155) for `owner` (0x00440230: HP, weapon and resists by level). */
  private summonAlly(owner: Actor, level: number, at: { x: number; y: number; z: number }, yaw: number, until: number): Actor | null {
    if (owner.kind !== 'player') return null;
    const R = SPELL_RULES;
    const i = Math.max(0, Math.min(2, level - 1));
    const [slash, bash, light] = R.allyDamage[i]!;
    const base = MOB_ARCHETYPES['spectral_ally']!;
    const id = this.spawnMob('spectral_ally', { archetype: 'spectral_ally', x: at.x, y: at.y, z: at.z, yaw: dequantizeAngle(yaw), hp: R.allyHp[i]!, resist: base.resist.map(() => R.allyResist[i]!) });
    const m = this.actors.get(id) as Mob | undefined;
    if (!m) return null;
    m.ally = owner.entityId;
    m.name = 'Spectral Ally';
    m.damage = damageVector({ SLASH: slash, BASH: bash, LIGHT: light });
    void until;
    return m;
  }

  /** Takes a creature out of the zone (a dismissed ally). */
  private removeMob(m: Mob): void {
    if (!this.actors.has(m.entityId)) return;
    this.magic.forget(m);
    removeCharacter(this.mw, m.character);
    this.grid.remove(m.entityId);
    this.states.delete(m.entityId);
    this.actors.delete(m.entityId);
    for (const a of this.actors.values()) if (a.kind === 'mob') a.threat.delete(m.entityId);
  }

  /** Sends to every player within interest range of a point. */
  private broadcastAt(at: { x: number; z: number }, msg: ServerControlMsg): void {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) {
      const pp = p.character.position;
      if (Math.hypot(pp.x - at.x, pp.z - at.z) <= INTEREST_RADIUS) this.outbox.send(p.connId, text);
    }
  }

  get playerCount(): number {
    return this.players.size;
  }

  private sendJson(connId: number, msg: ServerControlMsg): void {
    this.outbox.send(connId, JSON.stringify(msg));
  }

  private register(a: Actor): void {
    this.actors.set(a.entityId, a);
    this.states.set(a.entityId, createEntityState(a.entityId));
    const p = a.character.position;
    this.grid.update(a.entityId, p.x, p.z);
  }

  private spawnMob(archetypeId: string, at: ArenaDef['mobSpawns'][number]): number {
    const base = MOB_ARCHETYPES[archetypeId];
    if (!base) throw new Error(`unknown mob archetype ${archetypeId}`);
    // Original level placements carry their own HP, XP value and resists.
    const archetype: MobArchetype = {
      ...base,
      ...(at.hp !== undefined && at.hp > 0 ? { maxHp: at.hp } : {}),
      ...(at.xp !== undefined ? { xpReward: at.xp } : {}),
      ...(at.resist?.length === 11 ? { resist: at.resist } : {}),
    };
    // Original placements hold what their inventory header names (null: nothing); an item this
    // catalogue lacks keeps the archetype's.
    const placed = (id: string | null | undefined) => (id === undefined ? undefined : id === null ? null : this.items.get(id));
    const heldWeapon = placed(at.weapon);
    const heldShield = placed(at.shield);
    const weapon = (heldWeapon === null ? UNARMED : heldWeapon?.type === 'weapon' ? heldWeapon : undefined)
      ?? this.items.get(archetype.weapon) ?? (archetype.passive ? UNARMED : undefined);
    if (!weapon) throw new Error(`unknown weapon ${archetype.weapon} for ${archetypeId}`);
    const shield = heldShield === null ? null : heldShield?.type === 'shield' ? heldShield : archetype.shield ? this.items.get(archetype.shield) ?? null : null;
    const mob: Mob = {
      kind: 'mob',
      entityId: this.nextEntityId++,
      name: archetype.name,
      character: createCharacter(this.mw, at),
      yaw: quantizeAngle(at.yaw ?? 0),
      anim: ANIM.IDLE,
      hp: archetype.maxHp,
      maxHp: archetype.maxHp,
      swing: null,
      deadUntil: 0,
      hitUntil: 0,
      archetype,
      weapon,
      shield,
      blockUntil: 0,
      nextBlockTick: 0,
      spawn: { x: at.x, y: at.y, z: at.z },
      spawnYaw: quantizeAngle(at.yaw ?? 0),
      state: 'idle',
      threat: new Map(),
      brain: 'decide',
      lastPick: null,
      spellPick: null,
      mobCast: null,
      spellReadyAt: 0,
      brainUntil: 0,
      seq: null,
      shieldUntil: 0,
      walkShield: false,
      swingSerial: 0,
      knockdownAt: 0,
      rushHit: new Set(),
      path: at.path ?? null,
      pathIndex: 0,
      pathForward: false,
      pathWaitUntil: 0,
      watchSince: 0,
      watchTo: 0,
      talkLine: at.talk ?? (at.placement === undefined ? 0 : -1),
      gestures: at.gesture !== undefined || at.placement === undefined,
      alertUntil: 0,
      fleeUntil: 0,
      waryUntil: 0,
      talkTo: 0,
      talkUntil: 0,
      fleeFrom: { x: 0, z: 0 },
      input: createInputFrame(),
      // Creatures share the humanoid rig's root-motion speeds (run, walk); no jumping.
      stats: { ...DEFAULT_MOVEMENT_STATS, jumpVelocity: 0 },
      ...(at.placement !== undefined ? { placement: at.placement } : {}),
      statuses: new Map(),
      timeAcc: 0,
    };
    this.register(mob);
    return mob.entityId;
  }

  join(connId: number, opts: JoinOptions): number {
    if (this.players.has(connId)) throw new Error(`connection ${connId} already in zone`);
    // Nowhere to resume in an original act: its first start point, as a new game (0x476F20).
    const start = !opts.arrivingAt && !opts.arrivingFrom && !validPosition(opts.position) ? this.arena.starts?.[0] : undefined;
    // Through an exit: the original's entry point; the heading carries over unless it names one.
    const arr = opts.arrivingFrom ? exitArrival(this.arena, opts.arrivingFrom, opts.arrivingVia) : null;
    const respawnSpot = this.respawnFor(opts.arrivingFrom, opts.arrivingVia);
    // Logging in: where he logged out, unless he was dead (saved HP 0) or below the level.
    const resume = validPosition(opts.position) && (opts.hp === undefined || opts.hp > 0) && opts.position.y >= this.fallLimit
      ? opts.position
      : respawnSpot;
    const spawn = opts.arrivingAt && opts.arrivingMesh && opts.arrivingMesh === this.arena.mesh && validPosition(opts.arrivingAt)
      ? opts.arrivingAt
      : arr
        ? arr
        : validPosition(opts.position) ? resume : start ?? this.nextSpawnPoint();
    const xp = Math.max(0, Math.floor(opts.experience ?? 0));
    const level = levelForXp(xp);
    const rules = playerRules(this.difficulty);
    const maxHp = playerMaxHp(rules.attributes, level);
    const hp = opts.hp !== undefined && opts.hp > 0 ? Math.min(opts.hp, maxHp) : maxHp;
    const saved = sanitizeInventory(opts.inventory ?? [], this.items);
    const inventory = saved.length > 0 ? saved : startingInventory();
    const eq = equipmentOf(inventory, this.items);
    const maxMana = originalMaxMana(rules.attributes, level);
    const spells = (opts.spells ?? []).map((s) => ({ ...s }));
    const selectedSpell = opts.selectedSpell && spells.some((s) => s.spell === opts.selectedSpell) ? opts.selectedSpell : spells[0]?.spell ?? null;
    const p: Player = {
      kind: 'player',
      connId,
      entityId: this.nextEntityId++,
      characterId: opts.characterId,
      respawnSpot,
      name: opts.name,
      character: createCharacter(this.mw, spawn),
      moveStats: { ...this.playerStats, clipRate: originalSpeedMultiplier(rules.attributes, level) },
      baseClipRate: originalSpeedMultiplier(rules.attributes, level),
      pitch: 0,
      statuses: new Map(),
      timeAcc: 0,
      queue: new InputQueue(),
      yaw: start ? quantizeAngle(start.yaw) : arr?.yaw !== undefined ? quantizeAngle(arr.yaw) : (opts.yaw ?? 0) & 0xffff,
      anim: ANIM.IDLE,
      hp,
      maxHp,
      swing: null,
      deadUntil: 0,
      lastProcessedInput: 0,
      ackTick: 0,
      history: new Map(),
      known: new Set(),
      malformed: 0,
      xp,
      gold: Math.max(0, Math.floor(opts.gold ?? 0)),
      level,
      queuedAttack: false,
      swingSerial: 0,
      rushHit: new Set(),
      mana: Math.min(maxMana, Math.max(0, Math.floor(opts.mana ?? maxMana))),
      maxMana,
      spells,
      selectedSpell,
      cast: null,
      manaRegenAt: 0,
      light: null,
      facingOffset: 0,
      statsDirty: true,
      attributes: rules.attributes,
      resist: rules.resist,
      inventory,
      inventoryDirty: saved.length === 0,
      pendingEquip: null,
      weapon: eq.weapon,
      armor: eq.armor,
      damageMultiplier: originalDamageMultiplier(rules.attributes, level),
      hitUntil: 0,
      shield: eq.shield,
      inPortal: new Set(),
      blocking: false,
      story: opts.story ? { flags: [...opts.story.flags], quests: structuredClone(opts.story.quests) } : emptyStoryState(),
      storyFlags: new Set(opts.story?.flags ?? []),
      insideSounds: new Set(),
      shop: null,
      cutscene: null,
    };
    this.players.set(connId, p);
    this.register(p);
    for (const portal of this.arena.portals ?? []) {
      if (inPortal(portal, spawn, 0.5)) p.inPortal.add(portal.id);
    }
    this.sendJson(connId, {
      op: SC.WORLD_ENTER,
      d: {
        entityId: p.entityId, zone: this.name, arena: this.arena.name, serverTick: this.tick, spawn: { ...p.character.position }, yaw: dequantizeAngle(p.yaw),
        ...(Object.keys(enabledFeatures(this.features)).length ? { features: enabledFeatures(this.features) } : {}),
      },
    });
    this.sendStats(p);
    this.sendInventory(p);
    this.sendJson(connId, { op: SC.QUEST_LOG, d: { log: p.story.quests } });
    if (this.objects.size) {
      const changed = [...this.objects.values()]
        .filter((o) => this.stateFor(p, o) !== 'present' || o.dynamic)
        .map((o) => ({
          id: o.def.id,
          state: this.stateFor(p, o),
          ...(o.dynamic ? { def: o.def } : {}),
          ...(o.swing?.motion ? { swing: { ...o.swing.motion } } : {}),
          ...(o.mover ? { mover: { ...o.mover.motion } } : {}),
        }));
      this.sendJson(connId, { op: SC.OBJECT_STATE, d: { objects: changed, full: true } });
    }
    return p.entityId;
  }

  /**
   * Picks up a ground item, opens a chest or a door (CS_INTERACT): within reach, still there,
   * alive. A locked door opens only with `key` (the use key) and its key in the bag.
   */
  interact(connId: number, id: number, key = false): void {
    const p = this.players.get(connId);
    if (p && id >= PORTAL_OBJECT_BASE && id < DYNAMIC_OBJECT_BASE) {
      // A door exit in reach (its trigger, widened by PORTAL_USE_REACH).
      const portal = this.arena.portals?.find((q) => q.id === id - PORTAL_OBJECT_BASE);
      if (portal?.use && alive(p) && inPortal(portal, p.character.position, PORTAL_USE_REACH)) this.outbox.portal?.(p.connId, portal.target, undefined, this.crossing(portal, p));
      return;
    }
    if (p && alive(p) && !p.cutscene) this.useStory(p);
    const o = this.objects.get(id);
    // A swinging door may be opened again while it swings shut.
    // A parked mover is used again to send it back (0x48EC10).
    const reopens = o?.swing?.motion?.phase === 'closing' || o?.mover?.motion.state === MOVER_PARKED;
    if (!p || !o || !alive(p) || (this.stateFor(p, o) !== 'present' && !reopens) || o.def.kind === 'breakable') return;
    if (o.def.kind === 'door' || o.def.kind === 'lever') {
      this.openDoor(p, o, key);
      return;
    }
    if (p.cutscene) return;
    const pos = p.character.position;
    if (Math.hypot(o.def.x - pos.x, o.def.z - pos.z) > INTERACT_RANGE || Math.abs(o.def.y - pos.y) > INTERACT_HEIGHT) return;
    const grants: GroundGrant[] = o.def.kind === 'item' ? (o.def.item ? [o.def.item] : []) : (o.def.contents ?? []);
    // All or nothing: a bag that cannot hold everything takes nothing, and it all stays there.
    if (!this.fitsAll(p, grants)) {
      this.sendJson(connId, { op: SC.ERROR, d: { code: 'bag_full', message: 'Inventory full.' } });
      return;
    }
    const loot: string[] = [];
    for (const g of grants) {
      const got = this.grantItem(p, g.name, g.quantity, g.itemId);
      if (got > 0) loot.push(got > 1 ? `${got} ${g.name}` : g.name);
    }
    if (o.def.kind === 'item' && grants.length && !loot.length) {
      return; // unknown item, or a book already known
    } else if (o.dynamic) {
      o.state = 'gone';
      this.objects.delete(id);
      this.forgetDropped(o, id);
      this.broadcastObjects([{ id, state: 'gone', by: p.entityId, loot }]);
    } else {
      // A level item or chest: gone for this character for good, still there for the others.
      const flag = this.takenFlag(id);
      p.storyFlags.add(flag);
      p.story.flags.push(flag);
      this.sendObjects(p, [{ id, state: this.stateFor(p, o), by: p.entityId, loot }]);
    }
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
  }

  /**
   * Opens a door in reach (its bounds); a locked one needs its key carried and the use key, a
   * lever-operated one its lever. Pulling a lever opens its doors. Swinging doors swing shut
   * after their delay (stepDoors); the others stay open.
   */
  private openDoor(p: Player, o: WorldObject, key: boolean): void {
    const b = o.def.bounds;
    if (!b || o.def.byLever) return;
    const pos = p.character.position;
    const dx = Math.max(b[0] - pos.x, 0, pos.x - b[3]);
    const dz = Math.max(b[2] - pos.z, 0, pos.z - b[5]);
    if (Math.hypot(dx, dz) > DOOR_INTERACT_RANGE || pos.y < b[1] - INTERACT_HEIGHT || pos.y > b[4]) return;
    if (o.def.lock) {
      const keyId = itemSlug(o.def.lock);
      if (!key || !p.inventory.some((e) => e.itemId === keyId)) return;
    }
    const changes: ObjectChange[] = [];
    for (const target of [o, ...(o.def.opens ?? []).map((id) => this.objects.get(id))]) {
      const mv = target?.mover;
      if (target && mv) {
        // The original's use (0x48EC10); a lever that does not move pulls nothing.
        if (!useMover(mv.def, mv.motion)) {
          if (target === o) break;
          continue;
        }
        target.state = 'open';
        changes.push({ id: target.def.id, state: 'open', by: p.entityId, mover: { ...mv.motion } });
        continue;
      }
      const sw = target?.swing;
      if (target && sw) {
        // A swinging door opens away from the player; one swinging shut opens again.
        if (sw.motion && sw.motion.phase !== 'closing') continue;
        sw.motion = sw.motion
          ? { ...sw.motion, phase: 'opening' }
          : { key: swingKeyAwayFrom(sw.def, sw.points, pos.x, pos.z), progress: 0, phase: 'opening', holdLeftMs: 0 };
        target.state = 'open';
        changes.push({ id: target.def.id, state: 'open', by: p.entityId, swing: { ...sw.motion } });
        continue;
      }
      if (!target || target.state === 'open') continue;
      target.state = 'open';
      setDoorOpen(this.mw, target.def.id, true);
      changes.push({ id: target.def.id, state: 'open', by: p.entityId });
    }
    this.broadcastObjects(changes);
  }

  /** Catalog item of a ground grant: a dropped item by its id, a level item by its name. */
  private groundItemDef(g: GroundGrant): ItemDef | undefined {
    return (g.itemId !== undefined ? this.items.get(g.itemId) : undefined) ?? this.items.get(g.name) ?? this.items.get(itemSlug(g.name));
  }

  /** Whether the bag takes every bag item of `grants` whole (grantItem's placement, on a copy). */
  private fitsAll(p: Player, grants: readonly GroundGrant[]): boolean {
    const bag = structuredClone(p.inventory);
    for (const g of grants) {
      const def = g.name === GOLD_ITEM ? undefined : this.groundItemDef(g);
      if (!def || def.type === 'spellbook') continue;
      const n = Math.max(1, g.quantity);
      if (def.stackable) {
        if (addItem(bag, def.id, n, this.items) === null) return false;
      } else {
        for (let i = 0; i < n; i++) if (addItem(bag, def.id, 1, this.items) === null) return false;
      }
    }
    return true;
  }

  /**
   * Gold goes to the purse; known items to the bag (stacking potions). Returns how many were
   * taken: a stack is taken whole or not at all, single items one by one until the bag is full.
   */
  private grantItem(p: Player, name: string, quantity: number, itemId?: string): number {
    const n = Math.max(1, quantity);
    if (name === GOLD_ITEM) {
      p.gold += n;
      p.statsDirty = true;
      return n;
    }
    const def = this.groundItemDef({ name, quantity, ...(itemId !== undefined ? { itemId } : {}) });
    if (!def) return 0;
    // A spell book is used as soon as it is touched (items.ctx): the spell is learned.
    if (def.type === 'spellbook' && def.spell) return this.learnSpell(p, def.spell) ? n : 0;
    let added = 0;
    if (def.stackable) added = addItem(p.inventory, def.id, n, this.items) === null ? 0 : n;
    else while (added < n && addItem(p.inventory, def.id, 1, this.items) !== null) added++;
    if (added) {
      p.inventoryDirty = true;
      this.sendInventory(p);
    }
    return added;
  }

  /**
   * Learns a spell (level 1), or raises a known one by a level (0x004BCD10: a known spell's level
   * index + 1, capped at 2). A book of a spell already at the top is used up all the same.
   */
  private learnSpell(p: Player, spell: SpellId): boolean {
    const known = p.spells.find((s) => s.spell === spell);
    if (known) {
      known.level = Math.min(MAX_SPELL_LEVEL, known.level + 1);
    } else {
      p.spells.push({ spell, level: 1 });
      p.selectedSpell ??= spell;
    }
    p.statsDirty = true;
    return true;
  }

  /** Selects the spell the cast key casts (CS_SELECT_SPELL). */
  selectSpell(connId: number, spell: SpellId): void {
    const p = this.players.get(connId);
    if (!p || !p.spells.some((s) => s.spell === spell)) return;
    p.selectedSpell = spell;
    p.statsDirty = true;
  }

  /** Whether a player's spell effects hold him still (frozen, the thaw's stun). */
  private held(a: Actor): boolean {
    return a.statuses.has('FRZE') || a.statuses.has('THAW');
  }

  /**
   * Casts the selected spell (CS_CAST_SPELL; 0x0042B7A0): on the ground, not swinging or reeling,
   * with the mana for its level (+0x20). Self spells conjure first (ASM_SPELL_CONJURE, 1.54 s)
   * with the feet planted; the others go straight to their state, on the upper body when the
   * player is moving. The wind-up (+0x24) shows at once; the spell takes effect on its clip's
   * SPELL event (finishCast).
   */
  castSpell(connId: number): void {
    const p = this.players.get(connId);
    if (!p || !alive(p) || p.cast || p.swing || p.hitUntil > this.tick || !p.character.grounded || p.cutscene || this.held(p)) return;
    const spell = p.selectedSpell;
    const known = spell && p.spells.find((s) => s.spell === spell);
    if (!spell || !known || !CASTABLE_SPELLS.has(spell)) return;
    const values = this.spells[spell]?.[known.level - 1];
    if (!values || p.mana < values.mana) return;
    const info = SPELL_INFO[spell];
    const rate = p.moveStats.clipRate ?? 1;
    const clipAt = this.tick + (info.conjure ? Math.round(SPELL_CONJURE_TICKS / rate) : 0);
    const clip = spellClipSeconds(spell, rate);
    const upper = !info.conjure && isLocomotionAnim(p.anim);
    p.cast = {
      spell, level: known.level, clipAt, upper, released: false,
      releaseAt: clipAt + Math.max(1, Math.round(clip.release * TICK_RATE)),
      end: clipAt + Math.max(1, Math.round(clip.end * TICK_RATE)),
    };
    p.blocking = false;
    p.queuedAttack = false;
    // The wind-up and the cast sound at the hand (+0x24; fire ball and lightning sound on release).
    const hand = this.magic.hand(p);
    const at: [number, number, number] = [hand.x, hand.y, hand.z];
    const quiet = spell === 'fireball' || spell === 'lightning';
    this.broadcastAt(hand, {
      op: SC.SPELL_EVENT,
      d: {
        cast: { caster: p.entityId, spell, level: known.level, phase: 'begin', ...(upper ? { upper } : {}) },
        fx: [{ name: info.windup, level: known.level, at: [0, hand.y - p.character.position.y, 0], entity: p.entityId }],
        ...(quiet ? {} : { sounds: [{ id: info.sounds[known.level - 1]!, at }] }),
      },
    });
  }

  /** The aim of a player's spells: the view heading and pitch of his latest input (the original's camera aim, 0x53C218 +0x1BC). */
  private aimOf(p: Player): { x: number; y: number; z: number } {
    const yaw = dequantizeAngle(p.yaw);
    const cp = Math.cos(p.pitch);
    return { x: -Math.sin(yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(yaw) * cp };
  }

  /**
   * The SPELL event (0x004BCF70): with the mana still there (+0x20) the spell spends it (+0x58)
   * and takes effect (+0x28). Torch Light recast while lit does nothing (0x004BADE0).
   */
  private finishCast(p: Player): void {
    const c = p.cast!;
    c.released = true;
    const values = this.spells[c.spell]?.[c.level - 1];
    if (!values || p.mana < values.mana) return;
    if (c.spell === 'torch_light') {
      if (p.light && p.light.until > this.tick) return;
      p.mana -= values.mana;
      p.light = { radius: values.value1 * 0.3048, level: c.level, until: this.tick + Math.round(values.duration * TICK_RATE) };
      p.statsDirty = true;
      const pos = p.character.position;
      this.broadcastAt(pos, { op: SC.SPELL_EVENT, d: { cast: { caster: p.entityId, spell: c.spell, level: c.level, phase: 'release' }, fx: [{ name: 'LIGHT_CAST', level: c.level, at: [0, 6 * 0.3048, 0], entity: p.entityId }] } });
      return;
    }
    p.mana -= values.mana;
    p.statsDirty = true;
    this.broadcastAt(p.character.position, { op: SC.SPELL_EVENT, d: { cast: { caster: p.entityId, spell: c.spell, level: c.level, phase: 'release' } } });
    this.magic.release(p, c.spell, c.level, values, this.magic.hand(p), this.aimOf(p));
  }

  /** Per-tick spell state: casting, mana regeneration, light expiry. */
  private updateMagic(p: Player): void {
    const c = p.cast;
    if (c) {
      if (!c.released && this.tick >= c.releaseAt) this.finishCast(p);
      if (p.cast && this.tick >= c.end) p.cast = null;
    }
    // One mana point every 5 s (0x004BCFC0).
    if (p.mana < p.maxMana) {
      if (p.manaRegenAt === 0) p.manaRegenAt = this.tick + MANA_REGEN_TICKS;
      else if (this.tick >= p.manaRegenAt) {
        p.mana++;
        p.manaRegenAt = p.mana < p.maxMana ? this.tick + MANA_REGEN_TICKS : 0;
        p.statsDirty = true;
      }
    } else p.manaRegenAt = 0;
    if (p.light && this.tick >= p.light.until) {
      p.light = null;
      p.statsDirty = true;
    }
  }

  /** Drinks a potion from an inventory slot (CS_USE_ITEM). */
  useItem(connId: number, slot: number): void {
    const p = this.players.get(connId);
    if (!p || !alive(p)) return;
    const entry = p.inventory.find((e) => e.slot === slot);
    const def = entry && this.items.get(entry.itemId);
    if (!def || def.type !== 'potion' || (!def.heal && !def.mana)) return;
    takeOne(p.inventory, slot, this.items);
    if (def.heal) p.hp = Math.min(p.maxHp, p.hp + def.heal);
    if (def.mana) p.mana = Math.min(p.maxMana, p.mana + def.mana);
    p.statsDirty = true;
    p.inventoryDirty = true;
    this.sendInventory(p);
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
  }

  private broadcastObjects(objects: ObjectChange[]): void {
    for (const p of this.players.values()) this.sendObjects(p, objects);
  }

  private sendObjects(p: Player, objects: ObjectChange[]): void {
    this.sendJson(p.connId, { op: SC.OBJECT_STATE, d: { objects } });
  }

  /**
   * Level items and chests are per character: each one finds them all, and what it takes never
   * comes back for it, across restarts (story flag `<level>-took:<object>`).
   */
  private instanced(o: WorldObject): boolean {
    return !o.dynamic && (o.def.kind === 'item' || o.def.kind === 'chest');
  }

  private takenFlag(id: number): string {
    return `${this.act ?? 'arena'}-took:${id}`;
  }

  /** An object as this player sees it. */
  private stateFor(p: Player, o: WorldObject): WorldObjectState {
    if (!this.instanced(o) || !p.storyFlags.has(this.takenFlag(o.def.id))) return o.state;
    return o.def.kind === 'chest' ? 'open' : 'gone';
  }

  /** A player's active swing against breakable props in its arc. */
  private hitBreakables(a: Player, s: Swing, pos: { x: number; y: number; z: number }, yaw: number): void {
    for (const o of this.objects.values()) {
      if (o.def.kind !== 'breakable' || o.state !== 'present' || s.hit.has(OBJECT_HIT_KEY + o.def.id)) continue;
      if (Math.abs(o.def.y - pos.y) > INTERACT_HEIGHT) continue;
      if (!inMeleeArc(pos.x, pos.z, yaw, o.def.x, o.def.z, PLAYER_REACH, PLAYER_ARC_DEG, BREAKABLE_RADIUS)) continue;
      s.hit.add(OBJECT_HIT_KEY + o.def.id);
      const damage = Math.round(originalDamageTaken(this.rollDamage(a, s.combo), damageVector({}, 1)) * 100) / 100;
      o.hp = Math.max(0, o.hp - damage);
      if (o.hp <= 0) {
        o.state = 'gone';
        o.respawnAt = this.tick + OBJECT_RESPAWN_TICKS;
        setDoorOpen(this.mw, o.def.id, true); // broken: no longer in the way
      }
      const sweep = this.worldSweep(a, s);
      this.broadcastObjects([{ id: o.def.id, state: o.state, by: a.entityId, damage, hp: Math.ceil(o.hp), ...(sweep ? { sweep } : {}) }]);
    }
  }

  /**
   * Swinging doors: open, held, swung shut (the original's mover). A door does not swing into a
   * character: it waits until the way is clear (the original pushes Drake when it can).
   */
  private stepDoors(): void {
    const changes: ObjectChange[] = [];
    for (const o of this.objects.values()) {
      const mv = o.mover;
      if (mv && mv.motion.state !== MOVER_SHUT && mv.motion.state !== MOVER_PARKED && mv.motion.state !== MOVER_DONE) {
        const m = mv.motion;
        const { state, key, progress } = m;
        const wasBlocked = !!m.blocked;
        // A mover does not run into a character: it holds until the way is clear (the original
        // pushes Drake or stops, flags 0x200 / 0x80).
        m.blocked = false;
        const probe = { ...m };
        stepMover(mv.def, probe, TICK_MS);
        m.blocked = this.moverHits(o, probe) && !this.moverHits(o, m);
        if (!m.blocked) stepMover(mv.def, m, TICK_MS);
        if (m.progress !== progress || m.key !== key) {
          const pose = moverPose(mv.def, m);
          setBrushPose(this.mw, o.def.id, pose.t, pose.q);
        }
        if (m.state !== state || m.key !== key || m.blocked !== wasBlocked) {
          o.state = m.state === MOVER_SHUT ? 'present' : 'open';
          changes.push({ id: o.def.id, state: o.state, mover: { ...m } });
        }
        continue;
      }
      const sw = o.swing;
      const m = sw?.motion;
      if (!sw || !m) continue;
      const phase = m.phase;
      const before = m.progress;
      const wasBlocked = sw.blocked;
      sw.blocked = false;
      const moving = stepDoorMotion(sw.def, m, TICK_MS, (next) => (sw.blocked = this.doorHits(o, next) && !this.doorHits(o, m.progress)));
      const pose = swingPose(sw.def, m);
      if (m.progress !== before || !moving) setDoorPose(this.mw, o.def.id, pose.cx, pose.cz, moving ? pose.angle : 0);
      if (!moving) {
        sw.motion = null;
        o.state = 'present';
        changes.push({ id: o.def.id, state: 'present' });
      } else if (m.phase !== phase || sw.blocked !== wasBlocked) changes.push({ id: o.def.id, state: 'open', swing: { ...m, blocked: sw.blocked } });
    }
    if (changes.length) this.broadcastObjects(changes);
  }

  /** Whether a mover's brush at `motion` touches a live character (its bounds, moved; turns are not checked). */
  private moverHits(o: WorldObject, motion: MoverMotion): boolean {
    const mv = o.mover!;
    const b = o.def.bounds;
    if (!b || mv.def.segments[motion.key]?.kind !== 'move') return false;
    const { t } = moverPose(mv.def, motion);
    for (const a of this.actors.values()) {
      if (!alive(a)) continue;
      const p = a.character.position;
      if (p.y > b[4] + t[1] || p.y + 1.8 < b[1] + t[1]) continue;
      const dx = Math.max(b[0] + t[0] - p.x, 0, p.x - b[3] - t[0]);
      const dz = Math.max(b[2] + t[2] - p.z, 0, p.z - b[5] - t[2]);
      if (Math.hypot(dx, dz) < PLAYER_RADIUS) return true;
    }
    return false;
  }

  /** Whether a swinging door at `progress` touches a live character within its height. */
  private doorHits(o: WorldObject, progress: number): boolean {
    const sw = o.swing!;
    const k = sw.def.keys[sw.motion!.key] ?? sw.def.keys[0]!;
    const poly = sw.hull.map(([x, z]) => swingPoint(k.cx, k.cz, k.angle * progress, x, z));
    const b = o.def.bounds!;
    for (const a of this.actors.values()) {
      if (!alive(a)) continue;
      const p = a.character.position;
      if (p.y > b[4] || p.y + 1.8 < b[1]) continue;
      if (circleTouchesPolygon(poly, p.x, p.z, PLAYER_RADIUS)) return true;
    }
    return false;
  }

  private respawnObjects(): void {
    const back: ObjectChange[] = [];
    for (const o of this.objects.values()) {
      if (o.state === 'present' || o.def.kind === 'door' || o.def.kind === 'lever' || this.tick < o.respawnAt) continue;
      o.state = 'present';
      o.hp = o.def.hp ?? 0;
      o.respawnAt = 0;
      setDoorOpen(this.mw, o.def.id, false);
      back.push({ id: o.def.id, state: 'present' });
    }
    if (back.length) this.broadcastObjects(back);
  }

  private expireDroppedObjects(): void {
    const expired: ObjectChange[] = [];
    for (const [id, o] of this.objects) {
      if (!o.dynamic || !o.expiresAt || this.tick < o.expiresAt) continue;
      this.objects.delete(id);
      this.forgetDropped(o, id);
      expired.push({ id, state: 'gone' });
    }
    if (expired.length) this.broadcastObjects(expired);
  }

  /** A dropped item left the ground: it no longer counts against its owner's cap. */
  private forgetDropped(o: WorldObject, id: number): void {
    if (!o.ownerKey) return;
    const list = this.playerDroppedItems.get(o.ownerKey);
    if (!list) return;
    const idx = list.indexOf(id);
    if (idx !== -1) list.splice(idx, 1);
    if (!list.length) this.playerDroppedItems.delete(o.ownerKey);
  }

  /** Bag changes wait for a free player: not dead, swinging or in a scripted sequence. */
  private inventoryBusy(p: Player): boolean {
    return !alive(p) || !!p.swing || !!p.cutscene;
  }

  /** The entry in `slot`, unless the client named another item (its view of the slot is stale). */
  private inventoryEntry(p: Player, slot: number, itemId?: string): InventoryEntry | undefined {
    const entry = p.inventory.find((e) => e.slot === slot);
    return entry && (itemId === undefined || entry.itemId === itemId) ? entry : undefined;
  }

  /** A change that went through: the client's copy and the save follow. */
  private inventoryChanged(p: Player): void {
    p.inventoryDirty = true;
    this.sendInventory(p);
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
  }

  /**
   * Equip or unequip the item in an inventory slot (CS_EQUIP_ITEM), unequipping into bag cell
   * `to` when given. Refused while dead or in a scripted sequence; during a swing the request is
   * deferred to the swing's end so a weapon change never alters a swing already in progress (the
   * latest request wins).
   */
  equip(connId: number, slot: number, equip: boolean, itemId?: string, to?: { x: number; y: number }): void {
    const p = this.players.get(connId);
    if (!p) return;
    if (!alive(p) || p.cutscene) {
      this.sendInventory(p);
      return;
    }
    if (p.swing) {
      p.pendingEquip = { slot, equip, ...(itemId !== undefined ? { itemId } : {}), ...(to ? { to } : {}) };
      return;
    }
    this.applyEquipRequest(p, slot, equip, itemId, to);
  }

  /**
   * Server-authoritative bag move; invalid bounds, collisions, equipped items and stale slots are
   * rejected. Every refusal sends the inventory back so the client drops its stale view.
   */
  moveInventoryItem(connId: number, slot: number, x: number, y: number, itemId?: string): void {
    const p = this.players.get(connId);
    if (!p) return;
    if (this.inventoryBusy(p) || !this.inventoryEntry(p, slot, itemId) || !moveInventoryGridItem(p.inventory, slot, x, y, this.items)) {
      this.sendInventory(p);
      return;
    }
    this.inventoryChanged(p);
  }

  mergeInventoryStacks(connId: number, fromSlot: number, toSlot: number): void {
    const p = this.players.get(connId);
    if (!p) return;
    if (this.inventoryBusy(p) || !mergeInventoryStacks(p.inventory, fromSlot, toSlot, this.items)) {
      this.sendInventory(p);
      return;
    }
    this.inventoryChanged(p);
  }

  splitInventoryStack(connId: number, slot: number, quantity: number): void {
    const p = this.players.get(connId);
    if (!p) return;
    if (this.inventoryBusy(p) || !splitInventoryStack(p.inventory, slot, quantity, this.items)) {
      this.sendInventory(p);
      return;
    }
    this.inventoryChanged(p);
  }

  /**
   * Server-authoritative item drop (carried or worn): removes it from the inventory and spawns a
   * dynamic ground item that is picked up as the same catalog item.
   */
  dropInventoryItem(connId: number, slot: number, itemId?: string): void {
    const p = this.players.get(connId);
    if (!p) return;
    const entry = this.inventoryBusy(p) ? undefined : this.inventoryEntry(p, slot, itemId);
    const def = entry && this.items.get(entry.itemId);
    if (!entry || !def) {
      this.sendInventory(p);
      return;
    }

    p.inventory.splice(p.inventory.indexOf(entry), 1);
    if (entry.equipped) this.applyEquipment(p);
    this.inventoryChanged(p);

    // Enforce 20-item ground limit per player: oldest item disappears immediately when dropping the 21st.
    const ownerKey = p.characterId ?? String(connId);
    const list = this.playerDroppedItems.get(ownerKey) ?? [];
    while (list.length >= MAX_DROPPED_ITEMS_PER_PLAYER) {
      const oldestId = list.shift()!;
      if (this.objects.has(oldestId)) {
        this.objects.delete(oldestId);
        this.broadcastObjects([{ id: oldestId, state: 'gone' }]);
      }
    }

    const id = this.nextDynamicObjectId++;
    const pos = p.character.position;
    const objDef: WorldObjectDef = {
      id,
      kind: 'item',
      x: pos.x,
      y: pos.y,
      z: pos.z,
      item: { name: def.name, quantity: entry.quantity ?? 1, itemId: def.id },
    };
    this.objects.set(id, {
      def: objDef,
      state: 'present',
      hp: 0,
      respawnAt: 0,
      dynamic: true,
      ownerKey,
      expiresAt: this.tick + DROPPED_ITEM_LIFETIME_TICKS,
    });
    list.push(id);
    this.playerDroppedItems.set(ownerKey, list);
    this.broadcastObjects([{ id, state: 'present', def: objDef }]);
  }

  private applyEquipRequest(p: Player, slot: number, equip: boolean, itemId?: string, to?: { x: number; y: number }): void {
    const entry = this.inventoryEntry(p, slot, itemId);
    const def = entry && this.items.get(entry.itemId);
    // A repeated request (double click) or a stale one is not an error: the client just resyncs.
    if (!entry || !def || entry.equipped === equip || !isEquippable(def.type)) {
      this.sendInventory(p);
      return;
    }
    if (!setEquipped(p.inventory, slot, equip, this.items, to)) {
      if (!to) this.sendJson(p.connId, { op: SC.ERROR, d: { code: 'bag_full', message: 'Inventory full.' } });
      this.sendInventory(p);
      return;
    }
    this.applyEquipment(p);
    this.inventoryChanged(p);
  }

  private applyEquipment(p: Player): void {
    const eq = equipmentOf(p.inventory, this.items);
    p.weapon = eq.weapon;
    p.shield = eq.shield;
    p.armor = eq.armor;
    if (!p.shield) p.blocking = false;
    p.statsDirty = true;
  }

  /** What the client is told of an item kind (inventory cards, shop stock). */
  private itemFacts(def: ItemDef): Omit<ShopItemView, 'price'> {
    return {
      itemId: def.id,
      name: def.name,
      type: def.type,
      width: def.width,
      height: def.height,
      ...(def.model !== undefined ? { model: def.model } : {}),
      ...(def.texture ? { texture: def.texture } : {}),
      ...(def.damage ? { damage: def.damage } : {}),
      ...(def.speed !== undefined ? { speed: def.speed } : {}),
      ...(def.protection ? { protection: def.protection } : {}),
      ...(def.heal ? { heal: def.heal } : {}),
    };
  }

  private sendInventory(p: Player): void {
    const items: InventoryItemView[] = [];
    for (const e of p.inventory) {
      const def = this.items.get(e.itemId);
      if (!def) continue;
      const value = merchantBuys(def) ? tradePrice(def, e.quantity ?? 1) : 0;
      items.push({
        ...this.itemFacts(def),
        itemId: e.itemId,
        slot: e.slot,
        equipped: e.equipped,
        ...(!e.equipped && e.x !== undefined && e.y !== undefined ? { x: e.x, y: e.y } : {}),
        ...(e.quantity && e.quantity > 1 ? { quantity: e.quantity } : {}),
        ...(value ? { value } : {}),
      });
    }
    this.sendJson(p.connId, { op: SC.INVENTORY_UPDATE, d: { items, slots: INVENTORY_SLOTS, weaponSpeed: p.weapon.speed ?? 1 } });
  }

  /**
   * A player below the level (fell off an open edge the edge walls missed) is put back where he
   * would respawn: the beginning of the area.
   */
  private catchFall(p: Player): void {
    if (p.character.position.y >= this.fallLimit) return;
    this.toRespawnSpot(p);
  }

  /** Puts a player at his respawn spot; the triggers there count as entered (never fired). */
  private toRespawnSpot(p: Player): void {
    setCharacterState(p.character, p.respawnSpot, 0, false);
    p.inPortal.clear();
    for (const portal of this.arena.portals ?? []) if (inPortal(portal, p.respawnSpot, 0.5)) p.inPortal.add(portal.id);
  }

  /** respawnPoint, cached per way in (its arrival search sweeps the mesh). */
  private respawnFor(fromArena: string | undefined, via: ExitCrossing | undefined): { x: number; y: number; z: number } {
    const key = `${fromArena ?? ''}|${via ? `${via.exit}${via.toStart ? 's' : ''}` : ''}`;
    let at = this.respawns.get(key);
    if (!at) {
      const r = respawnPoint(this.arena, fromArena, via);
      at = { x: r.x, y: r.y, z: r.z };
      this.respawns.set(key, at);
    }
    return at;
  }

  private nextSpawnPoint(): { x: number; y: number; z: number } {
    return this.arena.spawnPoints[this.spawnIndex++ % this.arena.spawnPoints.length]!;
  }

  private persistRecord(p: Player): PersistRecord | null {
    if (!p.characterId) return null;
    const pos = p.character.position;
    return {
      characterId: p.characterId,
      x: pos.x, y: pos.y, z: pos.z,
      yaw: p.yaw,
      level: p.level,
      experience: p.xp,
      gold: p.gold,
      hp: Math.ceil(p.hp),
      maxHp: p.maxHp,
      mana: p.mana,
      maxMana: p.maxMana,
      spells: p.spells.map((s) => ({ ...s })),
      selectedSpell: p.selectedSpell,
      zone: this.arena.name,
      story: { flags: [...p.story.flags], quests: structuredClone(p.story.quests) },
      ...(this.takeInventoryChange(p)),
    };
  }

  private takeInventoryChange(p: Player): { inventory?: InventoryEntry[] } {
    if (!p.inventoryDirty) return {};
    p.inventoryDirty = false;
    return { inventory: p.inventory.map((e) => ({ ...e })) };
  }

  /** Current state of every persistent character in the zone (periodic flush / shutdown). */
  persistAll(): PersistRecord[] {
    const out: PersistRecord[] = [];
    for (const p of this.players.values()) {
      const r = this.persistRecord(p);
      if (r) out.push(r);
    }
    return out;
  }

  /**
   * Removes a player who is moving to another zone: returns the save record (null for guests)
   * and the state to recreate them with in the destination.
   */
  leaveForTransfer(connId: number): { record: PersistRecord | null; state: TransferState } | null {
    const p = this.players.get(connId);
    if (!p) return null;
    p.inventoryDirty = true; // always save the inventory with a transfer
    const state: TransferState = {
      name: p.name,
      characterId: p.characterId,
      yaw: p.yaw,
      experience: p.xp,
      gold: p.gold,
      hp: Math.max(1, Math.ceil(p.hp)),
      inventory: p.inventory.map((e) => ({ ...e })),
      mana: p.mana,
      spells: p.spells.map((s) => ({ ...s })),
      selectedSpell: p.selectedSpell,
      story: { flags: [...p.story.flags], quests: structuredClone(p.story.quests) },
    };
    const record = this.leave(connId);
    return { record, state };
  }

  private checkPortals(p: Player): void {
    const portals = this.arena.portals;
    if (!portals?.length || !alive(p)) return;
    const pos = p.character.position;
    for (const portal of portals) {
      if (portal.use || portal.scripted) continue; // door exits: the interact key (interact); act changes: scripts
      const inside = inPortal(portal, pos);
      if (!inside) {
        p.inPortal.delete(portal.id);
      } else if (!p.inPortal.has(portal.id)) {
        p.inPortal.add(portal.id);
        this.outbox.portal?.(p.connId, portal.target, undefined, this.crossing(portal, p));
      }
    }
  }

  /** The exit and the player's feet relative to its point, as the original records a crossing. */
  private crossing(portal: PortalDef, p: Player): ExitCrossing | undefined {
    if (portal.exit === undefined) return undefined;
    const pos = p.character.position;
    return { exit: portal.exit, ...(portal.toStart ? { toStart: true } : {}), offset: { x: pos.x - portal.x, y: pos.y - portal.y, z: pos.z - portal.z } };
  }

  // --- Story: triggers, scripted sequences, quests (story.ts; executable-analysis.md §17)

  /** The act of this zone's level ("cs1a"), or null for synthetic arenas. */
  private get act(): string | null {
    return this.arena.name.startsWith(LEVEL_PREFIX) ? this.arena.name.slice(LEVEL_PREFIX.length) : null;
  }

  /**
   * Triggers walked into (activation bit 0) fire once per character: a flag trigger starts the
   * sequence bound to it, a quest trigger updates the quest book, a relay starts its timer.
   */
  private checkStory(p: Player): void {
    const story = this.arena.story;
    const act = this.act;
    if (!story || !act) return;
    const pos = p.character.position;
    const x = pos.x / LEVEL_UNIT_METRES, y = pos.y / LEVEL_UNIT_METRES, z = pos.z / LEVEL_UNIT_METRES;
    for (const t of story.triggers) {
      if (!(t.activation & 1) || !t.volume || p.storyFlags.has(storyFlag(act, t.id))) continue;
      if (!inStoryVolume(t.volume, x, y, z)) continue;
      // Every trigger touched in this check fires (Cs4b's crossing starts Seq13 and the relay's
      // timer together: "Got Talisman of True Sight" shows during the scene).
      this.fireTrigger(p, t, 0, false, true);
    }
    // Sound triggers walked into (0x0B, bit 0): the sound plays on entering, for this player
    // (an MMO deviation: the original has only him); 0x200 ones once per character.
    for (const t of story.soundTriggers ?? []) {
      const inside = inStoryVolume(t.volume, x, y, z);
      const was = p.insideSounds.has(t.id);
      if (inside === was) continue;
      if (!inside) {
        p.insideSounds.delete(t.id);
        continue;
      }
      p.insideSounds.add(t.id);
      const flag = storyFlag(act, t.id);
      if (t.activation & 0x200) {
        if (p.storyFlags.has(flag)) continue;
        p.storyFlags.add(flag);
        p.story.flags.push(flag);
      }
      const s = LEVEL_UNIT_METRES;
      const positions = t.sound.positions.map(([px, py, pz]) => [px * s, py * s, pz * s] as [number, number, number]);
      this.sendJson(p.connId, { op: SC.STORY_SOUND, d: { sound: t.sound.id, positions, volume: t.sound.volume } });
    }
  }

  /**
   * Fires a trigger for a player: its flag, then what it does (sequence, quest, relay targets and
   * brushes). `played`: fired from a finished sequence. Its brushes moved in that player's
   * sequence only (their client showed it): the world's stay as they are, so the next player's
   * sequence finds Ursan's cell door shut as the story has it (the sequence leaves Drake outside).
   * `touched`: walked into or set by a sequence (slots 2 / 4), which runs a relay's timer first
   * (0x463A90 / 0x463C70); a relay's own targets and a death fire at once (slot 5, 0x463CC0).
   */
  private fireTrigger(p: Player, t: StoryTrigger, depth = 0, played = false, touched = false): void {
    const act = this.act;
    if (!act || depth > 8) return;
    const flag = storyFlag(act, t.id);
    if (p.storyFlags.has(flag)) return;
    p.storyFlags.add(flag);
    p.story.flags.push(flag);
    if (t.kind === 'quest' && t.quest) this.applyQuest(p, t);
    if (t.kind === 'relay') {
      if (touched && t.delay) this.pendingRelays.push({ connId: p.connId, trigger: t, due: this.tick + Math.ceil(t.delay / TICK_MS), played });
      else this.runRelay(p, t, depth, played);
    }
    if (t.kind === 'flag' && !p.cutscene) {
      const seq = this.arena.story?.sequences.find((q) => q.trigger === t.id);
      if (seq) this.startCutscene(p, seq);
    }
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
  }

  /**
   * A relay's ops (0x463CC0), in the original's order: op 8 fires each target directly (message
   * triggers show their text to this player, 0x4632B0; an exit takes him to its level, 0x462890),
   * mover triggers move their brushes (0x461B10), sound triggers play (0x461490), and creature
   * ops tell creatures whom to fight. Ops 0-3 (flagOps) change a bit nothing is known to read.
   */
  private runRelay(p: Player, t: StoryTrigger, depth: number, played: boolean): void {
    let exit: { exit: string; exitNumber: number } | null = null;
    for (const ref of t.targets ?? []) {
      if ('message' in ref) {
        this.sendJson(p.connId, { op: SC.STORY_MESSAGE, d: { message: ref.message } });
        continue;
      }
      if ('exit' in ref) {
        exit = ref;
        continue;
      }
      const next = 'trigger' in ref ? this.arena.story?.triggers.find((u) => u.id === ref.trigger) : undefined;
      if (next) this.fireTrigger(p, next, depth + 1, played);
    }
    if (!played) for (const name of t.brushes ?? []) this.useBrush(name, p.entityId);
    for (const sound of t.sounds ?? []) {
      const s = LEVEL_UNIT_METRES;
      const positions = sound.positions.map(([x, y, z]) => [x * s, y * s, z * s] as [number, number, number]);
      for (const q of this.players.values()) this.sendJson(q.connId, { op: SC.STORY_SOUND, d: { sound: sound.id, positions, volume: sound.volume } });
    }
    for (const op of t.creatureOps ?? []) this.applyCreatureOp(p, op);
    // The level change comes last: the original only flags it (the act loads after the frame).
    if (exit) this.takeScriptedExit(p, exit);
  }

  /**
   * A relay's creature op. Only the ones whose target can be a player apply here: server
   * creatures do not fight each other, so preferTarget / attackTarget (another creature) and
   * disposition4 (meaning not decoded) do nothing yet.
   */
  private applyCreatureOp(p: Player, op: StoryCreatureOp): void {
    for (const m of this.actors.values()) {
      if (m.kind !== 'mob' || m.placement !== op.creature || !alive(m) || m.archetype.passive) continue;
      if (op.op === 'targetPlayer') {
        // Event 0x18: a hostile creature takes the player at once, seen or not (0x40D910).
        m.threat.set(p.entityId, (m.threat.get(p.entityId) ?? 0) + 1);
        if (m.state !== 'chase') {
          m.state = 'chase';
          m.brain = 'decide';
          m.lastPick = null;
        }
      } else if (op.op === 'fightNearest') m.fightsNearest = true;
    }
  }

  /** An exit fired by a script (0x462890): to its level, arriving as through that exit. */
  private takeScriptedExit(p: Player, ref: { exit: string; exitNumber: number }): void {
    const name = ref.exit.toLowerCase();
    if (name === 'end') return; // the game's ending (state 5): nothing to load
    const target = `${LEVEL_PREFIX}${name}`;
    const portal = this.arena.portals?.find((q) => q.target === target && q.exit === ref.exitNumber);
    this.outbox.portal?.(p.connId, target, undefined, portal ? this.crossing(portal, p) : undefined);
  }

  /**
   * The use key (0x460320, activation bit 3: the player pressing use): story triggers whose
   * volume the player stands in fire (Ws1a / 5a / 9a's lever relays: the gates, their sound and
   * Ws5a's fight).
   */
  private useStory(p: Player): void {
    const story = this.arena.story;
    const act = this.act;
    if (!story || !act) return;
    const pos = p.character.position;
    const x = pos.x / LEVEL_UNIT_METRES, y = pos.y / LEVEL_UNIT_METRES, z = pos.z / LEVEL_UNIT_METRES;
    for (const t of story.triggers) {
      if (!(t.activation & 8) || !t.volume || p.storyFlags.has(storyFlag(act, t.id))) continue;
      if (inStoryVolume(t.volume, x, y, z)) this.fireTrigger(p, t, 0, false, true);
    }
  }

  /** Relays whose timer ran out fire for the player who touched them (if still here). */
  private runPendingRelays(): void {
    if (!this.pendingRelays.length) return;
    const due = this.pendingRelays.filter((r) => r.due <= this.tick);
    if (!due.length) return;
    this.pendingRelays = this.pendingRelays.filter((r) => r.due > this.tick);
    for (const r of due) {
      const p = this.players.get(r.connId);
      if (p) this.runRelay(p, r.trigger, 0, r.played);
    }
  }

  /** A creature's death fires its trigger for the killer (0x44CA00: health +0x1F0). */
  private fireDeathTrigger(killer: Player, placement: number | undefined): void {
    const story = this.arena.story;
    if (placement === undefined || !story?.deaths) return;
    for (const d of story.deaths) {
      if (d.creature !== placement) continue;
      const t = story.triggers.find((u) => u.id === d.trigger);
      if (t) this.fireTrigger(killer, t);
      else if (story.messages?.some((m) => m.id === d.trigger)) this.sendJson(killer.connId, { op: SC.STORY_MESSAGE, d: { message: d.trigger } });
    }
  }

  /** Sets a brush's mover going (a relay's target, 0x48EC10). */
  private useBrush(name: string, by: number): void {
    const b = this.arena.brushes?.find((x) => x.name === name && x.door !== undefined);
    const o = b ? this.objects.get(b.door!) : undefined;
    const mv = o?.mover;
    if (!o || !mv || !useMover(mv.def, mv.motion)) return;
    o.state = mv.motion.state === MOVER_SHUT ? 'present' : 'open';
    this.broadcastObjects([{ id: o.def.id, state: o.state, by, mover: { ...mv.motion } }]);
  }

  private applyQuest(p: Player, t: StoryTrigger): void {
    const out = applyQuestAction(p.story.quests, t.quest!);
    if (!out.assigned.length && !out.completed.length && !out.journal.length) return;
    if (out.xp > 0) this.addExperience(p, out.xp);
    if (out.gold > 0) {
      p.gold += out.gold;
      p.statsDirty = true;
    }
    this.sendJson(p.connId, { op: SC.QUEST_LOG, d: { log: p.story.quests, news: { assigned: out.assigned, completed: out.completed, journal: out.journal } } });
  }

  /** A scripted sequence starts for this player: the client plays it, the server waits for it. */
  private startCutscene(p: Player, sequence: StorySequence): void {
    const actors = sequence.actors.map((a) => {
      if (!a || !('creature' in a)) return null;
      for (const m of this.actors.values()) if (m.kind === 'mob' && m.placement === a.creature && alive(m)) return m.entityId;
      return null;
    });
    // At most the estimated length (actors' steps at walking pace) and a margin.
    const ms = estimateSequenceMs(sequence) * 1.5 + 15_000;
    p.cutscene = { sequence, until: this.tick + Math.ceil(ms / TICK_MS) };
    // Staged (not original): Drake stands where the sequence is framed for him (stagedPlayerSpot).
    const spot = stagedPlayerSpot(sequence);
    if (spot) {
      const s = LEVEL_UNIT_METRES;
      const x = spot[0] * s, z = spot[2] * s;
      const y = this.arena.meshes.length ? floorAt(this.arena, x, z, p.character.position.y) : spot[1] * s;
      if (y !== null) setCharacterState(p.character, { x, y: y + 0.1, z }, 0, false);
      const yaw = stagedPlayerYaw(spot);
      if (yaw !== null) p.yaw = quantizeAngle(yaw);
    }
    p.swing = null;
    p.queuedAttack = false;
    p.cast = null;
    this.sendJson(p.connId, { op: SC.CUTSCENE, d: { sequence: sequence.name, actors } });
  }

  /** CS_CUTSCENE_DONE: the client has played (or skipped) the sequence. */
  cutsceneDone(connId: number, name: string): void {
    const p = this.players.get(connId);
    if (p?.cutscene && p.cutscene.sequence.name === name) this.finishCutscene(p);
  }

  /**
   * The sequence's effects, as the original applies them while it plays: its TriggerFlag steps
   * fire their triggers, Drake ends where the stand-in walked to (0x41FB80), and its
   * ScriptedSequenceDone may load another act (the next stage of the story).
   */
  private finishCutscene(p: Player): void {
    const run = p.cutscene;
    if (!run) return;
    p.cutscene = null;
    const seq = run.sequence;
    const story = this.arena.story;
    const standIn = new Set(seq.actors.map((a, i) => (a && 'player' in a ? i + 2 : -1)).filter((i) => i >= 0));
    let end: [number, number, number] | null = null;
    let load: string | null = null;
    for (const track of seq.tracks) {
      for (const index of track.steps) {
        const step = seq.steps[index];
        if (!step) continue;
        const pos = step.args['pos'];
        if (step.action === 'MoveToPos' && standIn.has(track.actor) && Array.isArray(pos)) end = pos;
        const flag = step.args['flag'];
        if (step.action === 'TriggerFlag' && flag && typeof flag === 'object' && 'trigger' in flag) {
          const t = story?.triggers.find((u) => u.id === flag.trigger);
          if (t) this.fireTrigger(p, t, 0, true, true);
        }
        const level = step.args['loadlevel'];
        if (step.action === 'ScriptedSequenceDone' && level && typeof level === 'object' && 'exit' in level) load = level.exit.toLowerCase();
      }
    }
    if (end) {
      // The stand-in walks on the floor: its end is the target's x / z on the floor nearest to
      // where Drake stood (the scripts' target heights are not kept; Ci1a's are Cs1a's).
      const s = LEVEL_UNIT_METRES;
      const x = end[0] * s, z = end[2] * s;
      // (Synthetic arenas have no level mesh: the target as given.)
      const y = this.arena.meshes.length ? floorAt(this.arena, x, z, p.character.position.y) : end[1] * s;
      if (y !== null) setCharacterState(p.character, { x, y: y + 0.1, z }, 0, false);
    }
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
    // Another act of the same level keeps Drake where he stands (the acts share the mesh's coordinates).
    const pos = p.character.position;
    if (load) this.outbox.portal?.(p.connId, `${LEVEL_PREFIX}${load}`, this.arena.mesh ? { x: pos.x, y: pos.y, z: pos.z, mesh: this.arena.mesh } : undefined);
  }

  /** Removes the player; returns its final state for saving (null for guests / unknown). */
  leave(connId: number): PersistRecord | null {
    const p = this.players.get(connId);
    if (!p) return null;
    const record = this.persistRecord(p);
    this.magic.dropOwner(p);
    this.magic.forget(p);
    removeCharacter(this.mw, p.character);
    this.grid.remove(p.entityId);
    this.states.delete(p.entityId);
    this.players.delete(connId);
    this.actors.delete(p.entityId);
    for (const a of this.actors.values()) if (a.kind === 'mob') a.threat.delete(p.entityId);
    return record;
  }

  /** Accepts a raw CS_PLAYER_INPUT packet. Returns false if malformed (caller may rate-limit/kick). */
  receiveInput(connId: number, view: DataView): boolean {
    const p = this.players.get(connId);
    if (!p) return false;
    const h = decodeInput(view, this.scratchFrames);
    if (!h) {
      p.malformed++;
      return false;
    }
    for (let i = 0; i < h.count; i++) p.queue.push(this.scratchFrames[i]!);
    if (h.ackSnapshotTick > p.ackTick && h.ackSnapshotTick <= this.tick) p.ackTick = h.ackSnapshotTick;
    return true;
  }

  /**
   * Player swing request (CS_PLAYER_ATTACK). The combo index is decided here, not by the
   * client: as the original's combo routine (0x0042CA20), a request once 10 % of a combo swing
   * has played queues the next step, which starts when the swing ends; earlier ones, and any
   * during other swings, are ignored, so attacking faster than the swing lifecycle has no effect.
   */
  attack(connId: number, kind: AttackKind = 'normal'): void {
    const p = this.players.get(connId);
    if (!p || !alive(p) || p.hitUntil > this.tick || p.cast) return;
    p.blocking = false; // swinging lowers the shield until the next input re-raises it
    if (p.swing) {
      // Upper-body swings: clicks are dropped until the layer frees (no queue). Feature
      // sideSwingRetrigger: a side swing re-triggers 0.3 s in (the client alternates the side).
      const side = (k: AttackKind) => k === 'left' || k === 'right';
      if (this.features.sideSwingRetrigger && side(p.swing.kind) && side(kind) && this.tick - p.swing.start >= SIDE_SWING_RECHAIN_TICKS) {
        this.startPlayerSwing(p, kind);
        return;
      }
      if (isLayeredSwing(p.swing.kind)) return;
      // A wall ahead turns the request into the jab, which clears the queue.
      if (kind === 'thrust') {
        p.queuedAttack = false;
        return;
      }
      const t = p.swing.timing;
      const length = t.startup + t.active + t.recovery;
      if (p.swing.kind === 'normal' && p.swing.combo < COMBO_MULTIPLIERS.length && this.tick - p.swing.start >= Math.ceil(length * COMBO_QUEUE_FRACTION)) p.queuedAttack = true;
      return;
    }
    this.startPlayerSwing(p, kind);
  }

  private startPlayerSwing(p: Player, kind: AttackKind, combo = 1): void {
    p.swing = { combo, kind, start: this.tick, timing: attackTiming(kind, combo, p.weapon.speed ?? 1, p.moveStats.clipRate ?? 1), hit: new Set() };
    p.swingSerial++;
    p.queuedAttack = false;
    if (this.reactiveBlock) this.mobsReactToSwing(p);
  }

  /** Optional reactive block: shielded mobs in front of a player who starts a swing may raise their shield. */
  private mobsReactToSwing(p: Player): void {
    const pp = p.character.position;
    const yaw = dequantizeAngle(p.yaw);
    for (const m of this.actors.values()) {
      if (m.kind !== 'mob' || !alive(m) || !m.shield || m.swing || m.state !== 'chase') continue;
      if (this.tick < m.nextBlockTick || m.blockUntil > this.tick) continue;
      const mp = m.character.position;
      if (!inMeleeArc(pp.x, pp.z, yaw, mp.x, mp.z, PLAYER_REACH + 1, PLAYER_ARC_DEG, PLAYER_RADIUS)) continue;
      // Written as 1 - chance so a zero random source (deterministic tests) never blocks.
      if (this.random() < 1 - m.archetype.blockChance) continue;
      m.blockUntil = this.tick + m.archetype.blockTicks;
      m.nextBlockTick = m.blockUntil + m.archetype.blockCooldown;
      m.yaw = quantizeAngle(yawTowards(mp.x, mp.z, pp.x, pp.z));
    }
  }

  step(): void {
    const tick = ++this.tick;

    // 1. Players: at most one input per tick. No input => no movement this tick, so the
    //    authoritative state always equals "state after lastProcessedInput". Dead players
    //    consume inputs without acting on them.
    for (const p of this.players.values()) {
      if (p.queue.shift(this.frame)) {
        // The client roots itself during its own swing (INPUT.ROOTED, same tick on both
        // sides); the dead do not act. The client mirrors the dead rule.
        // During a scripted sequence the player's character stands where it was (the stand-in plays).
        if (!alive(p) || p.cutscene || this.held(p)) this.frame.flags = 0;
        p.pitch = dequantizePitch(this.frame.pitch);
        const before = { x: p.character.position.x, z: p.character.position.z };
        stepCharacter(this.mw, p.character, this.frame, p.moveStats, TICK_DT);
        p.lastProcessedInput = this.frame.clientTick;
        if (alive(p) && !p.cutscene) p.yaw = this.frame.yaw;
        if (!p.cutscene) this.checkPortals(p);
        this.catchFall(p);
        const moving = (this.frame.flags & MOVE_MASK) !== 0 && !(this.frame.flags & INPUT.ROOTED);
        p.blocking = alive(p) && p.shield !== null && (this.frame.flags & INPUT.BLOCK) !== 0 && !p.swing && p.hitUntil <= tick && p.character.rollDir !== ACTION_BASH;
        if (alive(p) && p.character.rollDir === ACTION_BASH) this.rushContact(p, before);
        // On diagonals the body turns into the motion, except with the shield up (it faces the view).
        p.facingOffset = moving && !(this.frame.flags & INPUT.BLOCK) ? movementFacingOffset(this.frame.flags, this.features.diagonalMoves) : 0;
        // Hit reactions are timed movement actions, so movementAnim() covers them too.
        p.anim = movementAnim(p.blocking ? this.frame.flags : this.frame.flags & ~INPUT.BLOCK, looksGrounded(p.character), p.character.rollDir, this.features.diagonalMoves, p.character.airKind);
        if (p.cast) {
          if (tick < p.cast.clipAt) p.anim = ANIM.SPELL_CONJURE;
          else if (!p.cast.upper) p.anim = ANIM.SPELL_CAST + SPELLS.indexOf(p.cast.spell);
        }
      }
      if (alive(p)) this.updateMagic(p);
      if (p.cutscene) {
        if (tick >= p.cutscene.until) this.finishCutscene(p);
      } else if (alive(p)) this.checkStory(p);
    }
    this.runPendingRelays();

    // 2. Mobs think and move.
    for (const a of this.actors.values()) if (a.kind === 'mob' && alive(a)) this.updateMob(a);

    // 3. Swings: hit windows, recovery, combo buffering.
    for (const a of this.actors.values()) if (a.swing && alive(a)) this.updateSwing(a);

    // 3b. Spell objects (projectiles, explosions, storms, lightning, drains) and timed effects.
    this.magic.step();

    // 4. Deaths and respawns (actors and world objects).
    if (this.objects.size && tick % 20 === 0) {
      this.respawnObjects();
      this.expireDroppedObjects();
    }
    if (this.objects.size) this.stepDoors();
    for (const a of this.actors.values()) {
      if (a.deadUntil !== 0 && tick >= a.deadUntil) this.respawn(a);
    }

    // 5. Replicated state.
    for (const a of this.actors.values()) {
      const pos = a.character.position;
      this.grid.update(a.entityId, pos.x, pos.z);
      // A fresh state object per actor per tick: snapshots and their history share it read-only
      // (copying it for every viewer allocated players x entities objects each tick).
      const s = { ...this.states.get(a.entityId)! };
      this.states.set(a.entityId, s);
      s.x = quantizePosition(pos.x);
      s.y = quantizePosition(pos.y);
      s.z = quantizePosition(pos.z);
      s.yaw = a.kind === 'player' && a.facingOffset ? quantizeAngle(dequantizeAngle(a.yaw) + a.facingOffset) : a.yaw;
      // Layered swings (side, air) play over the legs' own clip: the anim stays the locomotion one.
      const layered = a.swing !== null && (a.swing.upper === true || isLayeredSwing(a.swing.kind));
      s.anim = !alive(a) ? ANIM.DEAD : a.swing && !layered ? attackAnim(a.swing.kind, a.swing.combo) : a.anim;
      s.animPhase = a.swing ? Math.min(255, tick - a.swing.start) : 0;
      s.hp = Math.ceil(a.hp);
      // Shield layer (upper body): a player holding block, a creature with its shield raised.
      const shieldUp = a.kind === 'player' ? a.blocking : this.mobShieldUp(a);
      s.flags = alive(a) && shieldUp ? 1 : 0;
      if (alive(a) && a.kind === 'player' && a.light) s.flags |= (a.light.level & 3) << 4;
      if (alive(a) && layered) {
        const codes = a.kind === 'player' ? UPPER_SWING_CODES : MOB_UPPER_SWING_CODES;
        s.flags |= ((codes.indexOf(a.swing!.kind) + 1) << 1) | ((a.swingSerial & 1) << 3);
      }
    }

    // 6. Per-client stats + interest + delta snapshot.
    for (const p of this.players.values()) {
      if (p.statsDirty) this.sendStats(p);
      this.sendSnapshot(p, tick);
    }
  }

  private updateMob(m: Mob): void {
    // Spell effects (slow, freeze, the thaw, slow time): a creature at rate r moves at r of its
    // speed and thinks, swings and waits on a fraction r of the ticks (0x0044C3F0's rate).
    const rate = this.magic.rate(m);
    const moveStats = rate < 1 ? { ...m.stats, clipRate: (m.stats.clipRate ?? 1) * rate } : m.stats;
    if (rate < 1) {
      m.timeAcc += rate;
      if (m.timeAcc < 1) {
        this.pauseMob(m);
        if (rate > 0) stepCharacter(this.mw, m.character, m.input, moveStats, TICK_DT);
        return;
      }
      m.timeAcc -= 1;
    } else m.timeAcc = 0;
    const arch = m.archetype;
    const pos = m.character.position;
    const fromSpawn = Math.hypot(pos.x - m.spawn.x, pos.z - m.spawn.z);
    m.input.flags = 0;
    if (m.ally !== undefined) this.allyThink(m);
    // Peaceful creatures stand (or walk their path) until hit; armed ones then fight like any creature.
    if (arch.passive && m.state === 'idle' && m.waryUntil > this.tick) this.keepWary(m);
    if (arch.passive && (m.state === 'idle' || m.state === 'watch')) this.watchOrIdle(m);
    if (m.state === 'flee') this.flee(m);
    if (m.state === 'talk') this.keepTalking(m);

    if (m.state === 'idle' && !arch.passive && m.ally === undefined) {
      const seen = this.noticedPlayer(m);
      if (seen) {
        m.threat.set(seen.entityId, (m.threat.get(seen.entityId) ?? 0) + 1);
        // A hostile entering combat cries its +0x1E4 sound (0x40C830; Greater Black Knights).
        if (m.talkLine >= 0 && m.placement !== undefined) {
          const c = m.character.position;
          this.broadcastNear(m, { op: SC.STORY_SOUND, d: { sound: m.talkLine, positions: [[c.x, c.y, c.z]], volume: 1 } });
        }
        m.state = 'chase';
        m.brain = 'decide';
        m.lastPick = null;
      } else this.walkPath(m); // its idle walk until then (brain mode 1, 0x405950)
    }

    if (m.state === 'chase') {
      let target: Actor | null = null;
      let top = 0;
      for (const [id, threat] of m.threat) {
        const p = this.actors.get(id);
        if (!p || !this.hostile(m, p) || !alive(p)) {
          m.threat.delete(id);
          continue;
        }
        if (threat > top) {
          top = threat;
          target = p;
        }
      }
      if (!target || fromSpawn > arch.leashRadius) {
        m.threat.clear();
        m.state = 'return';
        this.calmDown(m);
      } else if (m.hitUntil > this.tick) {
        // Hit reaction: no action until it ends. A shield rush's reel turns into the knock-down.
        if (m.knockdownAt && this.tick >= m.knockdownAt) {
          m.knockdownAt = 0;
          startHitReaction(m.character, ACTION_KNOCKDOWN);
          m.hitUntil = Math.max(m.hitUntil, this.tick + hitReactionTicks(ACTION_KNOCKDOWN));
        }
      } else {
        this.think(m, target);
      }
    }

    if (m.state === 'return') {
      const dist = Math.hypot(m.spawn.x - pos.x, m.spawn.z - pos.z);
      if (dist < 0.5) {
        m.state = 'idle';
        m.hp = m.maxHp;
        m.yaw = m.spawnYaw;
      } else {
        m.yaw = quantizeAngle(yawTowards(pos.x, pos.z, m.spawn.x, m.spawn.z));
        m.input.flags = INPUT.FORWARD;
      }
    }

    m.input.yaw = m.yaw;
    m.input.clientTick = this.tick;
    // Lunges, leaping strikes, bashes and hit reactions are timed actions of the shared step
    // (their clips' root motion); other input is ignored meanwhile.
    if (m.hitUntil > this.tick) m.input.flags = 0;
    const before = { x: m.character.position.x, z: m.character.position.z };
    stepCharacter(this.mw, m.character, m.input, moveStats, TICK_DT);
    if (m.character.rollDir === ACTION_BASH) this.rushContact(m, before);
    this.separate(m);
    m.anim = m.hitUntil > this.tick
      ? (m.character.rollDir === ACTION_KNOCKDOWN ? ANIM.KNOCKDOWN : ANIM.HIT)
      : m.mobCast
        ? ANIM.SPELL_CAST + SPELLS.indexOf(CREATURE_SPELLS[m.mobCast.bit]!.spell)
      : m.blockUntil > this.tick
        ? ANIM.BLOCK
        : m.state === 'flee' && m.alertUntil > this.tick
          ? ANIM.ALERT
          : m.state === 'talk' && m.gestures
            ? ANIM.GESTURE
            : m.seq?.hop && this.tick < m.seq.hopUntil
              ? ANIM.HOP_FORWARD
              : m.input.flags & INPUT.BACK
                ? ANIM.RETREAT
                : m.input.flags & MOVE_MASK ? (m.input.flags & INPUT.WALK ? ANIM.WALK : ANIM.RUN) : ANIM.IDLE;
  }


  /** A slowed creature's tick without thought: its timers and swing wait a tick. */
  private pauseMob(m: Mob): void {
    const t = this.tick;
    const later = (v: number) => (v > t ? v + 1 : v);
    if (m.swing) m.swing.start++;
    m.hitUntil = later(m.hitUntil);
    m.brainUntil = later(m.brainUntil);
    m.blockUntil = later(m.blockUntil);
    m.shieldUntil = later(m.shieldUntil);
    m.knockdownAt = later(m.knockdownAt);
    m.spellReadyAt = later(m.spellReadyAt);
    if (m.mobCast) {
      if (m.mobCast.releaseAt !== null) m.mobCast.releaseAt = later(m.mobCast.releaseAt);
      m.mobCast.end = later(m.mobCast.end);
    }
    m.alertUntil = later(m.alertUntil);
    m.fleeUntil = later(m.fleeUntil);
    m.talkUntil = later(m.talkUntil);
    m.pathWaitUntil = later(m.pathWaitUntil);
    if (m.seq) {
      m.seq.upperAt = later(m.seq.upperAt);
      m.seq.hopUntil = later(m.seq.hopUntil);
    }
  }

  /**
   * A spectral ally (disposition 6): it fights the hostile creatures near it or its owner and
   * otherwise keeps up with its owner. Its fights use the melee brain like any creature's.
   */
  private allyThink(m: Mob): void {
    const owner = this.actors.get(m.ally!);
    const pos = m.character.position;
    if (m.state === 'return' || m.state === 'flee' || m.state === 'talk' || m.state === 'watch') {
      m.state = 'idle';
      this.calmDown(m);
    }
    const o = owner?.character.position;
    const fromOwner = o ? Math.hypot(o.x - pos.x, o.z - pos.z) : 0;
    if (m.state === 'chase' && fromOwner > ALLY_LEASH) {
      m.threat.clear();
      m.state = 'idle';
      this.calmDown(m);
    }
    if (m.state !== 'idle') return;
    const foe = this.allyFoe(m, owner);
    if (foe) {
      m.threat.set(foe.entityId, 1);
      m.state = 'chase';
      m.brain = 'decide';
      m.lastPick = null;
      return;
    }
    if (!o || fromOwner <= ALLY_FOLLOW) return;
    m.yaw = quantizeAngle(yawTowards(pos.x, pos.z, o.x, o.z));
    m.input.flags = INPUT.FORWARD | (fromOwner < ALLY_FOLLOW * 2 ? INPUT.WALK : 0);
  }

  /** The hostile creature nearest an ally or its owner, within sight range and in sight. */
  private allyFoe(m: Mob, owner: Actor | undefined): Actor | null {
    const pos = m.character.position;
    const o = owner?.character.position;
    let best: Actor | null = null;
    let bestDist = MOB_SIGHT_RANGE;
    for (const a of this.actors.values()) {
      if (a.kind !== 'mob' || !alive(a) || a.archetype.passive || !this.hostile(m, a)) continue;
      const q = a.character.position;
      if (Math.abs(q.y - pos.y) > AGGRO_HEIGHT) continue;
      const d = Math.min(Math.hypot(q.x - pos.x, q.z - pos.z), o ? Math.hypot(q.x - o.x, q.z - o.z) : Infinity);
      if (d >= bestDist || !lineOfSight(this.mw, pos, q, EYE_HEIGHT)) continue;
      best = a;
      bestDist = d;
    }
    return best;
  }

  /** A citizen who saw an assault: on the alert facing it, then running away; calm again after. */
  private flee(m: Mob): void {
    const pos = m.character.position;
    if (m.hitUntil > this.tick) return; // the flinch plays out first
    if (this.tick >= m.fleeUntil) {
      m.state = 'idle';
      m.waryUntil = this.tick + WARY_TICKS;
      return;
    }
    const away = yawTowards(m.fleeFrom.x, m.fleeFrom.z, pos.x, pos.z);
    if (this.tick < m.alertUntil) {
      m.yaw = quantizeAngle(yawTowards(pos.x, pos.z, m.fleeFrom.x, m.fleeFrom.z));
      return;
    }
    m.yaw = quantizeAngle(away);
    m.input.flags = INPUT.FORWARD;
  }

  /**
   * A player struck a peaceful creature: the brain's hit event (0x40F890) raises a one-frame
   * alarm (0x52FDC8 -> 0x52FDC4) when the struck one's disposition is 0-2, and that frame every
   * peaceful creature that can see the player (0x40D910: an eye-to-eye ray, 0x406AF0; no range)
   * takes him as its target: guards and other armed ones attack, citizens run from him.
   */
  private raiseAlarm(player: Player): void {
    const at = player.character.position;
    for (const m of this.actors.values()) {
      if (m.kind !== 'mob' || !alive(m) || !m.archetype.passive) continue;
      const p = m.character.position;
      if (!lineOfSight(this.mw, p, at, EYE_HEIGHT)) continue;
      if (isCitizen(m)) {
        if (m.state !== 'flee') m.alertUntil = Math.max(this.tick, m.hitUntil) + ALERT_TICKS;
        m.state = 'flee';
        m.fleeUntil = Math.max(m.alertUntil, this.tick) + FLEE_TICKS;
        m.fleeFrom = { x: at.x, z: at.z };
      } else {
        m.threat.set(player.entityId, (m.threat.get(player.entityId) ?? 0) + 1);
        if (m.state !== 'chase') {
          m.state = 'chase';
          m.brain = 'decide';
          m.lastPick = null;
        }
      }
    }
  }

  // --- Shops (cap type 0x1C; game/shops.ts, executable-analysis §19)

  /** The act's shop `id` if the player, free to trade, stands in its volume (use-key trigger). */
  private shopAt(p: Player, id: number): StoryShop | null {
    if (this.inventoryBusy(p)) return null;
    const shop = this.arena.story?.shops?.find((s) => s.id === id);
    if (!shop || !(shop.activation & 8)) return null;
    const pos = p.character.position;
    return inStoryVolume(shop.volume, pos.x / LEVEL_UNIT_METRES, pos.y / LEVEL_UNIT_METRES, pos.z / LEVEL_UNIT_METRES) ? shop : null;
  }

  private sendShop(p: Player, greeting?: number): void {
    const visit = p.shop;
    if (!visit) return;
    const stock = visit.stock.flatMap((e) => {
      const def = this.items.get(e.itemId);
      return def ? [{ ...this.itemFacts(def), ...(e.quantity > 1 ? { quantity: e.quantity } : {}), price: entryPrice(def, e) }] : [];
    });
    const gift = visit.gift ? { gift: true } : {};
    this.sendJson(p.connId, { op: SC.SHOP, d: { shop: visit.id, stock, ...gift, ...(greeting !== undefined && greeting >= 0 ? { greeting } : {}) } });
  }

  /**
   * The use key in a shop's volume (fire 0x464170): at most every 500 ms, the merchant's greeting
   * and a fresh copy of the shop's items (0x46D3D0) for this visit. A gift shop leaves out what
   * this character already took.
   */
  shopOpen(connId: number, id: number): void {
    const p = this.players.get(connId);
    const shop = p && this.shopAt(p, id);
    if (!p || !shop) return;
    if (p.shop && this.tick - p.shop.openedAt < Math.ceil(SHOP_REOPEN_MS / TICK_MS)) return;
    const act = this.act ?? '';
    const gift = isGiftShop(shop);
    const stock = shopStock(shop, this.items, (i) => p.storyFlags.has(giftFlag(act, id, i)));
    p.shop = { id, stock, openedAt: this.tick, gift };
    this.sendShop(p, shop.greeting);
  }

  /** Takes offer entry `index` into the bag for its Price × count in gold (0x46E290). */
  shopBuy(connId: number, id: number, index: number, itemId: string): void {
    const p = this.players.get(connId);
    if (!p || !p.shop || p.shop.id !== id || !this.shopAt(p, id)) return;
    const entry = p.shop.stock[index];
    const def = entry && entry.itemId === itemId ? this.items.get(entry.itemId) : undefined;
    if (!entry || !def) {
      this.sendShop(p);
      return;
    }
    const cost = entryPrice(def, entry);
    if (p.gold < cost) {
      this.sendJson(connId, { op: SC.ERROR, d: { code: 'shop_gold', message: 'Not enough gold.' } });
      return;
    }
    if (addItem(p.inventory, def.id, entry.quantity, this.items) === null) {
      this.sendJson(connId, { op: SC.ERROR, d: { code: 'bag_full', message: 'Inventory full.' } });
      return;
    }
    p.shop.stock.splice(index, 1);
    p.gold -= cost;
    p.statsDirty = true;
    if (entry.gift !== undefined) {
      const flag = giftFlag(this.act ?? '', id, entry.gift);
      p.storyFlags.add(flag);
      p.story.flags.push(flag);
    }
    this.inventoryChanged(p);
    this.sendShop(p);
    if (entry.gift !== undefined) {
      const record = this.persistRecord(p);
      if (record) this.outbox.persist?.([record], 'progress');
    }
  }

  /** Puts a bag item (its whole stack; worn ones too) into the shop for its Price × count. */
  shopSell(connId: number, id: number, slot: number, itemId?: string): void {
    const p = this.players.get(connId);
    if (!p || !p.shop || p.shop.id !== id || !this.shopAt(p, id)) return;
    const entry = this.inventoryEntry(p, slot, itemId);
    const def = entry && this.items.get(entry.itemId);
    if (!entry || !def) {
      this.sendInventory(p);
      return;
    }
    if (p.shop.gift || !merchantBuys(def)) {
      this.sendJson(connId, { op: SC.ERROR, d: { code: 'shop_refuse', message: p.shop.gift ? 'Nothing is bought here.' : 'The merchant will not take that.' } });
      return;
    }
    const quantity = entry.quantity ?? 1;
    p.inventory.splice(p.inventory.indexOf(entry), 1);
    if (entry.equipped) this.applyEquipment(p);
    p.gold += tradePrice(def, quantity);
    p.statsDirty = true;
    p.shop.stock.push({ itemId: def.id, quantity });
    this.inventoryChanged(p);
    this.sendShop(p);
  }

  /**
   * A player talks to a peaceful creature in reach: it stops and gestures through the line
   * (logged: ASM_GESTURE_POLITE_CONVERSATION for exactly the line's length), turning to face the
   * player at ~90 degrees a second and following them while the line lasts.
   */
  talk(connId: number, entity: number, ms: number): void {
    const p = this.players.get(connId);
    const m = this.actors.get(entity);
    if (!p || !alive(p) || !m || m.kind !== 'mob' || !alive(m) || !m.archetype.passive) return;
    // Only a creature with a line speaks (stats +0x1E4 = -1: the use key does nothing, 0x408980).
    if (m.talkLine < 0) return;
    if (m.state !== 'idle' && m.state !== 'talk' && m.state !== 'watch') return;
    const a = p.character.position;
    const b = m.character.position;
    if (Math.hypot(a.x - b.x, a.z - b.z) > TALK_REACH || Math.abs(a.y - b.y) > AGGRO_HEIGHT) return;
    m.state = 'talk';
    m.talkTo = p.entityId;
    m.talkUntil = this.tick + Math.ceil(Math.min(ms, TALK_MAX_MS) / TICK_MS);
  }

  private keepTalking(m: Mob): void {
    const p = this.actors.get(m.talkTo);
    if (!p || !alive(p) || this.tick >= m.talkUntil) {
      // Back to watching (brain mode 2) the player it spoke to.
      m.state = 'watch';
      m.watchTo = m.talkTo;
      return;
    }
    const pos = m.character.position;
    const want = yawTowards(pos.x, pos.z, p.character.position.x, p.character.position.z);
    const have = dequantizeAngle(m.yaw);
    const diff = Math.atan2(Math.sin(want - have), Math.cos(want - have));
    const step = TALK_TURN_RATE * TICK_DT;
    m.yaw = quantizeAngle(have + Math.max(-step, Math.min(step, diff)));
  }

  /** A wary citizen: a player coming close on its floor sets it running again. */
  private keepWary(m: Mob): void {
    const pos = m.character.position;
    for (const p of this.players.values()) {
      const q = p.character.position;
      if (!alive(p) || Math.abs(q.y - pos.y) > AGGRO_HEIGHT || Math.hypot(q.x - pos.x, q.z - pos.z) > WARY_RADIUS) continue;
      m.state = 'flee';
      m.alertUntil = this.tick + REALERT_TICKS;
      m.fleeUntil = m.alertUntil + FLEE_TICKS;
      m.fleeFrom = { x: q.x, z: q.z };
      return;
    }
  }

  /**
   * A peaceful creature's idle behaviour (brain modes 1 and 2): a living player within 12 ft on
   * its floor makes it stop and face him (0x40C520 -> mode 2; 0x408980 faces him), and it goes
   * back once he is beyond 20 ft, after at least 3 s (0x40C190). Otherwise it stands, or walks
   * its path (0x405AC0).
   */
  private watchOrIdle(m: Mob): void {
    const pos = m.character.position;
    let near: Player | null = null;
    let nearD = Infinity;
    for (const p of this.players.values()) {
      if (!alive(p)) continue;
      const q = p.character.position;
      if (Math.abs(q.y - pos.y) > AGGRO_HEIGHT) continue;
      const d = Math.hypot(q.x - pos.x, q.z - pos.z);
      if (d < nearD) {
        near = p;
        nearD = d;
      }
    }
    if (m.state === 'idle' && near && nearD <= WATCH_NEAR) {
      m.state = 'watch';
      m.watchSince = this.tick;
      m.watchTo = near.entityId;
    }
    if (m.state === 'watch') {
      if (this.tick - m.watchSince >= WATCH_MIN_TICKS && (!near || nearD > WATCH_FAR)) {
        m.state = 'idle';
      } else {
        const p = this.actors.get(m.watchTo);
        const target = p && alive(p) && Math.hypot(p.character.position.x - pos.x, p.character.position.z - pos.z) <= WATCH_FAR ? p : near;
        if (target) this.turnTowards(m, yawTowards(pos.x, pos.z, target.character.position.x, target.character.position.z));
        return;
      }
    }
    this.walkPath(m);
  }

  /**
   * The idle walk (0x405AC0): walk to the current point, pause there (the behaviour's first int,
   * 1000 ms in every shipped path), then the next one (0x405FF0): on and back along the points,
   * or from the last to the first when its mode int is under 1. It begins with the first point.
   */
  private walkPath(m: Mob): void {
    const path = m.path;
    if (!path || this.tick < m.pathWaitUntil) return;
    const pos = m.character.position;
    const to = path.points[m.pathIndex]!;
    if (Math.hypot(to.x - pos.x, to.z - pos.z) < PATH_ARRIVE) {
      m.pathWaitUntil = this.tick + Math.ceil(path.pause / TICK_MS);
      let next = m.pathIndex + (m.pathForward ? 1 : -1);
      if (next < 0) {
        next = 1;
        m.pathForward = true;
      } else if (next >= path.points.length) {
        if (path.loop) next = 0;
        else {
          next = path.points.length - 2;
          m.pathForward = false;
        }
      }
      m.pathIndex = next;
      return;
    }
    m.yaw = quantizeAngle(yawTowards(pos.x, pos.z, to.x, to.z));
    m.input.flags = INPUT.FORWARD | INPUT.WALK;
  }

  /**
   * Pushes a creature out of any character it overlaps (characters are sensors for the
   * controller, which only collides with the level). The push itself is collision-checked.
   */
  private separate(m: Mob): void {
    const pos = m.character.position;
    let px = 0;
    let pz = 0;
    for (const o of this.actors.values()) {
      if (o === m || !alive(o)) continue;
      const op = o.character.position;
      if (Math.abs(op.y - pos.y) > PLAYER_HEIGHT) continue;
      const dx = pos.x - op.x;
      const dz = pos.z - op.z;
      const d = Math.hypot(dx, dz);
      if (d >= CHARACTER_SPACING) continue;
      // Exactly on top: push straight back along the creature's heading.
      const nx = d > 1e-4 ? dx / d : -forwardXZ(dequantizeAngle(m.yaw)).x;
      const nz = d > 1e-4 ? dz / d : -forwardXZ(dequantizeAngle(m.yaw)).z;
      px += nx * (CHARACTER_SPACING - d);
      pz += nz * (CHARACTER_SPACING - d);
    }
    if (px === 0 && pz === 0) return;
    // Its action carries on (a charge or an impact is not cut short by the nudge).
    this.moveBy(m, px, pz);
  }

  /**
   * A hostile creature notices the nearest player on its floor within 100 ft ahead (60 degrees
   * either side of its heading) or 20 ft elsewhere, with level geometry not in between.
   */
  private noticedPlayer(m: Mob): Actor | null {
    const pos = m.character.position;
    const heading = dequantizeAngle(m.yaw);
    let best: Actor | null = null;
    let bestDist = Infinity;
    // Players and their spectral allies.
    for (const p of this.actors.values()) {
      if (!alive(p) || (p.kind !== 'player' && p.ally === undefined)) continue;
      const q = p.character.position;
      // Same floor only: original levels stack rooms.
      if (Math.abs(q.y - pos.y) > AGGRO_HEIGHT) continue;
      const d = Math.hypot(q.x - pos.x, q.z - pos.z);
      const off = Math.abs(angleDiff(yawTowards(pos.x, pos.z, q.x, q.z), heading));
      // Told to fight the nearest enemy (0x40DC90): any range, any angle, in sight.
      const range = m.fightsNearest ? Infinity : off < MOB_SIGHT_HALF_ANGLE ? MOB_SIGHT_RANGE : MOB_NEAR_SENSE_RANGE;
      if (d >= range || d >= bestDist) continue;
      if (!lineOfSight(this.mw, pos, q, EYE_HEIGHT)) continue;
      best = p;
      bestDist = d;
    }
    return best;
  }

  /** A creature turns towards a heading at its body turn rate (radians). */
  private turnTowards(m: Mob, want: number): void {
    const have = dequantizeAngle(m.yaw);
    const step = MOB_TURN_RATE * TICK_DT;
    m.yaw = quantizeAngle(have + Math.max(-step, Math.min(step, angleDiff(want, have))));
  }

  /**
   * The original's melee brain (0x00409520), run while the creature is free to act. It heads at
   * its target every tick, then follows its current phase; 'decide' (0x004096A0) picks the next.
   */
  private think(m: Mob, target: Actor): void {
    const pos = m.character.position;
    const t = target.character.position;
    const dist = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z);
    this.turnTowards(m, yawTowards(pos.x, pos.z, t.x, t.z));
    m.walkShield = false;
    if (this.reactiveBlock && m.blockUntil > this.tick) return; // feature reactiveBlock: the shield is held
    for (let guard = 0; guard < 5; guard++) {
      if (m.brain === 'decide') this.decide(m, target, dist);
      switch (m.brain) {
        case 'attack':
          this.runSequence(m);
          return;
        case 'pause':
          if (this.tick < m.brainUntil) return;
          m.brain = 'decide';
          continue;
        case 'run':
          // Beyond 12 ft: run in until within 12 ft (0x0040A290).
          if (mobBand(dist) <= 1) {
            m.brain = 'decide';
            continue;
          }
          m.input.flags = INPUT.FORWARD;
          return;
        case 'walkIn':
          // Within 12 ft: walk in, shield raised, to the engage distance; run in at a target
          // that has turned away.
          if (dist < m.archetype.engage || mobBand(dist) > 1) {
            m.brain = 'decide';
            continue;
          }
          if (this.turnedAway(target, m)) m.input.flags = INPUT.FORWARD;
          else {
            m.input.flags = INPUT.FORWARD | INPUT.WALK;
            m.walkShield = m.shield !== null;
          }
          return;
        case 'post':
          if (this.postAttack(m, target, dist)) return;
          m.brain = 'decide';
          continue;
        case 'spell':
          if (this.mobSpell(m, target, dist)) return;
          m.brain = 'decide';
          continue;
        default:
          return;
      }
    }
  }

  /** The next phase (0x004096A0): a caster's spell, run in, walk in, attack, or what follows an attack. */
  private decide(m: Mob, target: Actor, dist: number): void {
    const spell = this.spellChoice(m, target, dist);
    if (spell) {
      m.lastPick = m.brain = 'spell';
      m.spellPick = spell;
      return;
    }
    const pick = mobBand(dist) > 1 ? 'run'
      : dist > m.archetype.engage && !this.attacking(target) ? 'walkIn'
        : m.lastPick === 'attack' ? 'post'
          : 'attack';
    m.lastPick = pick;
    m.brain = pick;
    if (pick === 'attack') this.startSequence(m, target, dist);
    else if (pick === 'post') this.enterPost(m, target, dist);
  }

  /**
   * The spell choices ahead of the melee ones (0x004096A0; Necros's Force Globe, mask 0x100, is
   * not implemented): a close spell at 8-20 ft when floor(rand x 1000) > 700, else a ranged
   * one beyond 8 ft with a clear line from the eyes (0x004070E0: 0.9 of its height).
   */
  private spellChoice(m: Mob, target: Actor, dist: number): 'close' | 'ranged' | null {
    const type = m.archetype.type;
    if (type === undefined) return null;
    const band = mobBand(dist);
    if (band === 0) return null;
    if (band <= 2 && creatureSpellBits(type, CREATURE_CAST.closeMask).length && Math.floor(this.random() * 1000) > CREATURE_CAST.closeRoll) return 'close';
    if (creatureSpellBits(type, CREATURE_CAST.rangedMask).length && lineOfSight(this.mw, m.character.position, target.character.position, PLAYER_HEIGHT * 0.9)) return 'ranged';
    return null;
  }

  /**
   * The spell phase (0x0040AA20): dropped within 8 ft; standing (and turning) until the cooldown
   * is over and the target within 45° of its heading; the cast; then 2 s standing. False when
   * the phase is over and the brain decides again.
   */
  private mobSpell(m: Mob, target: Actor, dist: number): boolean {
    const c = m.mobCast;
    if (!c) {
      if (mobBand(dist) === 0) return false;
      const t = target.character.position;
      const p = m.character.position;
      const facing = Math.abs(angleDiff(yawTowards(p.x, p.z, t.x, t.z), dequantizeAngle(m.yaw))) < CREATURE_CAST.facing;
      if (this.tick <= m.spellReadyAt || !facing) return true;
      return this.startMobCast(m, target);
    }
    if (!c.released && c.releaseAt !== null && this.tick >= c.releaseAt) this.releaseMobCast(m);
    if (this.tick < c.end) return true;
    m.mobCast = null;
    m.brain = 'pause';
    m.brainUntil = this.tick + Math.round(CREATURE_CAST.pause * TICK_RATE);
    return true;
  }

  /**
   * Picks one of the phase's spells, floor(rand x count) (0x00408840; soul drinker not at the
   * unholy), and plays its state (template 9, the whole body, to the clip's end); the cooldown
   * starts now. With none left the original swings once instead (template 6): not done here.
   */
  private startMobCast(m: Mob, target: Actor): boolean {
    const type = m.archetype.type!;
    let bits = creatureSpellBits(type, m.spellPick === 'close' ? CREATURE_CAST.closeMask : CREATURE_CAST.rangedMask);
    if (UNHOLY_TYPES.has(this.creatureType(target))) bits = bits.filter((b) => CREATURE_SPELLS[b]!.spell !== 'soul_drinker');
    if (!bits.length) return false;
    const bit = bits[Math.min(bits.length - 1, Math.floor(this.random() * bits.length))]!;
    const s = CREATURE_SPELLS[bit]!;
    const clip = creatureSpellClipSeconds(type, s.spell);
    m.spellReadyAt = this.tick + Math.round(s.cooldown * TICK_RATE);
    m.mobCast = {
      bit, target: target.entityId, released: false,
      releaseAt: clip.release === null ? null : this.tick + Math.max(1, Math.round(clip.release * TICK_RATE)),
      end: this.tick + Math.max(1, Math.round(clip.end * TICK_RATE)),
    };
    m.seq = null;
    m.shieldUntil = 0;
    this.broadcastAt(m.character.position, { op: SC.SPELL_EVENT, d: { cast: { caster: m.entityId, spell: s.spell, level: s.level, phase: 'begin' } } });
    return true;
  }

  /** The clip's SPELL event (controller flag 0x10000 -> 0x004BD7C0): the spell at the target. */
  private releaseMobCast(m: Mob): void {
    const c = m.mobCast!;
    c.released = true;
    const t = this.actors.get(c.target);
    if (!t || !alive(t)) return;
    const s = CREATURE_SPELLS[c.bit]!;
    const hand = this.magic.hand(m);
    const tp = t.character.position;
    const to = { x: tp.x - hand.x, y: tp.y + PLAYER_HEIGHT * 0.55 - hand.y, z: tp.z - hand.z };
    const l = Math.hypot(to.x, to.y, to.z) || 1;
    this.broadcastAt(m.character.position, { op: SC.SPELL_EVENT, d: { cast: { caster: m.entityId, spell: s.spell, level: s.level, phase: 'release' } } });
    this.magic.release(m, s.spell, s.level, s.values, hand, { x: to.x / l, y: to.y / l, z: to.z / l }, { target: t });
  }

  /** Whether the player is in an attacking state (state flag 0x20: swings, the rush, casting). */
  private attacking(p: Actor): boolean {
    // Combo steps 4 and 5 (states 103 / 104) have no flags in the state table.
    return (p.swing !== null && !(p.swing.kind === 'normal' && p.swing.combo >= 4)) || (p.kind === 'player' ? p.cast !== null : p.mobCast !== null) || p.character.rollDir === ACTION_BASH;
  }

  /** Its shield is raised (a player holding block, a creature's stance or block). */
  private shieldRaised(a: Actor): boolean {
    return a.kind === 'player' ? a.blocking : this.mobShieldUp(a);
  }

  /** Whether the player has turned more than 90 degrees away from the creature (0x0040E2D0). */
  private turnedAway(p: Actor, m: Mob): boolean {
    const a = p.character.position;
    const b = m.character.position;
    return Math.abs(angleDiff(yawTowards(a.x, a.z, b.x, b.z), dequantizeAngle(p.yaw))) > Math.PI / 2;
  }

  /** Starts an attack sequence (0x00409920): a special against a raised shield, else 0x004083F0's choice. */
  private startSequence(m: Mob, target: Actor, dist: number): void {
    const special = this.shieldRaised(target) && Math.floor(this.random() * 1000) > MOB_SPECIAL_ROLL * 1000;
    const seq = special ? chooseMobSpecial(m.shield !== null, this.random()) : chooseMobSequence(dist, this.random());
    m.seq = { ...seq, main: [...seq.main], upperAt: this.tick + MOB_HOP_SWING_DELAY, hopUntil: this.tick + MOB_HOP_TICKS };
    if (seq.hop) startTimedAction(m.character, ACTION_LUNGE); // PC07's root motion, then still
  }

  /**
   * Plays the sequence: the hop's swing on the upper body from 20 % of the hop, the remaining
   * swings one after another once the hop is over, then the pause (500 / 700 / 900 ms).
   */
  private runSequence(m: Mob): void {
    const q = m.seq;
    if (!q) {
      m.brain = 'decide';
      return;
    }
    if (m.swing) return;
    if (q.upper) {
      if (this.tick < q.upperAt) return;
      this.startMobSwing(m, q.upper, true);
      q.upper = null;
      return;
    }
    if (q.hop && this.tick < q.hopUntil) return;
    const next = q.main.shift();
    if (next) {
      this.startMobSwing(m, next, false);
      return;
    }
    m.seq = null;
    m.brain = 'pause';
    m.brainUntil = this.tick + Math.round((q.pauseMs / 1000) * TICK_RATE);
  }

  /** Starts a creature swing (one of its ASM attacks, timed by that clip's events). */
  private startMobSwing(m: Mob, atk: MobAttack, upper: boolean): void {
    m.swing = { combo: 1, kind: atk.kind, start: this.tick, timing: clipSwingTiming(atk.clip), hit: new Set(), reach: atk.reach, ...(upper ? { upper: true } : {}) };
    m.swingSerial++;
    // The leaping strike (PN05) and the shield bash (PL01) carry the creature by their root motion.
    if (atk.kind === 'jump') startTimedAction(m.character, ACTION_ATTACK + 3);
    else if (atk.kind === 'bash') startTimedAction(m.character, ACTION_BASH);
  }

  /**
   * After an attack. With a shield (0x00409C30): attack again at once when the target is within
   * 8 ft and neither attacking nor blocking, else raise the shield for the block clip. Without
   * one (0x0040A500): for up to 1.5 s step back while within 8 ft, stand at 8-12 ft.
   */
  private enterPost(m: Mob, target: Actor, dist: number): void {
    if (m.shield) {
      if (mobBand(dist) === 0 && !this.attacking(target) && !this.shieldRaised(target)) {
        m.brain = 'decide';
        return;
      }
      m.shieldUntil = m.brainUntil = this.tick + MOB_SHIELD_TICKS;
    } else m.brainUntil = this.tick + MOB_POST_TICKS;
  }

  /** One tick of the post-attack phase; false when it is over. */
  private postAttack(m: Mob, target: Actor, dist: number): boolean {
    if (this.tick >= m.brainUntil) return false;
    if (m.shield) return true;
    const band = mobBand(dist);
    if (band > 1 || this.turnedAway(target, m)) return false;
    // The hop back (ASM_HOP_B) the original takes against an attacking target is played as this step back.
    if (band === 0) m.input.flags = INPUT.BACK | INPUT.WALK;
    return true;
  }

  /** Leaves combat: no sequence, shield down, the next fight starts with a fresh decision. */
  private calmDown(m: Mob): void {
    m.brain = 'decide';
    m.lastPick = null;
    m.spellPick = null;
    m.mobCast = null;
    m.seq = null;
    m.shieldUntil = 0;
    m.walkShield = false;
  }

  /** A creature's shield is raised (walking in, after an attack, a block). */
  private mobShieldUp(m: Mob): boolean {
    return m.shield !== null && !m.swing && m.hitUntil <= this.tick && (m.blockUntil > this.tick || m.shieldUntil > this.tick || m.walkShield);
  }

  /**
   * The shield rush meeting a body (0x493F20 with physics flag 0x40000, the whole RAM_SHOULDER
   * state). Characters do not collide here, so the charge's run into a body is redone: the body
   * takes 0.3 of the overlap and the rusher stops against it. Each blocked tick rolls the
   * original's 5 % per step: the victim's impact (creatures reel back and are knocked down, the
   * live log; players are stunned, ASM_IMPACT_MEDIUM) and a rushing player's 1 HP loss.
   */
  private rushContact(a: Actor, before: { x: number; z: number }): void {
    const c = a.character;
    if (c.actionLength - c.rollTicks <= 1) a.rushHit.clear();
    const f = forwardXZ(dequantizeAngle(a.yaw));
    const pos = c.position;
    const advance = (pos.x - before.x) * f.x + (pos.z - before.z) * f.z;
    for (const v of this.actors.values()) {
      if (v === a || v.kind === a.kind || !alive(v)) continue;
      const vp = v.character.position;
      if (Math.abs(vp.y - pos.y) > PLAYER_HEIGHT) continue;
      const dx = vp.x - pos.x;
      const dz = vp.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= CHARACTER_SPACING + RUSH_CONTACT_SLACK || dx * f.x + dz * f.z <= 0) continue;
      // The body stops the charge: it is pushed by its share of the overlap, the rusher held at contact.
      const overlap = Math.min(Math.max(0, advance), CHARACTER_SPACING - dist);
      if (overlap > 0 && dist > 1e-4) {
        const nx = dx / dist;
        const nz = dz / dist;
        const pushed = this.moveBy(v, nx * overlap * RUSH_PUSH_SHARE, nz * overlap * RUSH_PUSH_SHARE);
        const back = overlap - (pushed.x * nx + pushed.z * nz);
        this.moveBy(a, -nx * back, -nz * back);
      }
      if (this.random() >= RUSH_TICK_CHANCE) continue;
      this.rushImpact(a, v);
      if (!alive(a)) return;
    }
  }

  /** One successful rush roll: the victim's impact, the rusher's HP, the contact sounds (client). */
  private rushImpact(a: Actor, v: Actor): void {
    let reel = false;
    if (v.kind === 'mob' && isCitizen(v)) {
      if (a.kind === 'player') this.raiseAlarm(a);
    } else if (!a.rushHit.has(v.entityId) && v.character.grounded && v.hitUntil <= this.tick) {
      a.rushHit.add(v.entityId);
      reel = true;
      if (v.kind === 'mob') {
        // Logged: the creature reels back (IMPACT_BACK, from being pushed) and ~0.5 s later is
        // knocked down (IMPACT_SEVERE), losing no HP.
        this.hitReaction(v, ACTION_IMPACT);
        v.knockdownAt = this.tick + hitReactionTicks(ACTION_IMPACT);
        v.hitUntil = v.knockdownAt + hitReactionTicks(ACTION_KNOCKDOWN);
        if (v.state !== 'chase') v.state = 'chase';
        v.threat.set(a.entityId, (v.threat.get(a.entityId) ?? 0) + 1);
      } else {
        this.hitReaction(v, ACTION_STUN);
      }
    }
    this.broadcastNear(v, { op: SC.COMBAT_EVENT, d: { attacker: a.entityId, target: v.entityId, damage: 0, hp: Math.ceil(v.hp), killed: false, rush: true, ...(reel ? { reel } : {}) } });
    // A rushing player loses 1 HP each time (Stats_LoseHp: its flinch roll, and it can kill).
    if (a.kind === 'player') this.loseHp(a, a, 1, true);
  }

  /** Moves a character against the level, keeping its action, jump and clip; returns the move made. */
  private moveBy(a: Actor, x: number, z: number): { x: number; z: number } {
    const c = a.character;
    this.mw.controller.computeColliderMovement(c.collider, { x, y: 0, z }, undefined, CHARACTER_GROUPS);
    const moved = this.mw.controller.computedMovement();
    const p = c.position;
    const air = { kind: c.airKind, velX: c.airVelX, velZ: c.airVelZ, travel: c.airTravel, rise: c.airRise };
    const length = c.actionLength;
    setCharacterState(c, { x: p.x + moved.x, y: p.y, z: p.z + moved.z }, c.velocityY, c.grounded, c.rollDir, c.rollTicks, air, { state: c.locoState, frame: c.locoFrame });
    c.actionLength = length;
    return { x: moved.x, z: moved.z };
  }

  private updateSwing(a: Actor): void {
    const s = a.swing!;
    const elapsed = this.tick - s.start;
    const t = s.timing;
    // A creature's shield bash meets bodies through its charge (rushContact), not a hit window.
    if (s.kind !== 'bash' && elapsed >= t.startup && elapsed < t.startup + t.active) {
      const pos = a.character.position;
      const yaw = dequantizeAngle(a.yaw);
      const reach = a.kind === 'player' ? PLAYER_REACH + PLAYER_RADIUS : s.reach ?? a.archetype.reach + PLAYER_RADIUS;
      const arc = a.kind === 'player' ? PLAYER_ARC_DEG : a.archetype.arcDeg;
      for (const target of this.actors.values()) {
        if (!this.hostile(a, target) || !alive(target) || s.hit.has(target.entityId)) continue;
        const tp = target.character.position;
        if (!inMeleeArc(pos.x, pos.z, yaw, tp.x, tp.z, reach, arc)) continue;
        s.hit.add(target.entityId);
        if (this.blocks(target, a)) {
          // A creature's stopped hit plays its quick block (PE07: 20 frames at 1000/30 fps).
          if (target.kind === 'mob') {
            target.blockUntil = Math.max(target.blockUntil, this.tick + MOB_BLOCK_ANIM_TICKS);
            // A blow stopped while guarding after an attack ends the guard (0x00409C30: the
            // stopped-blow event): the creature decides again, and the target is attacking.
            if (target.brain === 'post') target.brainUntil = this.tick;
          }
          // 0x44D290: the stopped blow's sound by the attacker's edge, its sparks along the blade's sweep.
          const sweep = this.worldSweep(a, s);
          this.broadcastNear(target, {
            op: SC.COMBAT_EVENT,
            d: { attacker: a.entityId, target: target.entityId, damage: 0, hp: Math.ceil(target.hp), killed: false, blocked: true, sharp: sharpEdge(a), ...(sweep ? { sweep } : {}) },
          });
          this.shove(a, target, s, true);
          continue;
        }
        this.applyDamage(a, target, this.rollDamage(a, s.combo));
        if (alive(target)) this.shove(a, target, s, false);
        if (!alive(a)) return;
      }
      if (a.kind === 'player' && this.objects.size) this.hitBreakables(a, s, pos, yaw);
    }
    if (elapsed >= t.startup + t.active + t.recovery) {
      a.swing = null;
      if (a.kind === 'player') {
        if (a.pendingEquip) {
          const { slot, equip, itemId, to } = a.pendingEquip;
          a.pendingEquip = null;
          this.applyEquipRequest(a, slot, equip, itemId, to);
        }
        if (a.queuedAttack) this.startPlayerSwing(a, 'normal', s.combo + 1);
      }
    }
  }

  /**
   * Engine Stats_TryBlockWithShield: a raised shield stops the hit when the attacker lies inside
   * the frontal cone dot(facing, toAttacker) > cos(30) — 30 radians in the original, ≈ ±81°.
   */
  private blocks(p: Actor, attacker: Actor): boolean {
    // Creatures block frontal hits while their shield is up (stance shield or a block reaction).
    const raised = p.kind === 'player'
      ? p.blocking
      : this.mobShieldUp(p);
    if (!raised) return false;
    const pp = p.character.position;
    const ap = attacker.character.position;
    const dx = ap.x - pp.x;
    const dz = ap.z - pp.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return true;
    const f = forwardXZ(dequantizeAngle(p.yaw));
    return (dx * f.x + dz * f.z) / dist > ORIGINAL_BLOCK_COS;
  }

  /**
   * The blow's shove (0x0044D290 → the physics' one-frame impulse): the victim is moved along the
   * sweep of the attacker's blade (hitShove), against the level like any movement.
   */
  private shove(a: Actor, target: Actor, s: Swing, blocked: boolean): void {
    const sweep = attackSweep(s.kind, s.combo);
    if (!sweep) return;
    const d = hitShove(Math.hypot(sweep[0], sweep[1]), blocked);
    if (d <= 0) return;
    const [ux, uz] = this.worldSweep(a, s)!;
    this.moveBy(target, ux * d, uz * d);
  }

  /** The horizontal direction of the attacker's blade sweep in the world (unit x, z), or null. */
  private worldSweep(a: Actor, s: Swing): [number, number] | null {
    const sweep = attackSweep(s.kind, s.combo);
    if (!sweep) return null;
    const h = Math.hypot(sweep[0], sweep[1]);
    const f = forwardXZ(dequantizeAngle(a.yaw));
    // x right, z forward in the attacker's frame; right = (-f.z, f.x).
    return [(sweep[0] * -f.z + sweep[1] * f.x) / h, (sweep[0] * f.x + sweep[1] * f.z) / h];
  }

  /** Starts a hit reaction: the current swing / hop / retreat is interrupted. */
  private hitReaction(target: Actor, action: number): void {
    target.swing = null;
    target.hitUntil = this.tick + hitReactionTicks(action, target.character.clipRate);
    startHitReaction(target.character, action);
    if (target.kind === 'player') {
      target.queuedAttack = false;
      target.cast = null;
    } else {
      // The impact aborts the behaviour (0x004800C0: the state's flag 0x800): no pause after it,
      // the brain decides again as soon as the impact is over.
      target.seq = null;
      target.mobCast = null;
      target.shieldUntil = 0;
      target.brain = 'decide';
    }
  }

  /**
   * A creature's impact (0x004273F0) from the side the blow came from: from the front
   * ASM_IMPACT_FRONT or (4 in 5) FRONT_ALT_01 / RIGHT_FRONT / LOW_FRONT / TWO_STEPS_BACK, from
   * the left IMPACT_LEFT or (1 in 2) LEFT_ALT_01, from the right or behind the plain impact.
   */
  private creatureImpact(target: Mob, attacker: Actor): number {
    const tp = target.character.position;
    const ap = attacker.character.position;
    const f = forwardXZ(dequantizeAngle(target.yaw));
    const dx = ap.x - tp.x;
    const dz = ap.z - tp.z;
    const ahead = dx * f.x + dz * f.z;
    const right = dx * -f.z + dz * f.x;
    if (Math.abs(ahead) < Math.abs(right)) {
      return right < 0 && Math.floor(this.random() * 2) === 1 ? ACTION_IMPACT_LEFT_ALT : ACTION_IMPACT;
    }
    if (ahead <= 0) return ACTION_IMPACT;
    return [ACTION_IMPACT, ACTION_IMPACT_FRONT_ALT, ACTION_IMPACT_RIGHT_FRONT, ACTION_IMPACT_LOW_FRONT, ACTION_IMPACT_TWO_STEPS_BACK][Math.min(4, Math.floor(this.random() * 5))]!;
  }

  /** Outgoing damage vector (engine: Stats_GetOutgoingDamage). */
  private rollDamage(a: Actor, combo: number): DamageVector {
    if (a.kind === 'player') {
      const dmg = a.weapon.damage!;
      const slash = dmg[0]!;
      const bash = dmg[1]!;
      const hit = originalWeaponHit(slash, bash, a.damageMultiplier);
      const amount = hit.amount * COMBO_MULTIPLIERS[combo - 1]!;
      // Heroism (HERO, kind 4: the damage multipliers +0x11C).
      return this.magic.outgoing(a, damageVector(hit.type === 'slash' ? { SLASH: amount } : { BASH: amount }));
    }
    // Creatures skip the stronger-of-slash/bash and Might rules (empty stats slot 45): whole weapon vector.
    return this.magic.outgoing(a, [...(a.damage ?? a.weapon.damage!)]);
  }

  /** Incoming damage (engine: Stats_TakeDamage + HP loss with flinch roll). */
  private applyDamage(attacker: Actor, target: Actor, incoming: DamageVector): void {
    // Stone skin (STON, kind 6: the resist multipliers +0x17C).
    incoming = this.magic.incoming(target, incoming);
    const resist = target.kind === 'player' ? target.resist : target.archetype.resist;
    const protection = target.kind === 'player' ? target.armor?.protection : undefined;
    const damage = Math.round(originalDamageTaken(incoming, resist, protection) * 100) / 100;
    this.loseHp(attacker, target, damage);
  }

  /** Stats_LoseHp (0x0044CA00): the HP loss, the player's flinch roll, death; `rush`: a rush's own cost. */
  private loseHp(attacker: Actor, target: Actor, damage: number, rush = false): void {
    const hpBefore = target.hp;
    let impact: number | undefined;
    target.hp = Math.max(0, target.hp - damage);
    const killed = target.hp <= 0;
    if (killed) target.hp = 0;
    if (!killed && hpBefore > 0 && damage > 0 && target.character.grounded) {
      // Every landed hit interrupts with an impact (the original skips airborne targets). The
      // player rolls for a stun or a knock-down (confirmed live: v = 0.771 knocked Drake down,
      // 0.845 and 1.145 stunned him). Creatures take a directional impact, often a long one.
      // The rush's own cost has no blow (0x44D290's impact flag): only the roll's stun / knock-down.
      let reaction: number | null = ACTION_IMPACT;
      if (target.kind === 'player') {
        const roll = originalFlinch(damage, hpBefore, this.random());
        reaction = roll === 'knockdown' ? ACTION_KNOCKDOWN : roll === 'stun' ? ACTION_STUN : rush ? null : ACTION_IMPACT;
      } else reaction = this.creatureImpact(target, attacker);
      if (reaction !== null) {
        impact = IMPACT_VARIANTS[reaction]?.state;
        // A knock-down is not cut short by another hit's lighter reaction.
        if (!(isHitAction(target.character.rollDir) && target.character.rollDir === ACTION_KNOCKDOWN && target.hitUntil > this.tick)) this.hitReaction(target, reaction);
      }
    }
    let reward: CombatEventMsg['d']['reward'];

    if (target.kind === 'mob') {
      target.threat.set(attacker.entityId, (target.threat.get(attacker.entityId) ?? 0) + damage);
      // Unarmed peaceful creatures (citizens) take the blows; armed ones (guards) fight back.
      const fightsBack = !target.archetype.passive || target.weapon.id !== UNARMED.id;
      if (target.state !== 'chase' && fightsBack) target.state = 'chase';
      if (attacker.kind === 'player' && target.archetype.passive) this.raiseAlarm(attacker);
      // A creature that fights back turns on whoever hurt it (a spectral ally too).
    } else {
      target.statsDirty = true;
    }

    if (killed) {
      target.swing = null;
      this.magic.clearStatuses(target);
      if (target.kind === 'player') this.magic.dropOwner(target);
      // The death clip carries the body itself (client side); no timed action keeps moving it.
      startTimedAction(target.character, 0);
      if (target.kind === 'player') target.cast = null;
      if (target.kind === 'mob') {
        target.mobCast = null;
        target.deadUntil = this.tick + target.archetype.respawnTicks;
        target.threat.clear();
        // A spectral ally's kills are its owner's.
        const credit = attacker.kind === 'player' ? attacker : attacker.ally !== undefined ? this.actors.get(attacker.ally) : undefined;
        if (credit?.kind === 'player' && target.ally === undefined) {
          reward = this.grantReward(credit, target.archetype);
          this.fireDeathTrigger(credit, target.placement);
        }
      } else {
        target.deadUntil = this.tick + PLAYER_RESPAWN_TICKS;
        target.pendingEquip = null;
        target.queuedAttack = false;
      }
    }

    this.broadcastNear(target, {
      op: SC.COMBAT_EVENT,
      d: { attacker: attacker.entityId, target: target.entityId, damage, hp: Math.ceil(target.hp), killed, ...(rush ? { rush } : { sharp: sharpEdge(attacker) }), ...(impact ? { impact } : {}), ...(reward ? { reward } : {}) },
    });
  }

  private grantReward(p: Player, arch: MobArchetype): { xp: number; gold: number; loot?: string[] } {
    const gold = arch.goldMin + Math.floor(this.random() * (arch.goldMax - arch.goldMin + 1));
    this.addExperience(p, arch.xpReward);
    p.gold += gold;
    const loot: string[] = [];
    for (const drop of arch.loot) {
      if (this.random() >= drop.chance) continue;
      const def = this.items.get(drop.itemId);
      if (def && addItem(p.inventory, def.id) !== null) loot.push(def.name);
    }
    if (loot.length > 0) {
      p.inventoryDirty = true;
      this.sendInventory(p);
    }
    p.statsDirty = true;
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
    return { xp: arch.xpReward, gold, ...(loot.length > 0 ? { loot } : {}) };
  }

  /** Stats_AddExperience: the XP, and Stats_LevelUp for each level reached. */
  private addExperience(p: Player, xp: number): void {
    p.xp += xp;
    p.statsDirty = true;
    const level = levelForXp(p.xp);
    if (level > p.level) {
      // Engine Stats_LevelUp: derived stats are recomputed and the max-HP gain is added to HP.
      const before = p.maxHp;
      p.level = level;
      p.maxHp = playerMaxHp(p.attributes, level);
      p.maxMana = originalMaxMana(p.attributes, level);
      p.damageMultiplier = originalDamageMultiplier(p.attributes, level);
      p.baseClipRate = originalSpeedMultiplier(p.attributes, level);
      p.moveStats = { ...p.moveStats, clipRate: p.baseClipRate * this.playerRate(p) };
      p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - before));
    }
  }

  private respawn(a: Actor): void {
    a.deadUntil = 0;
    a.hp = a.maxHp;
    a.swing = null;
    a.anim = ANIM.IDLE;
    if (a.kind === 'mob') {
      a.state = 'idle';
      a.blockUntil = 0;
      a.hitUntil = 0;
      a.threat.clear();
      delete a.fightsNearest;
      this.calmDown(a);
      a.yaw = a.spawnYaw;
      setCharacterState(a.character, a.spawn, 0, false);
    } else {
      this.toRespawnSpot(a);
      a.hitUntil = 0;
      a.statsDirty = true;
    }
  }

  private broadcastNear(target: Actor, msg: ServerControlMsg): void {
    const tp = target.character.position;
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) {
      const pp = p.character.position;
      if (p === target || Math.hypot(pp.x - tp.x, pp.z - tp.z) <= INTEREST_RADIUS) this.outbox.send(p.connId, text);
    }
  }

  private sendStats(p: Player): void {
    p.statsDirty = false;
    this.sendJson(p.connId, {
      op: SC.PLAYER_STATS,
      d: {
        hp: Math.ceil(p.hp),
        maxHp: p.maxHp,
        level: p.level,
        xp: p.xp,
        gold: p.gold,
        dead: !alive(p),
        mana: p.mana,
        maxMana: p.maxMana,
        spells: p.spells.map((s) => ({ ...s })),
        spell: p.selectedSpell,
        light: p.light ? p.light.radius : 0,
        statuses: [...p.statuses.values()].map((st) => ({ tag: st.tag, seconds: Math.max(0, (st.until - this.tick) / TICK_RATE) })),
        speed: p.moveStats.clipRate ?? 1,
        name: p.name,
        attributes: { ...p.attributes },
        damageMultiplier: p.damageMultiplier,
        resist: p.resist.map((r, t) => r * (p.armor?.protection?.[t] ?? 1)),
        damage: [...(p.weapon.damage ?? [])],
      },
    });
  }

  private sendSnapshot(p: Player, tick: number): void {
    const pos = p.character.position;
    const n = this.grid.queryRadius(pos.x, pos.z, INTEREST_RADIUS, this.scratchIds);
    const current = new Map<number, EntityState>();
    for (let i = 0; i < n; i++) {
      const id = this.scratchIds[i]!;
      const other = this.actors.get(id);
      if (!other) continue;
      const op = other.character.position;
      if (id !== p.entityId && Math.hypot(op.x - pos.x, op.z - pos.z) > INTEREST_RADIUS) continue;
      current.set(id, this.states.get(id)!);
    }

    for (const id of current.keys()) {
      if (id === p.entityId || p.known.has(id)) continue;
      const other = this.actors.get(id)!;
      const kind: EntityKind = other.kind;
      this.sendJson(p.connId, {
        op: SC.ENTITY_SPAWN,
        d: {
          id, kind, name: other.name, maxHp: other.maxHp,
          ...(other.kind === 'mob' ? { archetype: other.archetype.id, ...(other.placement !== undefined ? { placement: other.placement } : {}), ...(other.ally !== undefined ? { ally: true } : {}) } : {}),
          ...(other.statuses.size ? { statuses: [...other.statuses.keys()] } : {}),
        },
      });
    }
    for (const id of p.known) {
      if (!current.has(id)) this.sendJson(p.connId, { op: SC.ENTITY_DESPAWN, d: { id } });
    }
    p.known = new Set([...current.keys()].filter((id) => id !== p.entityId));

    const baseline = p.ackTick > 0 && tick - p.ackTick <= MAX_BASELINE_AGE ? p.history.get(p.ackTick) ?? null : null;
    const need = snapshotMaxBytes(current.size, baseline?.size ?? 0);
    if (need > this.encodeBuf.byteLength) this.encodeBuf = new DataView(new ArrayBuffer(need * 2));
    const len = encodeSnapshot(
      this.encodeBuf,
      {
        serverTick: tick,
        baselineTick: baseline ? p.ackTick : 0,
        lastProcessedInput: p.lastProcessedInput,
        selfVelY: Math.round(p.character.velocityY * 1000),
        selfGrounded: p.character.grounded,
        selfRollDir: p.character.rollDir,
        selfRollTicks: p.character.rollTicks,
        selfAirKind: p.character.airKind,
        selfAirVelX: Math.round(p.character.airVelX * 1000),
        selfAirVelZ: Math.round(p.character.airVelZ * 1000),
        selfAirTravel: Math.round(p.character.airTravel * 1000),
        selfAirRise: Math.round(p.character.airRise * 1000),
        selfLocoState: p.character.locoState,
        selfLocoFrame: p.character.locoFrame,
      },
      current,
      baseline,
    );
    this.outbox.send(p.connId, new Uint8Array(this.encodeBuf.buffer, 0, len).slice());

    p.history.set(tick, current);
    p.history.delete(tick - HISTORY_TICKS);
  }

  /** Debug/test access to a connection's authoritative character. */
  characterOf(connId: number): Character | undefined {
    return this.players.get(connId)?.character;
  }

  /** Debug/test view of every actor. */
  inspect(): { id: number; kind: Actor['kind']; hp: number; alive: boolean; state?: Mob['state']; brain?: Mob['brain']; swinging: boolean; anim: number; shield: boolean; flags: number; x: number; z: number; yaw: number }[] {
    return [...this.actors.values()].map((a) => ({
      id: a.entityId,
      kind: a.kind,
      hp: a.hp,
      alive: alive(a),
      ...(a.kind === 'mob' ? { state: a.state, brain: a.brain } : {}),
      swinging: !!a.swing,
      anim: this.states.get(a.entityId)?.anim ?? 0,
      shield: ((this.states.get(a.entityId)?.flags ?? 0) & 1) !== 0,
      flags: this.states.get(a.entityId)?.flags ?? 0,
      yaw: dequantizeAngle(a.yaw),
      x: a.character.position.x,
      z: a.character.position.z,
    }));
  }

  stats(connId: number): { dropped: number; malformed: number; queued: number } | undefined {
    const p = this.players.get(connId);
    return p && { dropped: p.queue.dropped, malformed: p.malformed, queued: p.queue.length };
  }
}

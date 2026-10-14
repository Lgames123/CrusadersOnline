import {
  ANIM,
  BUILTIN_ITEMS,
  LEVEL_PREFIX,
  LEVEL_UNIT_METRES,
  floorAt,
  applyQuestAction,
  emptyStoryState,
  estimateSequenceMs,
  inStoryVolume,
  storyFlag,
  type StorySequence,
  type StoryState,
  type StoryTrigger,
  TICK_MS,
  setDoorPose,
  stepDoorMotion,
  swingKeyAwayFrom,
  swingPoint,
  swingPose,
  type DoorMotion,
  type DoorSwing,
  inPortal,
  UNARMED,
  PORTAL_OBJECT_BASE,
  PORTAL_USE_REACH,
  arrivalPoint,
  GOLD_ITEM,
  itemSlug,
  takeOne,
  addItem,
  equipmentOf,
  sanitizeInventory,
  setEquipped,
  startingInventory,
  INVENTORY_SLOTS,
  type InventoryEntry,
  type InventoryItemView,
  type ItemCatalog,
  type ItemDef,
  COMBO_MULTIPLIERS,
  COMBO_WINDOW_TICKS,
  DEFAULT_MOVEMENT_STATS,
  uniformMovementStats,
  locomotionAnim,
  movementAnim,
  looksGrounded,
  movementFacingOffset,
  attackAnim,
  BUILTIN_SPELLS,
  TICK_RATE,
  CASTABLE_SPELLS,
  MANA_REGEN_TICKS,
  MAX_SPELL_LEVEL,
  SPELL_CONJURE_TICKS,
  originalMaxMana,
  type KnownSpell,
  type SpellId,
  type SpellTable,
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
  RUSH_CONTACT_TICKS,
  RUSH_REACH,
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
   * sequence loads another act; `keep`: arrive at this position if `target` is on the same mesh.
   */
  portal?(connId: number, target: string, keep?: { x: number; y: number; z: number; mesh: string }): void;
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
  /** A story level change: arrive here if this arena is on `arrivingMesh` (another act of the same level). */
  arrivingAt?: { x: number; y: number; z: number };
  arrivingMesh?: string;
  /** Story progress: triggers fired and the quest book (story.ts). */
  story?: StoryState;
}

/** Player state carried across a zone transfer (everything but the position). */
export type TransferState = Omit<JoinOptions, 'position' | 'arrivingFrom' | 'arrivingAt' | 'arrivingMesh'>;

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
const OBJECT_RESPAWN_TICKS = 20 * 300; // 5 min, so a persistent world refills
const BREAKABLE_RADIUS = 0.5;
/** Hit-set key offset so swings can record breakables next to entity ids. */
const OBJECT_HIT_KEY = 1_000_000;

interface WorldObject {
  def: WorldObjectDef;
  state: WorldObjectState;
  hp: number;
  respawnAt: number;
  /** Swinging doors: the swing, the slab's shut footprint (x/z hull, metres) and the motion. */
  swing?: { def: DoorSwing; points: Float32Array; hull: [number, number][]; motion: DoorMotion | null; blocked: boolean };
}

/** One change in an OBJECT_STATE message. */
interface ObjectChange {
  id: number;
  state: WorldObjectState;
  /** Entity that caused it (pickup, opening, destruction). */
  by?: number;
  /** Item names granted to `by`. */
  loot?: string[];
  /** Breakables: damage of this hit and remaining HP. */
  damage?: number;
  hp?: number;
  /** Swinging doors: the motion as of now. */
  swing?: DoorMotion;
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

/** Citizens' strolls: radius around their place (m), longest walk and the pause between walks. */
const STROLL_RADIUS = 4;
const STROLL_MAX_TICKS = 20 * 8;
const STROLL_PAUSE_MIN = 20 * 4;
const STROLL_PAUSE_SPREAD = 20 * 8;

/**
 * Citizens and an assault (logged in the original, Cs1a): the one struck flinches (ASM_IMPACT_*),
 * then it and every citizen within ~60 ft on the same floor stand on the alert facing it
 * (ASM_COMBAT_STANDING, ~0.25 s) and run away from it (~7 s). Frightened, they stay wary: a
 * player coming within ~30 ft sets them off again at once.
 */
const WITNESS_RADIUS = 18;
const ALERT_TICKS = 5;
const FLEE_TICKS = 20 * 7;
const WARY_RADIUS = 9;
const REALERT_TICKS = 2;
/** Talking: reach (the client's Tab range plus slack) and turn rate (logged ~90 degrees a second). */
const TALK_REACH = 3;
const TALK_TURN_RATE = Math.PI / 2;
/** How long a frightened citizen stays wary (not measured: the capture ended first). */
const WARY_TICKS = 20 * 60;

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
  lastSwingEnd: number;
  lastCombo: number;
  /** Tick at which a dead actor comes back; 0 while alive. */
  deadUntil: number;
  /** Tick until which a hit reaction (impact, stun, knock-down) keeps the actor from acting; 0 = none. */
  hitUntil: number;
}

interface Player extends ActorBase {
  kind: 'player';
  /** Movement stats: the original's, the server's features, and the clip rate (speed multiplier). */
  moveStats: MovementStats;
  connId: number;
  characterId: string | null;
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
  /** Creatures already met by the current shield rush. */
  rushHit: Set<number>;
  mana: number;
  maxMana: number;
  spells: KnownSpell[];
  selectedSpell: SpellId | null;
  /** Spell being conjured (ASM_SPELL_CONJURE) until `end`. */
  cast: { spell: SpellId; level: number; end: number } | null;
  /** Tick of the next mana point while below the maximum. */
  manaRegenAt: number;
  /** Torch light around the player (radius in metres) until `until`. */
  light: { radius: number; level: number; until: number } | null;
  queuedKind: AttackKind;
  /** Body yaw offset from the view yaw (diagonal movement), radians; replicated in the yaw. */
  facingOffset: number;
  statsDirty: boolean;
  attributes: Attributes;
  resist: DamageVector;
  inventory: InventoryEntry[];
  inventoryDirty: boolean;
  /** Equipment change requested mid-swing, applied when the swing ends. */
  pendingEquip: { slot: number; equip: boolean } | null;
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
  state: 'idle' | 'chase' | 'return' | 'flee' | 'talk';
  threat: Map<number, number>;
  /**
   * The original's melee brain (0x00409520): deciding, running in (beyond 12 ft), walking in
   * (shield up) to its engage distance, an attack sequence, the pause after it, and what follows
   * an attack (shield up, or stepping back without a shield).
   */
  brain: 'decide' | 'run' | 'walkIn' | 'attack' | 'pause' | 'post';
  /** The decision before the current one (an attack is followed by 'post'). */
  lastPick: 'run' | 'walkIn' | 'attack' | 'post' | null;
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
  /** Peaceful creatures: strolls about its place (citizens), the current stroll target and the next start. */
  wanders: boolean;
  strollTo: { x: number; z: number } | null;
  strollAt: number;
  strollUntil: number;
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
}

type Actor = Player | Mob;

const alive = (a: Actor) => a.deadUntil === 0;
/** Unarmed peaceful creatures (citizens, merchants): no flinch, no fighting back - they run. */
const isCitizen = (m: Mob) => m.archetype.passive && m.weapon.id === UNARMED.id;
/** Minimum distance between two characters' centres (two capsule radii). */
const CHARACTER_SPACING = 2 * PLAYER_RADIUS;
/** Quick shield block clip (PE07, 20 frames at 1000/30 fps). */
const MOB_BLOCK_ANIM_TICKS = Math.round((20 / (1000 / 30)) * 20);

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
  private readonly actors = new Map<number, Actor>(); // by entityId
  private readonly states = new Map<number, EntityState>();
  private nextEntityId = 1;
  private spawnIndex = 0;
  private encodeBuf = new DataView(new ArrayBuffer(16 * 1024));
  private readonly scratchIds: number[] = [];
  private readonly scratchFrames: InputFrame[] = Array.from({ length: MAX_INPUT_FRAMES }, createInputFrame);
  private readonly frame = createInputFrame();
  private readonly objects = new Map<number, WorldObject>();
  /** Height below which a player has fallen out of the level (catchFall). */
  private readonly fallLimit: number;

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

  private spawnMob(archetypeId: string, at: ArenaDef['mobSpawns'][number]): void {
    const base = MOB_ARCHETYPES[archetypeId];
    if (!base) throw new Error(`unknown mob archetype ${archetypeId}`);
    // Original level placements carry their own HP, XP value and resists.
    const archetype: MobArchetype = {
      ...base,
      ...(at.hp !== undefined && at.hp > 0 ? { maxHp: at.hp } : {}),
      ...(at.xp !== undefined ? { xpReward: at.xp } : {}),
      ...(at.resist?.length === 11 ? { resist: at.resist } : {}),
    };
    const weapon = this.items.get(archetype.weapon) ?? (archetype.passive ? UNARMED : undefined);
    if (!weapon) throw new Error(`unknown weapon ${archetype.weapon} for ${archetypeId}`);
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
      lastSwingEnd: -1e9,
      lastCombo: 0,
      deadUntil: 0,
      hitUntil: 0,
      archetype,
      weapon,
      shield: archetype.shield ? this.items.get(archetype.shield) ?? null : null,
      blockUntil: 0,
      nextBlockTick: 0,
      spawn: { x: at.x, y: at.y, z: at.z },
      spawnYaw: quantizeAngle(at.yaw ?? 0),
      state: 'idle',
      threat: new Map(),
      brain: 'decide',
      lastPick: null,
      brainUntil: 0,
      seq: null,
      shieldUntil: 0,
      walkShield: false,
      swingSerial: 0,
      knockdownAt: 0,
      wanders: !!at.wander,
      strollTo: null,
      strollAt: 0,
      strollUntil: 0,
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
    };
    this.register(mob);
  }

  join(connId: number, opts: JoinOptions): number {
    if (this.players.has(connId)) throw new Error(`connection ${connId} already in zone`);
    const spawn = opts.arrivingAt && opts.arrivingMesh && opts.arrivingMesh === this.arena.mesh && validPosition(opts.arrivingAt)
      ? opts.arrivingAt
      : opts.arrivingFrom
      ? arrivalPoint(this.arena, opts.arrivingFrom)
      : validPosition(opts.position) ? opts.position : this.nextSpawnPoint();
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
      name: opts.name,
      character: createCharacter(this.mw, spawn),
      moveStats: { ...this.playerStats, clipRate: originalSpeedMultiplier(rules.attributes, level) },
      queue: new InputQueue(),
      yaw: (opts.yaw ?? 0) & 0xffff,
      anim: ANIM.IDLE,
      hp,
      maxHp,
      swing: null,
      lastSwingEnd: -1e9,
      lastCombo: 0,
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
      queuedKind: 'normal',
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
        entityId: p.entityId, zone: this.name, arena: this.arena.name, serverTick: this.tick, spawn: { ...p.character.position },
        ...(Object.keys(enabledFeatures(this.features)).length ? { features: enabledFeatures(this.features) } : {}),
      },
    });
    this.sendStats(p);
    this.sendInventory(p);
    this.sendJson(connId, { op: SC.QUEST_LOG, d: { log: p.story.quests } });
    if (this.objects.size) {
      const changed = [...this.objects.values()].filter((o) => o.state !== 'present').map((o) => ({ id: o.def.id, state: o.state, ...(o.swing?.motion ? { swing: { ...o.swing.motion } } : {}) }));
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
    if (p && id >= PORTAL_OBJECT_BASE) {
      // A door exit in reach (its trigger, widened by PORTAL_USE_REACH).
      const portal = this.arena.portals?.find((q) => q.id === id - PORTAL_OBJECT_BASE);
      if (portal?.use && alive(p) && inPortal(portal, p.character.position, PORTAL_USE_REACH)) this.outbox.portal?.(p.connId, portal.target);
      return;
    }
    const o = this.objects.get(id);
    // A swinging door may be opened again while it swings shut.
    const reopens = o?.swing?.motion?.phase === 'closing';
    if (!p || !o || !alive(p) || (o.state !== 'present' && !reopens) || o.def.kind === 'breakable') return;
    if (o.def.kind === 'door' || o.def.kind === 'lever') {
      this.openDoor(p, o, key);
      return;
    }
    const pos = p.character.position;
    if (Math.hypot(o.def.x - pos.x, o.def.z - pos.z) > INTERACT_RANGE || Math.abs(o.def.y - pos.y) > INTERACT_HEIGHT) return;
    const grants = o.def.kind === 'item' ? (o.def.item ? [o.def.item] : []) : (o.def.contents ?? []);
    const loot: string[] = [];
    for (const g of grants) if (this.grantItem(p, g.name, g.quantity)) loot.push(g.quantity > 1 ? `${g.quantity} ${g.name}` : g.name);
    if (o.def.kind === 'item' && grants.length && !loot.length) {
      this.sendJson(connId, { op: SC.ERROR, d: { code: 'bag_full', message: 'Your bag is full.' } }); // leave it there
      return;
    }
    o.state = o.def.kind === 'chest' ? 'open' : 'gone';
    o.respawnAt = this.tick + OBJECT_RESPAWN_TICKS;
    this.broadcastObjects([{ id, state: o.state, by: p.entityId, loot }]);
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

  /** Gold goes to the purse; known items to the bag (stacking potions). False if not taken. */
  private grantItem(p: Player, name: string, quantity: number): boolean {
    if (name === GOLD_ITEM) {
      p.gold += Math.max(1, quantity);
      p.statsDirty = true;
      return true;
    }
    const def = this.items.get(itemSlug(name));
    if (!def) return false;
    // A spell book is used as soon as it is touched (items.ctx): the spell is learned.
    if (def.type === 'spellbook' && def.spell) return this.learnSpell(p, def.spell);
    let added = false;
    for (let i = 0; i < Math.max(1, def.stackable ? 1 : quantity); i++) {
      if (addItem(p.inventory, def.id, def.stackable ? Math.max(1, quantity) : 1, this.items) === null) break;
      added = true;
    }
    if (added) {
      p.inventoryDirty = true;
      this.sendInventory(p);
    }
    return added;
  }

  /**
   * Learns a spell (level 1), or raises a known one by a level (assumption: the original's
   * level rule is not measured yet). False when already at the top level.
   */
  private learnSpell(p: Player, spell: SpellId): boolean {
    const known = p.spells.find((s) => s.spell === spell);
    if (known) {
      if (known.level >= MAX_SPELL_LEVEL) return false;
      known.level++;
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

  /**
   * Casts the selected spell (CS_CAST_SPELL): standing, not swinging or reeling, with the mana
   * for its level. Conjures for 1.54 s (ASM_SPELL_CONJURE), then takes effect (finishCast).
   */
  castSpell(connId: number): void {
    const p = this.players.get(connId);
    if (!p || !alive(p) || p.cast || p.swing || p.hitUntil > this.tick || !p.character.grounded) return;
    const spell = p.selectedSpell;
    const known = spell && p.spells.find((s) => s.spell === spell);
    if (!spell || !known || !CASTABLE_SPELLS.has(spell)) return;
    const values = this.spells[spell]?.[known.level - 1];
    if (!values || p.mana < values.mana) return;
    // ASM_SPELL_CONJURE (PK15) plays at the character's clip rate.
    p.cast = { spell, level: known.level, end: this.tick + Math.round(SPELL_CONJURE_TICKS / (p.moveStats.clipRate ?? 1)) };
    p.blocking = false;
  }

  /** The conjured spell takes effect. Torch light: a light around the caster for its duration. */
  private finishCast(p: Player): void {
    const c = p.cast!;
    p.cast = null;
    const values = this.spells[c.spell]?.[c.level - 1];
    if (!values) return;
    if (c.spell === 'torch_light') {
      // Recasting while the light is on spent no mana in the original (logged).
      if (p.light && p.light.until > this.tick) return;
      if (p.mana < values.mana) return;
      p.mana -= values.mana;
      p.light = { radius: values.value1 * 0.3048, level: c.level, until: this.tick + Math.round(values.duration * TICK_RATE) };
      p.statsDirty = true;
    }
  }

  /** Per-tick spell state: conjuring, mana regeneration, light expiry. */
  private updateMagic(p: Player): void {
    if (p.cast && this.tick >= p.cast.end) this.finishCast(p);
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
    if (!def || def.type !== 'potion' || !def.heal) return;
    takeOne(p.inventory, slot, this.items);
    p.hp = Math.min(p.maxHp, p.hp + def.heal);
    p.statsDirty = true;
    p.inventoryDirty = true;
    this.sendInventory(p);
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
  }

  private broadcastObjects(objects: ObjectChange[]): void {
    for (const p of this.players.values()) this.sendJson(p.connId, { op: SC.OBJECT_STATE, d: { objects } });
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
      this.broadcastObjects([{ id: o.def.id, state: o.state, by: a.entityId, damage, hp: Math.ceil(o.hp) }]);
    }
  }

  /**
   * Swinging doors: open, held, swung shut (the original's mover). A door does not swing into a
   * character: it waits until the way is clear (the original pushes Drake when it can).
   */
  private stepDoors(): void {
    const changes: ObjectChange[] = [];
    for (const o of this.objects.values()) {
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

  /**
   * Equip or unequip the item in an inventory slot (CS_EQUIP_ITEM). Ignored while dead; during a
   * swing the request is deferred to the swing's end so a weapon change never alters a swing
   * already in progress (the latest request wins).
   */
  equip(connId: number, slot: number, equip: boolean): void {
    const p = this.players.get(connId);
    if (!p || !alive(p)) return;
    if (p.swing) {
      p.pendingEquip = { slot, equip };
      return;
    }
    this.applyEquipRequest(p, slot, equip);
  }

  private applyEquipRequest(p: Player, slot: number, equip: boolean): void {
    if (!setEquipped(p.inventory, slot, equip, this.items)) return;
    this.applyEquipment(p);
    p.inventoryDirty = true;
    this.sendInventory(p);
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
  }

  private applyEquipment(p: Player): void {
    const eq = equipmentOf(p.inventory, this.items);
    p.weapon = eq.weapon;
    p.shield = eq.shield;
    p.armor = eq.armor;
    if (!p.shield) p.blocking = false;
  }

  private sendInventory(p: Player): void {
    const items: InventoryItemView[] = [];
    for (const e of p.inventory) {
      const def = this.items.get(e.itemId);
      if (!def) continue;
      items.push({
        slot: e.slot,
        itemId: e.itemId,
        name: def.name,
        type: def.type,
        equipped: e.equipped,
        ...(def.damage ? { damage: def.damage } : {}),
        ...(def.speed !== undefined ? { speed: def.speed } : {}),
        ...(def.protection ? { protection: def.protection } : {}),
        ...(e.quantity && e.quantity > 1 ? { quantity: e.quantity } : {}),
        ...(def.heal ? { heal: def.heal } : {}),
      });
    }
    this.sendJson(p.connId, { op: SC.INVENTORY_UPDATE, d: { items, slots: INVENTORY_SLOTS, weaponSpeed: p.weapon.speed ?? 1 } });
  }

  /**
   * A player below the level (fell off an open edge the edge walls missed) is put back at the
   * nearest spawn point.
   */
  private catchFall(p: Player): void {
    const pos = p.character.position;
    if (pos.y >= this.fallLimit) return;
    let best = this.arena.spawnPoints[0] ?? { x: 0, y: 1, z: 0 };
    for (const s of this.arena.spawnPoints) if (Math.hypot(s.x - pos.x, s.z - pos.z) < Math.hypot(best.x - pos.x, best.z - pos.z)) best = s;
    setCharacterState(p.character, best, 0, false);
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
      if (portal.use) continue; // door exits: the interact key (interact)
      const inside = inPortal(portal, pos);
      if (!inside) {
        p.inPortal.delete(portal.id);
      } else if (!p.inPortal.has(portal.id)) {
        p.inPortal.add(portal.id);
        this.outbox.portal?.(p.connId, portal.target);
      }
    }
  }

  // --- Story: triggers, scripted sequences, quests (story.ts; executable-analysis.md §17)

  /** The act of this zone's level ("cs1a"), or null for synthetic arenas. */
  private get act(): string | null {
    return this.arena.name.startsWith(LEVEL_PREFIX) ? this.arena.name.slice(LEVEL_PREFIX.length) : null;
  }

  /**
   * Triggers walked into (activation bit 0) fire once per character: a flag trigger starts the
   * sequence bound to it, a quest trigger updates the quest book.
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
      this.fireTrigger(p, t);
      if (p.cutscene) return;
    }
  }

  /** Fires a trigger for a player: its flag, then what it does (sequence, quest, relay targets). */
  private fireTrigger(p: Player, t: StoryTrigger, depth = 0): void {
    const act = this.act;
    if (!act || depth > 8) return;
    const flag = storyFlag(act, t.id);
    if (p.storyFlags.has(flag)) return;
    p.storyFlags.add(flag);
    p.story.flags.push(flag);
    if (t.kind === 'quest' && t.quest) this.applyQuest(p, t);
    if (t.kind === 'relay') {
      for (const ref of t.targets ?? []) {
        const next = 'trigger' in ref ? this.arena.story?.triggers.find((u) => u.id === ref.trigger) : undefined;
        if (next) this.fireTrigger(p, next, depth + 1);
      }
    }
    if (t.kind === 'flag' && !p.cutscene) {
      const seq = this.arena.story?.sequences.find((q) => q.trigger === t.id);
      if (seq) this.startCutscene(p, seq);
    }
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
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
          if (t) this.fireTrigger(p, t);
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
   * client: a request during recovery is buffered, requests during startup/active are ignored,
   * so attacking faster than the swing lifecycle has no effect.
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
      const t = p.swing.timing;
      if (this.tick - p.swing.start >= t.startup + t.active) {
        p.queuedAttack = true;
        p.queuedKind = kind;
      }
      return;
    }
    this.startPlayerSwing(p, kind);
  }

  private startPlayerSwing(p: Player, kind: AttackKind): void {
    const chained = kind === 'normal' && this.tick - p.lastSwingEnd <= COMBO_WINDOW_TICKS && p.lastCombo < COMBO_MULTIPLIERS.length;
    const combo = chained ? p.lastCombo + 1 : 1;
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
        if (!alive(p) || p.cutscene) this.frame.flags = 0;
        stepCharacter(this.mw, p.character, this.frame, p.moveStats, TICK_DT);
        p.lastProcessedInput = this.frame.clientTick;
        if (alive(p) && !p.cutscene) p.yaw = this.frame.yaw;
        if (!p.cutscene) this.checkPortals(p);
        this.catchFall(p);
        const moving = (this.frame.flags & MOVE_MASK) !== 0 && !(this.frame.flags & INPUT.ROOTED);
        p.blocking = alive(p) && p.shield !== null && (this.frame.flags & INPUT.BLOCK) !== 0 && !p.swing && p.hitUntil <= tick && p.character.rollDir !== ACTION_BASH;
        if (alive(p) && p.character.rollDir === ACTION_BASH) this.rushContact(p);
        // On diagonals the body turns into the motion, except with the shield up (it faces the view).
        p.facingOffset = moving && !(this.frame.flags & INPUT.BLOCK) ? movementFacingOffset(this.frame.flags, this.features.diagonalMoves) : 0;
        // Hit reactions are timed movement actions, so movementAnim() covers them too.
        p.anim = movementAnim(p.blocking ? this.frame.flags : this.frame.flags & ~INPUT.BLOCK, looksGrounded(p.character), p.character.rollDir, this.features.diagonalMoves);
        if (p.cast) p.anim = ANIM.SPELL_CONJURE;
      }
      if (alive(p)) this.updateMagic(p);
      if (p.cutscene) {
        if (tick >= p.cutscene.until) this.finishCutscene(p);
      } else if (alive(p)) this.checkStory(p);
    }

    // 2. Mobs think and move.
    for (const a of this.actors.values()) if (a.kind === 'mob' && alive(a)) this.updateMob(a);

    // 3. Swings: hit windows, recovery, combo buffering.
    for (const a of this.actors.values()) if (a.swing && alive(a)) this.updateSwing(a);

    // 4. Deaths and respawns (actors and world objects).
    if (this.objects.size && tick % 20 === 0) this.respawnObjects();
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
    const arch = m.archetype;
    const pos = m.character.position;
    const fromSpawn = Math.hypot(pos.x - m.spawn.x, pos.z - m.spawn.z);
    m.input.flags = 0;
    // Peaceful creatures stand (or stroll) until hit; armed ones then fight like any creature.
    if (arch.passive && m.state === 'idle' && m.waryUntil > this.tick) this.keepWary(m);
    if (arch.passive && m.state === 'idle') this.stroll(m);
    if (m.state === 'flee') this.flee(m);
    if (m.state === 'talk') this.keepTalking(m);

    if (m.state === 'idle' && !arch.passive) {
      const seen = this.noticedPlayer(m);
      if (seen) {
        m.threat.set(seen.entityId, (m.threat.get(seen.entityId) ?? 0) + 1);
        m.state = 'chase';
        m.brain = 'decide';
        m.lastPick = null;
      }
    }

    if (m.state === 'chase') {
      let target: Player | null = null;
      let top = 0;
      for (const [id, threat] of m.threat) {
        const p = this.actors.get(id);
        if (!p || p.kind !== 'player' || !alive(p)) {
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
    stepCharacter(this.mw, m.character, m.input, m.stats, TICK_DT);
    this.separate(m);
    m.anim = m.hitUntil > this.tick
      ? (m.character.rollDir === ACTION_KNOCKDOWN ? ANIM.KNOCKDOWN : ANIM.HIT)
      : m.blockUntil > this.tick
      ? ANIM.BLOCK
      : m.state === 'flee' && m.alertUntil > this.tick
      ? ANIM.ALERT
      : m.state === 'talk'
      ? ANIM.GESTURE
      : m.seq?.hop && this.tick < m.seq.hopUntil
      ? ANIM.HOP_FORWARD
      : m.input.flags & INPUT.BACK
      ? ANIM.RETREAT
      : m.input.flags & MOVE_MASK ? (m.input.flags & INPUT.WALK ? ANIM.WALK : ANIM.RUN) : ANIM.IDLE;
  }


  /** A citizen who saw an assault: on the alert facing it, then running away; calm again after. */
  private flee(m: Mob): void {
    const pos = m.character.position;
    if (m.hitUntil > this.tick) return; // the flinch plays out first
    if (this.tick >= m.fleeUntil) {
      m.state = 'idle';
      m.strollTo = null;
      m.strollAt = this.tick + STROLL_PAUSE_MIN;
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

  /** An assault at `at`: the citizens around see it and run (the alerted keep running further). */
  private witnessAssault(at: { x: number; y: number; z: number }): void {
    for (const m of this.actors.values()) {
      if (m.kind !== 'mob' || !alive(m) || !isCitizen(m)) continue;
      const p = m.character.position;
      if (Math.abs(p.y - at.y) > AGGRO_HEIGHT || Math.hypot(p.x - at.x, p.z - at.z) > WITNESS_RADIUS) continue;
      if (m.state !== 'flee') m.alertUntil = Math.max(this.tick, m.hitUntil) + ALERT_TICKS;
      m.state = 'flee';
      m.fleeUntil = Math.max(m.alertUntil, this.tick) + FLEE_TICKS;
      m.fleeFrom = { x: at.x, z: at.z };
    }
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
    if (m.state !== 'idle' && m.state !== 'talk') return;
    const a = p.character.position;
    const b = m.character.position;
    if (Math.hypot(a.x - b.x, a.z - b.z) > TALK_REACH || Math.abs(a.y - b.y) > AGGRO_HEIGHT) return;
    m.state = 'talk';
    m.talkTo = p.entityId;
    m.talkUntil = this.tick + Math.ceil(ms / TICK_MS);
    m.strollTo = null;
  }

  private keepTalking(m: Mob): void {
    const p = this.actors.get(m.talkTo);
    if (!p || !alive(p) || this.tick >= m.talkUntil) {
      m.state = 'idle';
      m.strollAt = this.tick + STROLL_PAUSE_MIN;
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

  /** A citizen's stroll: now and then a short walk to a point near its place, then a pause. */
  private stroll(m: Mob): void {
    if (!m.wanders) return;
    const pos = m.character.position;
    if (!m.strollTo) {
      if (this.tick < m.strollAt) return;
      const ang = this.random() * Math.PI * 2;
      const r = 1 + this.random() * (STROLL_RADIUS - 1);
      m.strollTo = { x: m.spawn.x + Math.cos(ang) * r, z: m.spawn.z + Math.sin(ang) * r };
      m.strollUntil = this.tick + STROLL_MAX_TICKS;
    }
    const d = Math.hypot(m.strollTo.x - pos.x, m.strollTo.z - pos.z);
    if (d < 0.4 || this.tick >= m.strollUntil) {
      m.strollTo = null;
      m.strollAt = this.tick + STROLL_PAUSE_MIN + Math.floor(this.random() * STROLL_PAUSE_SPREAD);
      return;
    }
    m.yaw = quantizeAngle(yawTowards(pos.x, pos.z, m.strollTo.x, m.strollTo.z));
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
    const push = { x: px, y: 0, z: pz };
    this.mw.controller.computeColliderMovement(m.character.collider, push, undefined, CHARACTER_GROUPS);
    const moved = this.mw.controller.computedMovement();
    setCharacterState(m.character, { x: pos.x + moved.x, y: pos.y, z: pos.z + moved.z }, m.character.velocityY, m.character.grounded);
  }

  /**
   * A hostile creature notices the nearest player on its floor within 100 ft ahead (60 degrees
   * either side of its heading) or 20 ft elsewhere, with level geometry not in between.
   */
  private noticedPlayer(m: Mob): Player | null {
    const pos = m.character.position;
    const heading = dequantizeAngle(m.yaw);
    let best: Player | null = null;
    let bestDist = Infinity;
    for (const p of this.players.values()) {
      if (!alive(p)) continue;
      const q = p.character.position;
      // Same floor only: original levels stack rooms.
      if (Math.abs(q.y - pos.y) > AGGRO_HEIGHT) continue;
      const d = Math.hypot(q.x - pos.x, q.z - pos.z);
      const off = Math.abs(angleDiff(yawTowards(pos.x, pos.z, q.x, q.z), heading));
      if (d >= (off < MOB_SIGHT_HALF_ANGLE ? MOB_SIGHT_RANGE : MOB_NEAR_SENSE_RANGE) || d >= bestDist) continue;
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
  private think(m: Mob, target: Player): void {
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
        default:
          return;
      }
    }
  }

  /** The next phase (0x004096A0): run in, walk in, attack, or what follows an attack. */
  private decide(m: Mob, target: Player, dist: number): void {
    const pick = mobBand(dist) > 1 ? 'run'
      : dist > m.archetype.engage && !this.attacking(target) ? 'walkIn'
      : m.lastPick === 'attack' ? 'post'
      : 'attack';
    m.lastPick = pick;
    m.brain = pick;
    if (pick === 'attack') this.startSequence(m, target, dist);
    else if (pick === 'post') this.enterPost(m, target, dist);
  }

  /** Whether the player is in an attacking state (state flag 0x20: swings, the rush, casting). */
  private attacking(p: Player): boolean {
    // Combo steps 4 and 5 (states 103 / 104) have no flags in the state table.
    return (p.swing !== null && !(p.swing.kind === 'normal' && p.swing.combo >= 4)) || p.cast !== null || p.character.rollDir === ACTION_BASH;
  }

  /** Whether the player has turned more than 90 degrees away from the creature (0x0040E2D0). */
  private turnedAway(p: Player, m: Mob): boolean {
    const a = p.character.position;
    const b = m.character.position;
    return Math.abs(angleDiff(yawTowards(a.x, a.z, b.x, b.z), dequantizeAngle(p.yaw))) > Math.PI / 2;
  }

  /** Starts an attack sequence (0x00409920): a special against a raised shield, else 0x004083F0's choice. */
  private startSequence(m: Mob, target: Player, dist: number): void {
    const special = target.blocking && Math.floor(this.random() * 1000) > MOB_SPECIAL_ROLL * 1000;
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
  private enterPost(m: Mob, target: Player, dist: number): void {
    if (m.shield) {
      if (mobBand(dist) === 0 && !this.attacking(target) && !target.blocking) {
        m.brain = 'decide';
        return;
      }
      m.shieldUntil = m.brainUntil = this.tick + MOB_SHIELD_TICKS;
    } else m.brainUntil = this.tick + MOB_POST_TICKS;
  }

  /** One tick of the post-attack phase; false when it is over. */
  private postAttack(m: Mob, target: Player, dist: number): boolean {
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
    m.seq = null;
    m.shieldUntil = 0;
    m.walkShield = false;
  }

  /** A creature's shield is raised (walking in, after an attack, a block). */
  private mobShieldUp(m: Mob): boolean {
    return m.shield !== null && !m.swing && m.hitUntil <= this.tick && (m.blockUntil > this.tick || m.shieldUntil > this.tick || m.walkShield);
  }

  /** Drake's shield rush: a creature met during the charge takes an impact (no damage). */
  private rushContact(p: Player): void {
    const c = p.character;
    const done = c.actionLength - c.rollTicks;
    if (done <= 1) p.rushHit.clear();
    if (done < RUSH_CONTACT_TICKS[0] || done > RUSH_CONTACT_TICKS[1]) return;
    const pos = c.position;
    const yaw = dequantizeAngle(p.yaw);
    for (const m of this.actors.values()) {
      if (m.kind !== 'mob' || !alive(m)) continue;
      const mp = m.character.position;
      if (!inMeleeArc(pos.x, pos.z, yaw, mp.x, mp.z, RUSH_REACH + PLAYER_RADIUS, PLAYER_ARC_DEG, PLAYER_RADIUS)) continue;
      // Logged in the original: the rushing player loses 1 HP per tick of contact (2-5 per rush).
      if (p.hp > 1) {
        p.hp -= 1;
        p.statsDirty = true;
      }
      if (p.rushHit.has(m.entityId)) continue;
      p.rushHit.add(m.entityId);
      if (!m.character.grounded) continue;
      if (isCitizen(m)) {
        this.witnessAssault(pos);
        continue;
      }
      // The creature reels back (IMPACT_BACK) and is knocked down (IMPACT_SEVERE) - no damage.
      this.hitReaction(m, ACTION_IMPACT);
      this.broadcastNear(m, { op: SC.COMBAT_EVENT, d: { attacker: p.entityId, target: m.entityId, damage: 0, hp: Math.ceil(m.hp), killed: false, rush: true } });
      m.knockdownAt = this.tick + hitReactionTicks(ACTION_IMPACT);
      m.hitUntil = m.knockdownAt + hitReactionTicks(ACTION_KNOCKDOWN);
      if (m.state !== 'chase') m.state = 'chase';
      m.threat.set(p.entityId, (m.threat.get(p.entityId) ?? 0) + 1);
    }
  }

  private updateSwing(a: Actor): void {
    const s = a.swing!;
    const elapsed = this.tick - s.start;
    const t = s.timing;
    if (elapsed >= t.startup && elapsed < t.startup + t.active) {
      const pos = a.character.position;
      const yaw = dequantizeAngle(a.yaw);
      const reach = a.kind === 'player' ? PLAYER_REACH + PLAYER_RADIUS : s.reach ?? a.archetype.reach + PLAYER_RADIUS;
      const arc = a.kind === 'player' ? PLAYER_ARC_DEG : a.archetype.arcDeg;
      for (const target of this.actors.values()) {
        if (target === a || target.kind === a.kind || !alive(target) || s.hit.has(target.entityId)) continue;
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
          this.broadcastNear(target, {
            op: SC.COMBAT_EVENT,
            d: { attacker: a.entityId, target: target.entityId, damage: 0, hp: Math.ceil(target.hp), killed: false, blocked: true },
          });
          this.shove(a, target, s, true);
          continue;
        }
        if (s.kind === 'bash') {
          // The shield bash stuns without damage (ASM_IMPACT_MEDIUM).
          if (target.kind === 'player' && target.character.grounded) this.hitReaction(target, ACTION_STUN);
          this.broadcastNear(target, {
            op: SC.COMBAT_EVENT,
            d: { attacker: a.entityId, target: target.entityId, damage: 0, hp: Math.ceil(target.hp), killed: false, blocked: false },
          });
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
      a.lastSwingEnd = this.tick;
      a.lastCombo = s.kind === 'normal' ? s.combo : 0;
      if (a.kind === 'player') {
        if (a.pendingEquip) {
          const { slot, equip } = a.pendingEquip;
          a.pendingEquip = null;
          this.applyEquipRequest(a, slot, equip);
        }
        if (a.queuedAttack) this.startPlayerSwing(a, a.queuedKind);
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
    const h = Math.hypot(sweep[0], sweep[1]);
    const d = hitShove(h, blocked);
    if (d <= 0) return;
    const f = forwardXZ(dequantizeAngle(a.yaw));
    // x right, z forward in the attacker's frame; right = (-f.z, f.x).
    const ux = (sweep[0] * -f.z + sweep[1] * f.x) / h;
    const uz = (sweep[0] * f.x + sweep[1] * f.z) / h;
    const c = target.character;
    this.mw.controller.computeColliderMovement(c.collider, { x: ux * d, y: 0, z: uz * d }, undefined, CHARACTER_GROUPS);
    const moved = this.mw.controller.computedMovement();
    const p = c.position;
    // Everything but the position carries on (a timed action, a jump, the locomotion clip).
    const air = { kind: c.airKind, velX: c.airVelX, velZ: c.airVelZ, travel: c.airTravel };
    const length = c.actionLength;
    setCharacterState(c, { x: p.x + moved.x, y: p.y, z: p.z + moved.z }, c.velocityY, c.grounded, c.rollDir, c.rollTicks, air, { state: c.locoState, frame: c.locoFrame });
    c.actionLength = length;
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
      return damageVector(hit.type === 'slash' ? { SLASH: amount } : { BASH: amount });
    }
    // Creatures skip the stronger-of-slash/bash and Might rules (empty stats slot 45): whole weapon vector.
    return [...a.weapon.damage!];
  }

  /** Incoming damage (engine: Stats_TakeDamage + HP loss with flinch roll). */
  private applyDamage(attacker: Actor, target: Actor, incoming: DamageVector): void {
    const resist = target.kind === 'player' ? target.resist : target.archetype.resist;
    const protection = target.kind === 'player' ? target.armor?.protection : undefined;
    const damage = Math.round(originalDamageTaken(incoming, resist, protection) * 100) / 100;
    const hpBefore = target.hp;
    let impact: number | undefined;
    target.hp = Math.max(0, target.hp - damage);
    const killed = target.hp <= 0;
    if (killed) target.hp = 0;
    if (!killed && hpBefore > 0 && damage > 0 && target.character.grounded) {
      // Every landed hit interrupts with an impact (the original skips airborne targets). The
      // player rolls for a stun or a knock-down (confirmed live: v = 0.771 knocked Drake down,
      // 0.845 and 1.145 stunned him). Creatures take a directional impact, often a long one.
      let reaction = ACTION_IMPACT;
      if (target.kind === 'player') {
        const roll = originalFlinch(damage, hpBefore, this.random());
        reaction = roll === 'knockdown' ? ACTION_KNOCKDOWN : roll === 'stun' ? ACTION_STUN : ACTION_IMPACT;
      } else reaction = this.creatureImpact(target, attacker);
      impact = IMPACT_VARIANTS[reaction]?.state;
      // A knock-down is not cut short by another hit's lighter reaction.
      if (!(isHitAction(target.character.rollDir) && target.character.rollDir === ACTION_KNOCKDOWN && target.hitUntil > this.tick)) this.hitReaction(target, reaction);
    }
    let reward: CombatEventMsg['d']['reward'];

    if (target.kind === 'mob') {
      target.threat.set(attacker.entityId, (target.threat.get(attacker.entityId) ?? 0) + damage);
      // Unarmed peaceful creatures (citizens) take the blows; armed ones (guards) fight back.
      const fightsBack = !target.archetype.passive || target.weapon.id !== UNARMED.id;
      if (target.state !== 'chase' && fightsBack) target.state = 'chase';
    } else {
      target.statsDirty = true;
    }

    if (attacker.kind === 'player' && damage > 0) this.witnessAssault(attacker.character.position);

    if (killed) {
      target.swing = null;
      // The death clip carries the body itself (client side); no timed action keeps moving it.
      startTimedAction(target.character, 0);
      if (target.kind === 'player') target.cast = null;
      if (target.kind === 'mob') {
        target.deadUntil = this.tick + target.archetype.respawnTicks;
        target.threat.clear();
        if (attacker.kind === 'player') reward = this.grantReward(attacker, target.archetype);
      } else {
        target.deadUntil = this.tick + PLAYER_RESPAWN_TICKS;
        target.pendingEquip = null;
        target.queuedAttack = false;
      }
    }

    this.broadcastNear(target, {
      op: SC.COMBAT_EVENT,
      d: { attacker: attacker.entityId, target: target.entityId, damage, hp: Math.ceil(target.hp), killed, ...(impact ? { impact } : {}), ...(reward ? { reward } : {}) },
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
      p.moveStats = { ...p.moveStats, clipRate: originalSpeedMultiplier(p.attributes, level) };
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
      this.calmDown(a);
      a.yaw = a.spawnYaw;
      setCharacterState(a.character, a.spawn, 0, false);
    } else {
      setCharacterState(a.character, this.nextSpawnPoint(), 0, false);
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
        speed: p.moveStats.clipRate ?? 1,
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
          ...(other.kind === 'mob' ? { archetype: other.archetype.id, ...(other.placement !== undefined ? { placement: other.placement } : {}) } : {}),
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

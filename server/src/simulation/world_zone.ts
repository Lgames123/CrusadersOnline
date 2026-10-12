import {
  ANIM,
  BUILTIN_ITEMS,
  PORTAL_HEIGHT,
  PORTAL_RADIUS,
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
  movementFacingOffset,
  attackAnim,
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
  decodeInput,
  dequantizeAngle,
  encodeSnapshot,
  inMeleeArc,
  forwardXZ,
  damageVector,
  levelForXp,
  originalDamageMultiplier,
  originalDamageTaken,
  originalFlinch,
  originalWeaponHit,
  playerMaxHp,
  playerRules,
  attackTiming,
  clipSwingTiming,
  pickMobAttack,
  nextMobAttack,
  MOB_COMBAT_RANGE,
  MOB_HOP_RANGE,
  MOB_HOP_TICKS,
  MOB_HOP_NO_SWING_CHANCE,
  MOB_CHAIN_WEIGHTS,
  MOB_SHIELD_CHANCE,
  MOB_SHIELD_TICKS,
  MOB_STANCE_TICKS,
  MOB_JUMP_ATTACK,
  MOB_BASH,
  MOB_BASH_CHANCE,
  MOB_BASH_RANGE,
  ACTION_IMPACT,
  ACTION_KNOCKDOWN,
  ACTION_STUN,
  hitReactionTicks,
  isHitAction,
  startHitReaction,
  startTimedAction,
  ACTION_ATTACK,
  ACTION_BASH,
  ACTION_LUNGE,
  MOB_JUMP_ATTACK_CHANCE,
  MOB_SWING_RANGE,
  MOB_RETREAT_CHANCE,
  MOB_RETREAT_RANGE,
  MOB_RETREAT_TICKS,
  MOB_THRUST,
  MOB_THRUST_RANGE,
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
  /** A player walked into a portal trigger leading to `target` (once per entry). */
  portal?(connId: number, target: string): void;
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
  /** Arriving through a portal from this arena: placed at the portal leading back there. */
  arrivingFrom?: string;
}

/** Player state carried across a zone transfer (everything but the position). */
export type TransferState = Omit<JoinOptions, 'position' | 'arrivingFrom'>;

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
  /** Full inventory, present only when it changed since the previous record. */
  inventory?: InventoryEntry[];
  /** Arena the character is in (characters.zone_id). */
  zone?: string;
  /** Forget the saved position (zone transfer: spawn at the destination's arrival point). */
  resetPosition?: boolean;
}

export interface WorldZoneOptions {
  /** Random source in [0, 1); injectable for deterministic tests. */
  random?: () => number;
  /** Selects the default.ctx attribute and resist columns (default: medium). */
  difficulty?: Difficulty;
  /** Item definitions (default: the built-in catalog). */
  items?: ItemCatalog;
  /**
   * Optional feature (not original, default off): shielded creatures may raise the shield in
   * reaction to a player's swing (archetype blockChance / blockTicks / blockCooldown).
   */
  reactiveBlock?: boolean;
}


/** World objects (original levels): interaction reach and respawn delays (slice values). */
const INTERACT_RANGE = 2.5;
const INTERACT_HEIGHT = 2;
/** Mobs only notice players within this height difference (slice value). */
const AGGRO_HEIGHT = 3;
const OBJECT_RESPAWN_TICKS = 20 * 300; // 5 min, so a persistent world refills
const BREAKABLE_RADIUS = 0.5;
/** Hit-set key offset so swings can record breakables next to entity ids. */
const OBJECT_HIT_KEY = 1_000_000;

interface WorldObject {
  def: WorldObjectDef;
  state: WorldObjectState;
  hp: number;
  respawnAt: number;
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
}

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
  state: 'idle' | 'chase' | 'return';
  threat: Map<number, number>;
  nextSwingTick: number;
  /** Ticks of a forward hop still to run before the swing it leads into. */
  hopTicks: number;
  /** Swings left in the current attack chain. */
  chainLeft: number;
  /** Combat stance after an action until this tick (no new action before it). */
  guardUntil: number;
  /** Shield raised from this tick until the end of the stance (blocks frontal hits). */
  shieldFrom: number;
  /** Stepping back in guard (until 8 ft away, at most until this tick). */
  retreatUntil: number;
  input: InputFrame;
  stats: MovementStats;
}

type Actor = Player | Mob;

const alive = (a: Actor) => a.deadUntil === 0;
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

  constructor(rapier: Rapier, name: string, arena: ArenaDef, outbox: ZoneOutbox, opts: WorldZoneOptions = {}) {
    this.name = name;
    this.arena = arena;
    this.outbox = outbox;
    this.random = opts.random ?? Math.random;
    this.difficulty = opts.difficulty ?? 'medium';
    this.reactiveBlock = opts.reactiveBlock ?? false;
    this.items = opts.items ?? BUILTIN_ITEMS;
    this.mw = createMovementWorld(rapier, arena);
    for (const s of arena.mobSpawns) this.spawnMob(s.archetype, s);
    for (const def of arena.objects ?? []) this.objects.set(def.id, { def, state: 'present', hp: def.hp ?? 0, respawnAt: 0 });
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
    const weapon = this.items.get(archetype.weapon);
    if (!weapon) throw new Error(`unknown weapon ${archetype.weapon} for ${archetypeId}`);
    const mob: Mob = {
      kind: 'mob',
      entityId: this.nextEntityId++,
      name: archetype.name,
      character: createCharacter(this.mw, at),
      yaw: 0,
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
      state: 'idle',
      threat: new Map(),
      nextSwingTick: 0,
      hopTicks: 0,
      chainLeft: 0,
      guardUntil: 0,
      shieldFrom: 0,
      retreatUntil: 0,
      input: createInputFrame(),
      // Creatures share the humanoid rig's root-motion speeds (run, walk); no jumping.
      stats: { ...DEFAULT_MOVEMENT_STATS, jumpVelocity: 0 },
    };
    this.register(mob);
  }

  join(connId: number, opts: JoinOptions): number {
    if (this.players.has(connId)) throw new Error(`connection ${connId} already in zone`);
    const spawn = opts.arrivingFrom
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
    const p: Player = {
      kind: 'player',
      connId,
      entityId: this.nextEntityId++,
      characterId: opts.characterId,
      name: opts.name,
      character: createCharacter(this.mw, spawn),
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
    };
    this.players.set(connId, p);
    this.register(p);
    for (const portal of this.arena.portals ?? []) {
      if (Math.hypot(portal.x - spawn.x, portal.z - spawn.z) <= PORTAL_RADIUS + 0.5 && Math.abs(portal.y - spawn.y) <= PORTAL_HEIGHT) p.inPortal.add(portal.id);
    }
    this.sendJson(connId, {
      op: SC.WORLD_ENTER,
      d: { entityId: p.entityId, zone: this.name, arena: this.arena.name, serverTick: this.tick, spawn: { ...p.character.position } },
    });
    this.sendStats(p);
    this.sendInventory(p);
    if (this.objects.size) {
      const changed = [...this.objects.values()].filter((o) => o.state !== 'present').map((o) => ({ id: o.def.id, state: o.state }));
      this.sendJson(connId, { op: SC.OBJECT_STATE, d: { objects: changed, full: true } });
    }
    return p.entityId;
  }

  /** Picks up a ground item or opens a chest (CS_INTERACT): within reach, still there, alive. */
  interact(connId: number, id: number): void {
    const p = this.players.get(connId);
    const o = this.objects.get(id);
    if (!p || !o || !alive(p) || o.state !== 'present' || o.def.kind === 'breakable') return;
    const pos = p.character.position;
    if (Math.hypot(o.def.x - pos.x, o.def.z - pos.z) > INTERACT_RANGE || Math.abs(o.def.y - pos.y) > INTERACT_HEIGHT) return;
    const grants = o.def.kind === 'item' ? (o.def.item ? [o.def.item] : []) : (o.def.contents ?? []);
    const loot: string[] = [];
    for (const g of grants) if (this.grantItem(p, g.name, g.quantity)) loot.push(g.quantity > 1 ? `${g.quantity} ${g.name}` : g.name);
    if (o.def.kind === 'item' && grants.length && !loot.length) return; // bag full: leave it
    o.state = o.def.kind === 'chest' ? 'open' : 'gone';
    o.respawnAt = this.tick + OBJECT_RESPAWN_TICKS;
    this.broadcastObjects([{ id, state: o.state, by: p.entityId, loot }]);
    const record = this.persistRecord(p);
    if (record) this.outbox.persist?.([record], 'progress');
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
      }
      this.broadcastObjects([{ id: o.def.id, state: o.state, by: a.entityId, damage, hp: Math.ceil(o.hp) }]);
    }
  }

  private respawnObjects(): void {
    const back: ObjectChange[] = [];
    for (const o of this.objects.values()) {
      if (o.state === 'present' || this.tick < o.respawnAt) continue;
      o.state = 'present';
      o.hp = o.def.hp ?? 0;
      o.respawnAt = 0;
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
      zone: this.arena.name,
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
    };
    const record = this.leave(connId);
    return { record, state };
  }

  private checkPortals(p: Player): void {
    const portals = this.arena.portals;
    if (!portals?.length || !alive(p)) return;
    const pos = p.character.position;
    for (const portal of portals) {
      const inside = Math.hypot(portal.x - pos.x, portal.z - pos.z) <= PORTAL_RADIUS && Math.abs(portal.y - pos.y) <= PORTAL_HEIGHT;
      if (!inside) {
        p.inPortal.delete(portal.id);
      } else if (!p.inPortal.has(portal.id)) {
        p.inPortal.add(portal.id);
        this.outbox.portal?.(p.connId, portal.target);
      }
    }
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
    if (!p || !alive(p) || p.hitUntil > this.tick) return;
    p.blocking = false; // swinging lowers the shield until the next input re-raises it
    if (p.swing) {
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
    p.swing = { combo, kind, start: this.tick, timing: attackTiming(kind, combo, p.weapon.speed ?? 1), hit: new Set() };
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
        if (!alive(p)) this.frame.flags = 0;
        stepCharacter(this.mw, p.character, this.frame, DEFAULT_MOVEMENT_STATS, TICK_DT);
        p.lastProcessedInput = this.frame.clientTick;
        if (alive(p)) p.yaw = this.frame.yaw;
        this.checkPortals(p);
        const moving = (this.frame.flags & MOVE_MASK) !== 0 && !(this.frame.flags & INPUT.ROOTED);
        p.blocking = alive(p) && p.shield !== null && (this.frame.flags & INPUT.BLOCK) !== 0 && !p.swing && p.hitUntil <= tick;
        // On diagonals the body turns into the motion, except with the shield up (it faces the view).
        p.facingOffset = moving && !(this.frame.flags & INPUT.BLOCK) ? movementFacingOffset(this.frame.flags) : 0;
        // Hit reactions are timed movement actions, so movementAnim() covers them too.
        p.anim = movementAnim(p.blocking ? this.frame.flags : this.frame.flags & ~INPUT.BLOCK, p.character.grounded, p.character.rollDir);
      }
    }

    // 2. Mobs think and move.
    for (const a of this.actors.values()) if (a.kind === 'mob' && alive(a)) this.updateMob(a);

    // 3. Swings: hit windows, recovery, combo buffering.
    for (const a of this.actors.values()) if (a.swing && alive(a)) this.updateSwing(a);

    // 4. Deaths and respawns (actors and world objects).
    if (this.objects.size && tick % 20 === 0) this.respawnObjects();
    for (const a of this.actors.values()) {
      if (a.deadUntil !== 0 && tick >= a.deadUntil) this.respawn(a);
    }

    // 5. Replicated state.
    for (const a of this.actors.values()) {
      const pos = a.character.position;
      this.grid.update(a.entityId, pos.x, pos.z);
      const s = this.states.get(a.entityId)!;
      s.x = quantizePosition(pos.x);
      s.y = quantizePosition(pos.y);
      s.z = quantizePosition(pos.z);
      s.yaw = a.kind === 'player' && a.facingOffset ? quantizeAngle(dequantizeAngle(a.yaw) + a.facingOffset) : a.yaw;
      s.anim = !alive(a) ? ANIM.DEAD : a.swing ? attackAnim(a.swing.kind, a.swing.combo) : a.anim;
      s.animPhase = a.swing ? Math.min(255, tick - a.swing.start) : 0;
      s.hp = Math.ceil(a.hp);
      // Shield layer (upper body): a player holding block, a creature in guard or blocking.
      const shieldUp = a.kind === 'player'
        ? a.blocking
        : a.shield !== null && !a.swing && (a.blockUntil > tick || (a.shieldFrom <= tick && a.guardUntil > tick));
      s.flags = alive(a) && shieldUp ? 1 : 0;
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

    if (m.state === 'idle') {
      let best: Player | null = null;
      let bestDist = arch.aggroRadius;
      for (const p of this.players.values()) {
        if (!alive(p)) continue;
        // Same floor only: original levels stack rooms, and a mob must not sense a player through
        // the ceiling.
        if (Math.abs(p.character.position.y - pos.y) > AGGRO_HEIGHT) continue;
        const d = Math.hypot(p.character.position.x - pos.x, p.character.position.z - pos.z);
        if (d <= bestDist) {
          best = p;
          bestDist = d;
        }
      }
      if (best) {
        m.threat.set(best.entityId, (m.threat.get(best.entityId) ?? 0) + 1);
        m.state = 'chase';
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
      } else if (m.hitUntil > this.tick) {
        // Hit reaction (directional impact): no action until it ends.
      } else if (m.blockUntil > this.tick) {
        // Shield up: hold position facing the target.
        const t = target.character.position;
        m.yaw = quantizeAngle(yawTowards(pos.x, pos.z, t.x, t.z));
      } else if (m.hopTicks > 0) {
        // Lunge: the forward hop carries the creature in; when it ends the creature swings,
        // or (about one hop in four) just stands in its combat stance.
        if (--m.hopTicks === 0) {
          if (this.random() >= 1 - MOB_HOP_NO_SWING_CHANCE) this.enterStance(m);
          else this.startMobSwing(m, pickMobAttack(this.random()), this.chainLength());
        }
      } else if (!m.swing) {
        // Decisions as logged from the original's skeleton AI (executable-analysis §15.2).
        const t = target.character.position;
        const dist = Math.hypot(t.x - pos.x, t.z - pos.z);
        m.yaw = quantizeAngle(yawTowards(pos.x, pos.z, t.x, t.z));
        const ready = this.tick >= m.nextSwingTick && this.tick >= m.guardUntil;
        // Rolls are written as 1 - chance so a zero random source (deterministic tests) takes the plain path.
        if (m.retreatUntil > this.tick) {
          // Stepping back in combat stance until 8 ft away, then a stance before coming in.
          if (dist >= MOB_RETREAT_RANGE) {
            m.retreatUntil = 0;
            this.enterStance(m);
          } else m.input.flags = INPUT.BACK | INPUT.WALK;
        } else if (!ready) {
          // Combat stance: shield ready, facing the target; close in slowly if it backs off.
          if (dist > MOB_HOP_RANGE) m.input.flags = INPUT.FORWARD | INPUT.WALK;
        } else if (dist < MOB_RETREAT_RANGE && this.random() >= 1 - MOB_RETREAT_CHANCE) {
          m.retreatUntil = this.tick + MOB_RETREAT_TICKS;
          m.input.flags = INPUT.BACK | INPUT.WALK;
        } else if (dist <= MOB_BASH_RANGE && m.shield !== null && this.random() >= 1 - MOB_BASH_CHANCE) {
          this.startMobSwing(m, MOB_BASH, 1); // the rare shield bash: stuns without damage
        } else if (dist <= MOB_THRUST_RANGE) {
          this.startMobSwing(m, MOB_THRUST, 1); // the close-range jab, one per stance
        } else if (dist <= MOB_HOP_RANGE && this.random() >= 1 - MOB_JUMP_ATTACK_CHANCE) {
          this.startMobSwing(m, MOB_JUMP_ATTACK, 1); // the leaping strike
        } else if (dist <= MOB_SWING_RANGE) {
          this.startMobSwing(m, pickMobAttack(this.random()), this.chainLength()); // swings straight from the stance
        } else if (dist <= MOB_HOP_RANGE) {
          {
            m.hopTicks = MOB_HOP_TICKS;
            startTimedAction(m.character, ACTION_LUNGE); // PC07's root motion, then still
          }
        } else if (dist > MOB_COMBAT_RANGE) {
          m.input.flags = INPUT.FORWARD; // run in
        } else {
          m.input.flags = INPUT.FORWARD | INPUT.WALK; // walk in, in combat stance
        }
      }
    }

    if (m.state === 'return') {
      const dist = Math.hypot(m.spawn.x - pos.x, m.spawn.z - pos.z);
      if (dist < 0.5) {
        m.state = 'idle';
        m.hp = m.maxHp;
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
      ? ANIM.HIT
      : m.blockUntil > this.tick
      ? ANIM.BLOCK
      : m.hopTicks > 0
      ? ANIM.HOP_FORWARD
      : m.retreatUntil > this.tick && m.input.flags & INPUT.BACK
      ? ANIM.RETREAT
      : m.input.flags & MOVE_MASK ? (m.input.flags & INPUT.WALK ? ANIM.WALK : ANIM.RUN) : ANIM.IDLE;
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

  /** Length of a new attack chain: 1 (74 %) or 2 swings (original rhythm). */
  private chainLength(): number {
    return this.random() < MOB_CHAIN_WEIGHTS[0] ? 1 : 2;
  }

  /** Starts a creature swing (one of its ASM attacks, timed by that clip's events). */
  private startMobSwing(m: Mob, atk: { kind: AttackKind; clip: Parameters<typeof clipSwingTiming>[0] }, chain: number): void {
    m.chainLeft = chain;
    m.swing = { combo: 1, kind: atk.kind, start: this.tick, timing: clipSwingTiming(atk.clip), hit: new Set() };
    // The leaping strike (PN05) and the shield bash (PL01) carry the creature by their root motion.
    if (atk.kind === 'jump') startTimedAction(m.character, ACTION_ATTACK + 3);
    else if (atk.kind === 'bash') startTimedAction(m.character, ACTION_BASH);
  }

  /**
   * End of a creature swing: the chain's next swing (always the next one in the cycle
   * low -> level -> overhead), or the combat stance for 0.52-1.8 s.
   */
  private endMobSwing(m: Mob, kind: AttackKind): void {
    m.nextSwingTick = this.tick + m.archetype.cooldown;
    if (--m.chainLeft > 0 && (kind === 'low' || kind === 'normal' || kind === 'overhead')) {
      const target = [...m.threat.keys()].map((id) => this.actors.get(id)).find((a) => a !== undefined && alive(a)) ?? null;
      const tp = target?.character.position;
      const pos = m.character.position;
      if (target && tp && Math.hypot(tp.x - pos.x, tp.z - pos.z) <= m.archetype.reach * 1.2) {
        this.startMobSwing(m, nextMobAttack(kind), m.chainLeft);
        return;
      }
    }
    m.chainLeft = 0;
    this.enterStance(m);
  }

  /** Combat stance: 0.5 s, then in about half the stances the shield goes up for 0.82 s. */
  private enterStance(m: Mob): void {
    const stand = this.tick + MOB_STANCE_TICKS;
    // 1 - chance: a zero random source (deterministic tests) keeps the shield down.
    const shield = m.shield !== null && this.random() >= 1 - MOB_SHIELD_CHANCE;
    m.shieldFrom = shield ? stand : Number.MAX_SAFE_INTEGER;
    m.guardUntil = shield ? stand + MOB_SHIELD_TICKS : stand;
  }

  private updateSwing(a: Actor): void {
    const s = a.swing!;
    const elapsed = this.tick - s.start;
    const t = s.timing;
    if (elapsed >= t.startup && elapsed < t.startup + t.active) {
      const pos = a.character.position;
      const yaw = dequantizeAngle(a.yaw);
      const reach = a.kind === 'player' ? PLAYER_REACH : a.archetype.reach;
      const arc = a.kind === 'player' ? PLAYER_ARC_DEG : a.archetype.arcDeg;
      for (const target of this.actors.values()) {
        if (target === a || target.kind === a.kind || !alive(target) || s.hit.has(target.entityId)) continue;
        const tp = target.character.position;
        if (!inMeleeArc(pos.x, pos.z, yaw, tp.x, tp.z, reach, arc, PLAYER_RADIUS)) continue;
        s.hit.add(target.entityId);
        if (this.blocks(target, a)) {
          // A creature's stopped hit plays its quick block (PE07: 20 frames at 1000/30 fps).
          if (target.kind === 'mob') target.blockUntil = Math.max(target.blockUntil, this.tick + MOB_BLOCK_ANIM_TICKS);
          this.broadcastNear(target, {
            op: SC.COMBAT_EVENT,
            d: { attacker: a.entityId, target: target.entityId, damage: 0, hp: Math.ceil(target.hp), killed: false, blocked: true },
          });
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
        if (!alive(a)) return;
      }
      if (a.kind === 'player' && this.objects.size) this.hitBreakables(a, s, pos, yaw);
    }
    if (elapsed >= t.startup + t.active + t.recovery) {
      a.swing = null;
      a.lastSwingEnd = this.tick;
      a.lastCombo = s.kind === 'normal' ? s.combo : 0;
      if (a.kind === 'mob') this.endMobSwing(a, s.kind);
      else {
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
      : p.shield !== null && !p.swing && (p.blockUntil > this.tick || (p.shieldFrom <= this.tick && p.guardUntil > this.tick));
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

  /** Starts a hit reaction: the current swing / hop / retreat is interrupted. */
  private hitReaction(target: Actor, action: number): void {
    target.swing = null;
    target.hitUntil = this.tick + hitReactionTicks(action);
    startHitReaction(target.character, action);
    if (target.kind === 'player') {
      target.queuedAttack = false;
    } else {
      target.hopTicks = 0;
      target.chainLeft = 0;
      target.retreatUntil = 0;
      target.guardUntil = target.hitUntil;
      target.shieldFrom = Number.MAX_SAFE_INTEGER;
    }
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
    target.hp = Math.max(0, target.hp - damage);
    const killed = target.hp <= 0;
    if (killed) target.hp = 0;
    if (!killed && hpBefore > 0 && damage > 0 && target.character.grounded) {
      // Every landed hit interrupts with an impact (the original skips airborne targets). The
      // player rolls for a stun or a knock-down (confirmed live: v = 0.771 knocked Drake down,
      // 0.845 and 1.145 stunned him). Creatures only take the directional impact.
      let reaction = ACTION_IMPACT;
      if (target.kind === 'player') {
        const roll = originalFlinch(damage, hpBefore, this.random());
        reaction = roll === 'knockdown' ? ACTION_KNOCKDOWN : roll === 'stun' ? ACTION_STUN : ACTION_IMPACT;
      }
      // A knock-down is not cut short by another hit's lighter reaction.
      if (!(isHitAction(target.character.rollDir) && target.character.rollDir === ACTION_KNOCKDOWN && target.hitUntil > this.tick)) this.hitReaction(target, reaction);
    }
    let reward: CombatEventMsg['d']['reward'];

    if (target.kind === 'mob') {
      target.threat.set(attacker.entityId, (target.threat.get(attacker.entityId) ?? 0) + damage);
      if (target.state !== 'chase') target.state = 'chase';
    } else {
      target.statsDirty = true;
    }

    if (killed) {
      target.swing = null;
      // The death clip carries the body itself (client side); no timed action keeps moving it.
      startTimedAction(target.character, 0);
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
      d: { attacker: attacker.entityId, target: target.entityId, damage, hp: Math.ceil(target.hp), killed, ...(reward ? { reward } : {}) },
    });
  }

  private grantReward(p: Player, arch: MobArchetype): { xp: number; gold: number; loot?: string[] } {
    const gold = arch.goldMin + Math.floor(this.random() * (arch.goldMax - arch.goldMin + 1));
    p.xp += arch.xpReward;
    p.gold += gold;
    const level = levelForXp(p.xp);
    if (level > p.level) {
      // Engine Stats_LevelUp: derived stats are recomputed and the max-HP gain is added to HP.
      const before = p.maxHp;
      p.level = level;
      p.maxHp = playerMaxHp(p.attributes, level);
      p.damageMultiplier = originalDamageMultiplier(p.attributes, level);
      p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - before));
    }
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
      d: { hp: Math.ceil(p.hp), maxHp: p.maxHp, level: p.level, xp: p.xp, gold: p.gold, dead: !alive(p) },
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
      current.set(id, { ...this.states.get(id)! });
    }

    for (const id of current.keys()) {
      if (id === p.entityId || p.known.has(id)) continue;
      const other = this.actors.get(id)!;
      const kind: EntityKind = other.kind;
      this.sendJson(p.connId, {
        op: SC.ENTITY_SPAWN,
        d: { id, kind, name: other.name, maxHp: other.maxHp, ...(other.kind === 'mob' ? { archetype: other.archetype.id } : {}) },
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
  inspect(): { id: number; kind: Actor['kind']; hp: number; alive: boolean; state?: Mob['state']; swinging: boolean; anim: number; shield: boolean; x: number; z: number }[] {
    return [...this.actors.values()].map((a) => ({
      id: a.entityId,
      kind: a.kind,
      hp: a.hp,
      alive: alive(a),
      ...(a.kind === 'mob' ? { state: a.state } : {}),
      swinging: !!a.swing,
      anim: this.states.get(a.entityId)?.anim ?? 0,
      shield: ((this.states.get(a.entityId)?.flags ?? 0) & 1) !== 0,
      x: a.character.position.x,
      z: a.character.position.z,
    }));
  }

  stats(connId: number): { dropped: number; malformed: number; queued: number } | undefined {
    const p = this.players.get(connId);
    return p && { dropped: p.queue.dropped, malformed: p.malformed, queued: p.queue.length };
  }
}

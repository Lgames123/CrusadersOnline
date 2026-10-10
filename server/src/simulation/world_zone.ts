import {
  ANIM,
  BUILTIN_ITEMS,
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
  INPUT,
  INTEREST_RADIUS,
  MAX_INPUT_FRAMES,
  MOB_ARCHETYPES,
  PLAYER_ARC_DEG,
  ORIGINAL_BLOCK_COS,
  PLAYER_RADIUS,
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
  swingForWeaponSpeed,
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
}

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
}

export interface WorldZoneOptions {
  /** Random source in [0, 1); injectable for deterministic tests. */
  random?: () => number;
  /** Selects the default.ctx attribute and resist columns (default: medium). */
  difficulty?: Difficulty;
  /** Item definitions (default: the built-in catalog). */
  items?: ItemCatalog;
}

/** Ticks a light flinch / heavy stagger interrupts the player (slice value). */
const FLINCH_TICKS = 6;
const STAGGER_TICKS = 14;

/** Saved positions outside these bounds are discarded (fell out of the world, corrupt data). */
const MIN_VALID_Y = -50;
const MAX_VALID_COORD = 10_000;

function validPosition(p: JoinOptions['position']): p is { x: number; y: number; z: number } {
  return !!p && [p.x, p.y, p.z].every(Number.isFinite) && p.y > MIN_VALID_Y &&
    Math.abs(p.x) < MAX_VALID_COORD && Math.abs(p.z) < MAX_VALID_COORD;
}

interface Swing {
  combo: number;
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
  swingTiming: SwingTiming;
  /** Tick until which a flinch/stagger keeps the player from acting; 0 = none. */
  hitUntil: number;
  shield: ItemDef | null;
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
  input: InputFrame;
  stats: MovementStats;
}

type Actor = Player | Mob;

const alive = (a: Actor) => a.deadUntil === 0;

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

  constructor(rapier: Rapier, name: string, arena: ArenaDef, outbox: ZoneOutbox, opts: WorldZoneOptions = {}) {
    this.name = name;
    this.arena = arena;
    this.outbox = outbox;
    this.random = opts.random ?? Math.random;
    this.difficulty = opts.difficulty ?? 'medium';
    this.items = opts.items ?? BUILTIN_ITEMS;
    this.mw = createMovementWorld(rapier, arena);
    for (const s of arena.mobSpawns) this.spawnMob(s.archetype, s);
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

  private spawnMob(archetypeId: string, at: { x: number; y: number; z: number }): void {
    const archetype = MOB_ARCHETYPES[archetypeId];
    if (!archetype) throw new Error(`unknown mob archetype ${archetypeId}`);
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
      archetype,
      weapon,
      shield: archetype.shield ? this.items.get(archetype.shield) ?? null : null,
      blockUntil: 0,
      nextBlockTick: 0,
      spawn: { ...at },
      state: 'idle',
      threat: new Map(),
      nextSwingTick: 0,
      input: createInputFrame(),
      stats: { walkSpeed: archetype.speed, runSpeed: archetype.speed, jumpVelocity: 0 },
    };
    this.register(mob);
  }

  join(connId: number, opts: JoinOptions): number {
    if (this.players.has(connId)) throw new Error(`connection ${connId} already in zone`);
    const spawn = validPosition(opts.position) ? opts.position : this.nextSpawnPoint();
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
      statsDirty: true,
      attributes: rules.attributes,
      resist: rules.resist,
      inventory,
      inventoryDirty: saved.length === 0,
      pendingEquip: null,
      weapon: eq.weapon,
      armor: eq.armor,
      damageMultiplier: originalDamageMultiplier(rules.attributes, level),
      swingTiming: swingForWeaponSpeed(eq.weapon.speed ?? 1),
      hitUntil: 0,
      shield: eq.shield,
      blocking: false,
    };
    this.players.set(connId, p);
    this.register(p);
    this.sendJson(connId, {
      op: SC.WORLD_ENTER,
      d: { entityId: p.entityId, zone: this.name, arena: this.arena.name, serverTick: this.tick, spawn: { ...p.character.position } },
    });
    this.sendStats(p);
    this.sendInventory(p);
    return p.entityId;
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
    p.swingTiming = swingForWeaponSpeed(eq.weapon.speed ?? 1);
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
  attack(connId: number): void {
    const p = this.players.get(connId);
    if (!p || !alive(p) || p.hitUntil > this.tick) return;
    p.blocking = false; // swinging lowers the shield until the next input re-raises it
    if (p.swing) {
      const t = p.swing.timing;
      if (this.tick - p.swing.start >= t.startup + t.active) p.queuedAttack = true;
      return;
    }
    this.startPlayerSwing(p);
  }

  private startPlayerSwing(p: Player): void {
    const chained = this.tick - p.lastSwingEnd <= COMBO_WINDOW_TICKS && p.lastCombo < COMBO_MULTIPLIERS.length;
    const combo = chained ? p.lastCombo + 1 : 1;
    p.swing = { combo, start: this.tick, timing: p.swingTiming, hit: new Set() };
    p.queuedAttack = false;
    this.mobsReactToSwing(p);
  }

  /** Shielded mobs in front of a player who starts a swing may raise their shield (AI block). */
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
        // Movement stays free during swings (client prediction cannot know the exact server
        // tick a swing starts on); the dead do not act. The client mirrors the dead rule.
        if (!alive(p)) this.frame.flags = 0;
        stepCharacter(this.mw, p.character, this.frame, DEFAULT_MOVEMENT_STATS, TICK_DT);
        p.lastProcessedInput = this.frame.clientTick;
        if (alive(p)) p.yaw = this.frame.yaw;
        const moving = (this.frame.flags & MOVE_MASK) !== 0;
        p.blocking = alive(p) && p.shield !== null && (this.frame.flags & INPUT.BLOCK) !== 0 && !p.swing && p.hitUntil <= tick;
        p.anim = p.hitUntil > tick
          ? ANIM.HIT
          : p.blocking
          ? ANIM.BLOCK
          : !p.character.grounded
          ? ANIM.AIRBORNE
          : moving ? (this.frame.flags & INPUT.WALK ? ANIM.WALK : ANIM.RUN) : ANIM.IDLE;
      }
    }

    // 2. Mobs think and move.
    for (const a of this.actors.values()) if (a.kind === 'mob' && alive(a)) this.updateMob(a);

    // 3. Swings: hit windows, recovery, combo buffering.
    for (const a of this.actors.values()) if (a.swing && alive(a)) this.updateSwing(a);

    // 4. Deaths and respawns.
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
      s.yaw = a.yaw;
      s.anim = !alive(a) ? ANIM.DEAD : a.swing ? ANIM.ATTACK + a.swing.combo - 1 : a.anim;
      s.animPhase = a.swing ? Math.min(255, tick - a.swing.start) : 0;
      s.hp = Math.ceil(a.hp);
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
      } else if (m.blockUntil > this.tick) {
        // Shield up: hold position facing the target.
        const t = target.character.position;
        m.yaw = quantizeAngle(yawTowards(pos.x, pos.z, t.x, t.z));
      } else if (!m.swing) {
        const t = target.character.position;
        const dist = Math.hypot(t.x - pos.x, t.z - pos.z);
        m.yaw = quantizeAngle(yawTowards(pos.x, pos.z, t.x, t.z));
        if (dist > arch.reach * 0.85) {
          m.input.flags = INPUT.FORWARD;
        } else if (this.tick >= m.nextSwingTick) {
          m.swing = { combo: 1, start: this.tick, timing: arch.swing, hit: new Set() };
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
    stepCharacter(this.mw, m.character, m.input, m.stats, TICK_DT);
    m.anim = m.blockUntil > this.tick ? ANIM.BLOCK : m.input.flags & MOVE_MASK ? ANIM.RUN : ANIM.IDLE;
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
          this.broadcastNear(target, {
            op: SC.COMBAT_EVENT,
            d: { attacker: a.entityId, target: target.entityId, damage: 0, hp: Math.ceil(target.hp), killed: false, blocked: true },
          });
          continue;
        }
        this.applyDamage(a, target, this.rollDamage(a, s.combo));
        if (!alive(a)) return;
      }
    }
    if (elapsed >= t.startup + t.active + t.recovery) {
      a.swing = null;
      a.lastSwingEnd = this.tick;
      a.lastCombo = s.combo;
      if (a.kind === 'mob') a.nextSwingTick = this.tick + a.archetype.cooldown;
      else {
        if (a.pendingEquip) {
          const { slot, equip } = a.pendingEquip;
          a.pendingEquip = null;
          this.applyEquipRequest(a, slot, equip);
        }
        if (a.queuedAttack) this.startPlayerSwing(a);
      }
    }
  }

  /**
   * Engine Stats_TryBlockWithShield: a raised shield stops the hit when the attacker lies inside
   * the frontal cone dot(facing, toAttacker) > cos(30) — 30 radians in the original, ≈ ±81°.
   */
  private blocks(p: Actor, attacker: Actor): boolean {
    const raised = p.kind === 'player' ? p.blocking : p.shield !== null && p.blockUntil > this.tick;
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
    if (!killed && target.kind === 'player' && hpBefore > 0) {
      const reaction = originalFlinch(damage, hpBefore, this.random());
      if (reaction !== 'none') {
        target.swing = null;
        target.queuedAttack = false;
        target.hitUntil = this.tick + (reaction === 'stagger' ? STAGGER_TICKS : FLINCH_TICKS);
      }
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
  inspect(): { id: number; kind: Actor['kind']; hp: number; alive: boolean; state?: Mob['state']; x: number; z: number }[] {
    return [...this.actors.values()].map((a) => ({
      id: a.entityId,
      kind: a.kind,
      hp: a.hp,
      alive: alive(a),
      ...(a.kind === 'mob' ? { state: a.state } : {}),
      x: a.character.position.x,
      z: a.character.position.z,
    }));
  }

  stats(connId: number): { dropped: number; malformed: number; queued: number } | undefined {
    const p = this.players.get(connId);
    return p && { dropped: p.queue.dropped, malformed: p.malformed, queued: p.queue.length };
  }
}

import { TICK_DT, TICK_MS, DEFAULT_MOVEMENT_STATS, type MovementStats } from '../constants.ts';
import type { SpellId } from '../game/spells.ts';
import { gameplayFeatures, type GameplayFeatures } from '../game/features.ts';
import { dequantizeAngle, dequantizePosition } from '../math/quantize.ts';
import { CS, SC } from '../protocol/opcodes.ts';
import { INPUT_PACKET_MAX_BYTES, MAX_INPUT_FRAMES, createInputFrame, encodeInput, type InputFrame } from '../protocol/binary/input.ts';
import { decodeSnapshot, type EntityState } from '../protocol/binary/snapshot.ts';
import type { AttackKind, CombatEventMsg, CutsceneMsg, EntitySpawnMsg, InventoryUpdateMsg, ObjectStateMsg, PlayerStatsMsg, QuestLogMsg, ServerControlMsg, WorldEnterMsg, WorldObjectState } from '../protocol/control/server.ts';
import type { ArenaDef } from '../arena/types.ts';
import { createMovementWorld, disposeMovementWorld, setDoorOpen, setDoorPose, type MovementWorld, type Rapier } from '../movement/physics.ts';
import { stepDoorMotion, swingPose, type DoorMotion, type DoorSwing } from '../arena/door_swing.ts';
import { createCharacter, setCharacterState, stepCharacter, type Character } from '../movement/character.ts';

const INPUT_HISTORY = 64;
const SNAPSHOT_HISTORY = 32;
/** Remote entities are rendered this many ticks behind the latest snapshot (100 ms). */
export const INTERP_DELAY_TICKS = 2;
const REMOTE_BUFFER = 20;

export interface RemoteSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  /** Ticks since the current swing started (0 when not swinging). */
  animPhase: number;
  hp: number;
  /** Entity flags (bit 0: shield up). */
  flags: number;
}

interface RemoteFrame extends RemoteSample {
  tick: number;
}

export type PlayerStats = PlayerStatsMsg['d'];
export type CombatEvent = CombatEventMsg['d'];
export type EntityInfo = EntitySpawnMsg['d'];
export type Inventory = InventoryUpdateMsg['d'];

export interface ClientSessionEvents {
  spawn?(id: number, name: string, info: EntityInfo): void;
  stats?(stats: PlayerStats): void;
  combat?(event: CombatEvent): void;
  inventory?(inventory: Inventory): void;
  objects?(changes: ObjectStateMsg['d']): void;
  despawn?(id: number): void;
  /**
   * The server moves the player to `arena` (login or portal). Load it, call setArena() with its
   * definition, then zoneReady(). Not called when the session was created with that arena.
   */
  zone?(arena: string): void;
  /** World entry in the current zone (first login and after every zone change). */
  enter?(d: WorldEnterMsg['d']): void;
  /** Local prediction was corrected by (dx, dy, dz) metres. */
  correction?(dx: number, dy: number, dz: number): void;
  close?(code: number, reason: string): void;
  /** A refusal from the server worth telling the player (e.g. the bag is full). */
  error?(code: string, message: string): void;
  /** A scripted sequence starts for this player: play it, then call cutsceneDone(). */
  cutscene?(d: CutsceneMsg['d']): void;
  /** The quest book (on entry and after every change). */
  quests?(d: QuestLogMsg['d']): void;
}

export interface ClientSessionStats {
  snapshots: number;
  corrections: number;
  lastCorrection: number;
  rttMs: number;
  bytesIn: number;
  bytesOut: number;
}

/**
 * Network client: authenticates, predicts the local player with the shared controller,
 * reconciles against authoritative snapshots, and buffers remote entities for interpolation.
 * Uses the global WebSocket, so it runs in browsers and in Node (tests, bots).
 */
export class ClientSession {
  mw: MovementWorld;
  /** Arena the session currently simulates. */
  arenaName = '';
  character: Character | null = null;
  entityId = 0;
  accountName = '';
  readonly stats: ClientSessionStats = { snapshots: 0, corrections: 0, lastCorrection: 0, rttMs: 0, bytesIn: 0, bytesOut: 0 };
  readonly names = new Map<number, string>();
  readonly entities = new Map<number, EntityInfo>();
  stats_: PlayerStats | null = null;
  readonly combatLog: CombatEvent[] = [];
  /** Gameplay rules of the server (SC_WORLD_ENTER features; the original's when none are on). */
  features: GameplayFeatures = gameplayFeatures();
  /** Movement stats for prediction (the original's, plus feature diagonalMoves). */
  private moveStats: MovementStats = DEFAULT_MOVEMENT_STATS;
  /** Latest inventory of the local player (null until the first INVENTORY_UPDATE). */
  inventory: Inventory | null = null;
  /** World object states (absent = present). */
  readonly objectStates = new Map<number, WorldObjectState>();
  /** Swinging doors of the arena by object id, with their motion (null = shut). */
  readonly swings = new Map<number, { def: DoorSwing; motion: DoorMotion | null }>();

  private ws: WebSocket | null = null;
  private readonly events: ClientSessionEvents;
  private clientTick = 0;
  private readonly inputs: InputFrame[] = Array.from({ length: INPUT_HISTORY }, createInputFrame);
  private readonly sendBuf = new DataView(new ArrayBuffer(INPUT_PACKET_MAX_BYTES));
  private readonly snapshots = new Map<number, Map<number, EntityState>>();
  private latestTick = 0;
  private latestAt = 0;
  private serverTickEstimate = 0;
  private readonly remote = new Map<number, RemoteFrame[]>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;

  private readonly rapier: Rapier;
  /** Arena given at construction: zone changes to it are acknowledged automatically. */
  private readonly autoArena: ArenaDef | null;

  constructor(rapier: Rapier, arena: ArenaDef, events: ClientSessionEvents = {}) {
    this.rapier = rapier;
    this.autoArena = arena;
    this.mw = createMovementWorld(rapier, arena);
    this.arenaName = arena.name;
    this.events = events;
    this.collectSwings(arena);
  }

  private collectSwings(arena: ArenaDef): void {
    this.swings.clear();
    for (const b of arena.brushes ?? []) if (b.door !== undefined && b.swing) this.swings.set(b.door, { def: b.swing, motion: null });
  }

  /** Puts a swinging door's collider at its current turn. */
  private poseDoor(id: number): void {
    const d = this.swings.get(id);
    if (!d) return;
    const pose = d.motion ? swingPose(d.def, d.motion) : { ...d.def.keys[0]!, angle: 0 };
    setDoorPose(this.mw, id, pose.cx, pose.cz, pose.angle);
  }

  /**
   * Switches the simulated arena (zone change): new collision world, and every per-zone state
   * (character, snapshots, remote entities, object states) is reset.
   */
  setArena(arena: ArenaDef): void {
    disposeMovementWorld(this.mw);
    this.mw = createMovementWorld(this.rapier, arena);
    this.arenaName = arena.name;
    this.collectSwings(arena);
    this.character = null;
    this.entityId = 0;
    this.snapshots.clear();
    this.remote.clear();
    this.entities.clear();
    this.names.clear();
    this.objectStates.clear();
    this.latestTick = 0;
    this.stats.snapshots = 0;
  }

  /** Tells the server the arena announced by SC_ZONE_CHANGE is loaded. */
  zoneReady(arena: string): void {
    this.sendJson({ op: CS.ZONE_READY, seq: ++this.seq, d: { arena } });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.character !== null;
  }

  /** Opens the socket, redeems the ticket, selects the first character, resolves on world entry. */
  connect(url: string, ticket: string, timeoutMs = 5000): Promise<WorldEnterMsg['d']> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error('connect timeout'));
        ws.close();
      }, timeoutMs);

      ws.onopen = () => this.sendJson({ op: CS.AUTH_TICKET, seq: this.seq++, d: { ticket } });
      ws.onclose = (e) => {
        clearTimeout(timer);
        if (this.pingTimer) clearInterval(this.pingTimer);
        reject(new Error(`connection closed (${e.code} ${e.reason})`));
        this.events.close?.(e.code, e.reason);
      };
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          this.stats.bytesIn += e.data.length;
          const msg = JSON.parse(e.data) as ServerControlMsg;
          if (msg.op === SC.WORLD_ENTER) {
            clearTimeout(timer);
            resolve(msg.d);
          }
          this.onControl(msg);
        } else {
          const buf = e.data as ArrayBuffer;
          this.stats.bytesIn += buf.byteLength;
          this.onSnapshot(new DataView(buf));
        }
      };
    });
  }

  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000, 'bye');
  }

  private sendJson(msg: object): void {
    const text = JSON.stringify(msg);
    this.stats.bytesOut += text.length;
    this.ws?.send(text);
  }

  private onControl(msg: ServerControlMsg): void {
    switch (msg.op) {
      case SC.AUTH_SUCCESS: {
        this.accountName = msg.d.accountName;
        const c = msg.d.characters[0];
        if (c) this.sendJson({ op: CS.SELECT_CHARACTER, seq: this.seq++, d: { characterId: c.id } });
        break;
      }
      case SC.ZONE_CHANGE:
        if (!this.events.zone && this.autoArena && msg.d.arena === this.autoArena.name) {
          if (this.arenaName !== msg.d.arena || this.character) this.setArena(this.autoArena);
          this.zoneReady(msg.d.arena);
        } else {
          this.events.zone?.(msg.d.arena);
        }
        break;
      case SC.WORLD_ENTER:
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.entityId = msg.d.entityId;
        this.features = gameplayFeatures(msg.d.features ?? {});
        this.moveStats = { ...DEFAULT_MOVEMENT_STATS, diagonalMoves: this.features.diagonalMoves, clipRate: this.moveStats.clipRate };
        this.character = createCharacter(this.mw, msg.d.spawn);
        this.latestTick = this.serverTickEstimate = msg.d.serverTick;
        this.latestAt = performance.now();
        this.pingTimer = setInterval(() => this.sendJson({ op: CS.PING, seq: this.seq++, d: { clientTime: performance.now() } }), 2000);
        this.events.enter?.(msg.d);
        break;
      case SC.ENTITY_SPAWN:
        this.names.set(msg.d.id, msg.d.name);
        this.entities.set(msg.d.id, msg.d);
        this.events.spawn?.(msg.d.id, msg.d.name, msg.d);
        break;
      case SC.ENTITY_DESPAWN:
        this.names.delete(msg.d.id);
        this.entities.delete(msg.d.id);
        this.remote.delete(msg.d.id);
        this.events.despawn?.(msg.d.id);
        break;
      case SC.PONG:
        this.stats.rttMs = performance.now() - msg.d.clientTime;
        break;
      case SC.PLAYER_STATS:
        this.stats_ = msg.d;
        if (msg.d.speed) this.moveStats = { ...this.moveStats, clipRate: msg.d.speed };
        this.events.stats?.(msg.d);
        break;
      case SC.COMBAT_EVENT:
        this.combatLog.push(msg.d);
        if (this.combatLog.length > 100) this.combatLog.shift();
        this.events.combat?.(msg.d);
        break;
      case SC.OBJECT_STATE:
        if (msg.d.full) this.objectStates.clear();
        if (msg.d.full) for (const id of this.mw.doors.keys()) setDoorOpen(this.mw, id, false);
        if (msg.d.full) for (const [id, d] of this.swings) d.motion = null, this.poseDoor(id);
        for (const o of msg.d.objects) {
          this.objectStates.set(o.id, o.state);
          const swing = this.swings.get(o.id);
          if (swing) {
            // Swinging doors keep their collider and turn it (stepped in tick()).
            swing.motion = o.state === 'open' && o.swing ? { ...o.swing } : null;
            this.poseDoor(o.id);
          } else setDoorOpen(this.mw, o.id, o.state !== 'present'); // open doors, broken props
        }
        this.events.objects?.(msg.d);
        break;
      case SC.INVENTORY_UPDATE:
        this.inventory = msg.d;
        this.events.inventory?.(msg.d);
        break;
      case SC.ERROR:
        this.events.error?.(msg.d.code, msg.d.message);
        break;
      case SC.CUTSCENE:
        this.events.cutscene?.(msg.d);
        break;
      case SC.QUEST_LOG:
        this.questLog = msg.d.log;
        this.events.quests?.(msg.d);
        break;
    }
  }

  /** The player's quest book (null until the server sends it). */
  questLog: QuestLogMsg['d']['log'] | null = null;

  /** The scripted sequence `sequence` has been played (or skipped). */
  cutsceneDone(sequence: string): void {
    if (!this.connected) return;
    this.sendJson({ op: CS.CUTSCENE_DONE, seq: ++this.seq, d: { sequence } });
  }

  /** Latest stats of the local player (null until the first PLAYER_STATS). */
  get playerStats(): PlayerStats | null {
    return this.stats_;
  }

  get dead(): boolean {
    return this.stats_?.dead ?? false;
  }

  /** Requests a melee swing. The server decides timing and combo; spam is harmless. */
  attack(kind: AttackKind = 'normal'): void {
    if (!this.connected || this.dead) return;
    this.sendJson({ op: CS.PLAYER_ATTACK, seq: ++this.seq, d: { comboIndex: 1, clientTick: this.clientTick, kind } });
  }

  /** Equips or unequips the item in an inventory slot; the server answers with INVENTORY_UPDATE. */
  equip(slot: number, equip: boolean): void {
    if (!this.connected) return;
    this.sendJson({ op: CS.EQUIP_ITEM, seq: ++this.seq, d: { slot, equip } });
  }

  /**
   * Picks up an item, opens a chest or a door (the server checks distance and state); `key`
   * unlocks a locked door with the key carried.
   */
  interact(object: number, key = false): void {
    if (!this.connected || this.dead) return;
    this.sendJson({ op: CS.INTERACT, seq: ++this.seq, d: key ? { object, key } : { object } });
  }

  /** Talking to a peaceful creature: it faces the player and gestures for `ms` (its line). */
  talk(entity: number, ms: number): void {
    if (!this.connected || this.dead) return;
    this.sendJson({ op: CS.INTERACT, seq: ++this.seq, d: { object: entity, talk: Math.max(0, Math.min(20_000, Math.round(ms))) } });
  }

  /** Casts the selected spell (the server checks mana, state and conjures it). */
  castSpell(): void {
    if (!this.connected || this.dead) return;
    this.sendJson({ op: CS.CAST_SPELL, seq: ++this.seq, d: {} });
  }

  /** Selects the spell R casts. */
  selectSpell(spell: SpellId): void {
    if (!this.connected) return;
    this.sendJson({ op: CS.SELECT_SPELL, seq: ++this.seq, d: { spell } });
  }

  /** Uses a consumable (potion) from an inventory slot. */
  useItem(slot: number): void {
    if (!this.connected || this.dead) return;
    this.sendJson({ op: CS.USE_ITEM, seq: ++this.seq, d: { slot } });
  }

  /**
   * Advances local prediction by one fixed step with `input` (yaw/pitch/flags; clientTick is
   * assigned here) and sends it with the two previous frames for loss tolerance.
   */
  tick(input: Readonly<InputFrame>): void {
    const c = this.character;
    if (!c || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const t = ++this.clientTick;
    const slot = this.inputs[t % INPUT_HISTORY]!;
    slot.clientTick = t;
    // Mirror the server: the dead do not act (keeps prediction in agreement).
    slot.flags = this.dead ? 0 : input.flags;
    slot.yaw = input.yaw;
    slot.pitch = input.pitch;
    for (const [id, d] of this.swings) {
      if (!d.motion) continue;
      const before = d.motion.progress;
      if (!stepDoorMotion(d.def, d.motion, TICK_MS)) d.motion = null;
      if (!d.motion || d.motion.progress !== before) this.poseDoor(id);
    }
    stepCharacter(this.mw, c, slot, this.moveStats, TICK_DT);

    const frames: InputFrame[] = [];
    for (let k = Math.min(MAX_INPUT_FRAMES, t) - 1; k >= 0; k--) frames.push(this.inputs[(t - k) % INPUT_HISTORY]!);
    const len = encodeInput(this.sendBuf, this.latestTick, frames);
    this.stats.bytesOut += len;
    this.ws.send(new Uint8Array(this.sendBuf.buffer, 0, len));
  }

  private onSnapshot(view: DataView): void {
    const baselineTick = view.byteLength >= 9 ? view.getUint32(5, true) : 0;
    const state = new Map<number, EntityState>();
    const header = decodeSnapshot(view, this.snapshots.get(baselineTick) ?? null, state);
    if (!header || header.serverTick <= this.latestTick && this.stats.snapshots > 0) return;
    this.stats.snapshots++;
    this.snapshots.set(header.serverTick, state);
    this.snapshots.delete(header.serverTick - SNAPSHOT_HISTORY);
    this.latestTick = header.serverTick;
    this.latestAt = performance.now();

    for (const [id, e] of state) {
      if (id === this.entityId) continue;
      let buf = this.remote.get(id);
      if (!buf) this.remote.set(id, (buf = []));
      buf.push({
        tick: header.serverTick,
        x: dequantizePosition(e.x),
        y: dequantizePosition(e.y),
        z: dequantizePosition(e.z),
        yaw: dequantizeAngle(e.yaw),
        anim: e.anim,
        animPhase: e.animPhase,
        hp: e.hp,
        flags: e.flags,
      });
      if (buf.length > REMOTE_BUFFER) buf.shift();
    }

    const self = state.get(this.entityId);
    const c = this.character;
    if (!self || !c) return;
    // Reconcile: reset to the authoritative state after lastProcessedInput, replay newer inputs.
    const bx = c.position.x, by = c.position.y, bz = c.position.z;
    setCharacterState(
      c,
      { x: dequantizePosition(self.x), y: dequantizePosition(self.y), z: dequantizePosition(self.z) },
      header.selfVelY / 1000,
      header.selfGrounded,
      header.selfRollDir,
      header.selfRollTicks,
      { kind: header.selfAirKind, velX: header.selfAirVelX / 1000, velZ: header.selfAirVelZ / 1000, travel: header.selfAirTravel / 1000 },
      { state: header.selfLocoState, frame: header.selfLocoFrame },
    );
    const from = Math.max(header.lastProcessedInput + 1, this.clientTick - INPUT_HISTORY + 1);
    for (let t = from; t <= this.clientTick; t++) {
      stepCharacter(this.mw, c, this.inputs[t % INPUT_HISTORY]!, this.moveStats, TICK_DT);
    }
    const dx = c.position.x - bx, dy = c.position.y - by, dz = c.position.z - bz;
    if (dx !== 0 || dy !== 0 || dz !== 0) {
      this.stats.corrections++;
      this.stats.lastCorrection = Math.hypot(dx, dy, dz);
      this.events.correction?.(dx, dy, dz);
    }
  }

  /** Smoothed estimate of the current server tick (fractional). */
  estimateServerTick(now = performance.now()): number {
    const target = this.latestTick + (now - this.latestAt) / TICK_MS;
    // Ease towards the target to absorb network jitter; snap if far off.
    this.serverTickEstimate = Math.abs(target - this.serverTickEstimate) > 5 ? target : this.serverTickEstimate + (target - this.serverTickEstimate) * 0.1;
    return this.serverTickEstimate;
  }

  remoteIds(): IterableIterator<number> {
    return this.remote.keys();
  }

  /** Interpolated remote entity state at `renderTick`; false if nothing buffered yet. */
  sampleRemote(id: number, renderTick: number, out: RemoteSample): boolean {
    const buf = this.remote.get(id);
    if (!buf || buf.length === 0) return false;
    let a = buf[0]!;
    let b = a;
    for (let i = 1; i < buf.length; i++) {
      b = buf[i]!;
      if (b.tick >= renderTick) break;
      a = b;
    }
    const span = b.tick - a.tick;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTick - a.tick) / span)) : 1;
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    const dyaw = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    out.yaw = a.yaw + dyaw * t;
    out.anim = t < 0.5 ? a.anim : b.anim;
    out.animPhase = t < 0.5 ? a.animPhase : b.animPhase;
    out.hp = b.hp;
    out.flags = t < 0.5 ? a.flags : b.flags;
    return true;
  }
}

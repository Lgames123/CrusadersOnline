import {
  ANIM,
  DEFAULT_MOVEMENT_STATS,
  INPUT,
  INTEREST_RADIUS,
  MAX_INPUT_FRAMES,
  SC,
  SpatialHashGrid,
  TICK_DT,
  createCharacter,
  createEntityState,
  createInputFrame,
  createMovementWorld,
  decodeInput,
  encodeSnapshot,
  quantizePosition,
  removeCharacter,
  snapshotMaxBytes,
  stepCharacter,
  type ArenaDef,
  type Character,
  type EntityState,
  type InputFrame,
  type MovementWorld,
  type Rapier,
  type ServerControlMsg,
} from '@crusaders/shared';
import { InputQueue } from './input_queue.ts';

/** Snapshots older than this are not used as delta baselines (full snapshot instead). */
const MAX_BASELINE_AGE = 20;
const HISTORY_TICKS = 32;
const MOVE_MASK = INPUT.FORWARD | INPUT.BACK | INPUT.LEFT | INPUT.RIGHT;

export interface ZoneOutbox {
  /** Binary frames are snapshots; strings are JSON control messages. */
  send(connId: number, data: Uint8Array | string): void;
}

export interface JoinOptions {
  name: string;
  /** Persistent character id, or null for ephemeral guests. */
  characterId: string | null;
  /** Saved feet position; null/invalid => next spawn point. */
  position?: { x: number; y: number; z: number } | null;
  yaw?: number;
}

/** State a zone hands back for saving (see persistence/characters.ts). */
export interface PersistRecord {
  characterId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Saved positions outside these bounds are discarded (fell out of the world, corrupt data). */
const MIN_VALID_Y = -50;
const MAX_VALID_COORD = 10_000;

function validPosition(p: JoinOptions['position']): p is { x: number; y: number; z: number } {
  return !!p && [p.x, p.y, p.z].every(Number.isFinite) && p.y > MIN_VALID_Y &&
    Math.abs(p.x) < MAX_VALID_COORD && Math.abs(p.z) < MAX_VALID_COORD;
}

interface Player {
  connId: number;
  entityId: number;
  characterId: string | null;
  name: string;
  character: Character;
  queue: InputQueue;
  yaw: number;
  anim: number;
  lastProcessedInput: number;
  ackTick: number;
  history: Map<number, Map<number, EntityState>>;
  known: Set<number>;
  malformed: number;
}

/**
 * One authoritative world zone: shared collision world, player characters driven only by
 * client inputs, and per-client interest-filtered delta snapshots. Pure (no I/O), so it can
 * run inside a worker thread or directly in tests.
 */
export class WorldZone {
  readonly name: string;
  readonly arena: ArenaDef;
  tick = 0;

  private readonly mw: MovementWorld;
  private readonly outbox: ZoneOutbox;
  private readonly grid = new SpatialHashGrid(32);
  private readonly players = new Map<number, Player>(); // by connId
  private readonly byEntity = new Map<number, Player>();
  private readonly states = new Map<number, EntityState>();
  private nextEntityId = 1;
  private spawnIndex = 0;
  private encodeBuf = new DataView(new ArrayBuffer(16 * 1024));
  private readonly scratchIds: number[] = [];
  private readonly scratchFrames: InputFrame[] = Array.from({ length: MAX_INPUT_FRAMES }, createInputFrame);
  private readonly frame = createInputFrame();

  constructor(rapier: Rapier, name: string, arena: ArenaDef, outbox: ZoneOutbox) {
    this.name = name;
    this.arena = arena;
    this.outbox = outbox;
    this.mw = createMovementWorld(rapier, arena);
  }

  get playerCount(): number {
    return this.players.size;
  }

  private sendJson(connId: number, msg: ServerControlMsg): void {
    this.outbox.send(connId, JSON.stringify(msg));
  }

  join(connId: number, opts: JoinOptions): number {
    if (this.players.has(connId)) throw new Error(`connection ${connId} already in zone`);
    const spawn = validPosition(opts.position)
      ? opts.position
      : this.arena.spawnPoints[this.spawnIndex++ % this.arena.spawnPoints.length]!;
    const entityId = this.nextEntityId++;
    const p: Player = {
      connId,
      entityId,
      characterId: opts.characterId,
      name: opts.name,
      character: createCharacter(this.mw, spawn),
      queue: new InputQueue(),
      yaw: (opts.yaw ?? 0) & 0xffff,
      anim: ANIM.IDLE,
      lastProcessedInput: 0,
      ackTick: 0,
      history: new Map(),
      known: new Set(),
      malformed: 0,
    };
    this.players.set(connId, p);
    this.byEntity.set(entityId, p);
    this.states.set(entityId, createEntityState(entityId));
    this.grid.update(entityId, spawn.x, spawn.z);
    this.sendJson(connId, {
      op: SC.WORLD_ENTER,
      d: { entityId, zone: this.name, arena: this.arena.name, serverTick: this.tick, spawn: { ...p.character.position } },
    });
    return entityId;
  }

  private persistRecord(p: Player): PersistRecord | null {
    if (!p.characterId) return null;
    const pos = p.character.position;
    return { characterId: p.characterId, x: pos.x, y: pos.y, z: pos.z, yaw: p.yaw };
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
    this.byEntity.delete(p.entityId);
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

  step(): void {
    const tick = ++this.tick;

    // 1. Movement: at most one input per player per tick. No input => no movement this tick,
    //    so the authoritative state always equals "state after lastProcessedInput".
    for (const p of this.players.values()) {
      if (p.queue.shift(this.frame)) {
        stepCharacter(this.mw, p.character, this.frame, DEFAULT_MOVEMENT_STATS, TICK_DT);
        p.lastProcessedInput = this.frame.clientTick;
        p.yaw = this.frame.yaw;
        const moving = (this.frame.flags & MOVE_MASK) !== 0;
        p.anim = !p.character.grounded
          ? ANIM.AIRBORNE
          : moving ? (this.frame.flags & INPUT.WALK ? ANIM.WALK : ANIM.RUN) : ANIM.IDLE;
      }
      const pos = p.character.position;
      this.grid.update(p.entityId, pos.x, pos.z);
      const s = this.states.get(p.entityId)!;
      s.x = quantizePosition(pos.x);
      s.y = quantizePosition(pos.y);
      s.z = quantizePosition(pos.z);
      s.yaw = p.yaw;
      s.anim = p.anim;
      s.hp = 100;
    }

    // 2. Per-client interest + delta snapshot.
    for (const p of this.players.values()) this.sendSnapshot(p, tick);
  }

  private sendSnapshot(p: Player, tick: number): void {
    const pos = p.character.position;
    const n = this.grid.queryRadius(pos.x, pos.z, INTEREST_RADIUS, this.scratchIds);
    const current = new Map<number, EntityState>();
    for (let i = 0; i < n; i++) {
      const id = this.scratchIds[i]!;
      const other = this.byEntity.get(id);
      if (!other) continue;
      const op = other.character.position;
      if (id !== p.entityId && Math.hypot(op.x - pos.x, op.z - pos.z) > INTEREST_RADIUS) continue;
      current.set(id, { ...this.states.get(id)! });
    }

    for (const id of current.keys()) {
      if (id === p.entityId || p.known.has(id)) continue;
      const other = this.byEntity.get(id)!;
      this.sendJson(p.connId, { op: SC.ENTITY_SPAWN, d: { id, kind: 'player', name: other.name } });
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

  stats(connId: number): { dropped: number; malformed: number; queued: number } | undefined {
    const p = this.players.get(connId);
    return p && { dropped: p.queue.dropped, malformed: p.malformed, queued: p.queue.length };
  }
}

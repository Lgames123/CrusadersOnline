import { TICK_DT, TICK_MS, DEFAULT_MOVEMENT_STATS } from '../constants.ts';
import { dequantizeAngle, dequantizePosition } from '../math/quantize.ts';
import { CS, SC } from '../protocol/opcodes.ts';
import { INPUT_PACKET_MAX_BYTES, MAX_INPUT_FRAMES, createInputFrame, encodeInput, type InputFrame } from '../protocol/binary/input.ts';
import { decodeSnapshot, type EntityState } from '../protocol/binary/snapshot.ts';
import type { ServerControlMsg, WorldEnterMsg } from '../protocol/control/server.ts';
import type { ArenaDef } from '../arena/types.ts';
import { createMovementWorld, type MovementWorld, type Rapier } from '../movement/physics.ts';
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
}

interface RemoteFrame extends RemoteSample {
  tick: number;
}

export interface ClientSessionEvents {
  spawn?(id: number, name: string): void;
  despawn?(id: number): void;
  /** Local prediction was corrected by (dx, dy, dz) metres. */
  correction?(dx: number, dy: number, dz: number): void;
  close?(code: number, reason: string): void;
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
  readonly mw: MovementWorld;
  character: Character | null = null;
  entityId = 0;
  accountName = '';
  readonly stats: ClientSessionStats = { snapshots: 0, corrections: 0, lastCorrection: 0, rttMs: 0, bytesIn: 0, bytesOut: 0 };
  readonly names = new Map<number, string>();

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

  constructor(rapier: Rapier, arena: ArenaDef, events: ClientSessionEvents = {}) {
    this.mw = createMovementWorld(rapier, arena);
    this.events = events;
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
      case SC.WORLD_ENTER:
        this.entityId = msg.d.entityId;
        this.character = createCharacter(this.mw, msg.d.spawn);
        this.latestTick = this.serverTickEstimate = msg.d.serverTick;
        this.latestAt = performance.now();
        this.pingTimer = setInterval(() => this.sendJson({ op: CS.PING, seq: this.seq++, d: { clientTime: performance.now() } }), 2000);
        break;
      case SC.ENTITY_SPAWN:
        this.names.set(msg.d.id, msg.d.name);
        this.events.spawn?.(msg.d.id, msg.d.name);
        break;
      case SC.ENTITY_DESPAWN:
        this.names.delete(msg.d.id);
        this.remote.delete(msg.d.id);
        this.events.despawn?.(msg.d.id);
        break;
      case SC.PONG:
        this.stats.rttMs = performance.now() - msg.d.clientTime;
        break;
      case SC.ERROR:
        break;
    }
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
    slot.flags = input.flags;
    slot.yaw = input.yaw;
    slot.pitch = input.pitch;
    stepCharacter(this.mw, c, slot, DEFAULT_MOVEMENT_STATS, TICK_DT);

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
    );
    const from = Math.max(header.lastProcessedInput + 1, this.clientTick - INPUT_HISTORY + 1);
    for (let t = from; t <= this.clientTick; t++) {
      stepCharacter(this.mw, c, this.inputs[t % INPUT_HISTORY]!, DEFAULT_MOVEMENT_STATS, TICK_DT);
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
    return true;
  }
}

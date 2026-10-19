import { Worker } from 'node:worker_threads';
import type { ExitCrossing, SpellId, WorldRates } from '@crusaders/shared';
import type { JoinOptions, LootEvent, PersistReason, PersistRecord, TransferState } from '../simulation/world_zone.ts';
import type { AttackKind } from '@crusaders/shared';
import type { FromZone, ToZone, ZoneMetrics, ZoneReply, ZoneRequest, ZoneWorkerData } from './messages.ts';

export interface ZoneHostEvents {
  deliver(connId: number, data: Uint8Array | string): void;
  metrics?(m: ZoneMetrics): void;
  persist?(records: PersistRecord[], reason: PersistReason): void;
  error?(err: Error): void;
  portal?(connId: number, target: string, keep?: { x: number; y: number; z: number; mesh: string }, via?: ExitCrossing): void;
  transferred?(connId: number, record: PersistRecord | null, state: TransferState | null): void;
  loot?(event: LootEvent): void;
}

/** Main-thread handle for one zone worker. */
export class ZoneHost {
  readonly zone: string;
  /** Latest tick reported by the worker. */
  tick = 0;
  /** Connections in this zone (joined, not yet left or transferred out). */
  readonly members = new Set<number>();
  /** Last join / leave / transfer, ms (Date.now): idle zones are stopped (ZoneManager). */
  lastActive = Date.now();
  /** Latest tick timings (every 5 s), for the admin panel. */
  lastMetrics: ZoneMetrics | null = null;
  private readonly worker: Worker;
  private readonly ready: Promise<void>;

  constructor(data: ZoneWorkerData, events: ZoneHostEvents) {
    this.zone = data.zone;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: data });
    this.ready = new Promise((resolve, reject) => {
      this.worker.once('error', reject);
      this.worker.on('message', (msg: FromZone) => {
        switch (msg.t) {
          case 'ready':
            resolve();
            break;
          case 'out':
            this.tick = msg.tick;
            for (const [connId, d] of msg.batch) events.deliver(connId, typeof d === 'string' ? d : new Uint8Array(d));
            break;
          case 'metrics':
            this.lastMetrics = msg.metrics;
            events.metrics?.(msg.metrics);
            break;
          case 'persist':
            events.persist?.(msg.records, msg.reason);
            break;
          case 'portal':
            events.portal?.(msg.connId, msg.target, msg.keep, msg.via);
            break;
          case 'loot':
            events.loot?.(msg.event);
            break;
          case 'transferred':
            events.transferred?.(msg.connId, msg.record, msg.state);
            break;
          case 'reply':
            this.replies.get(msg.reqId)?.(msg.reply);
            this.replies.delete(msg.reqId);
            break;
        }
      });
    });
    this.worker.on('error', (err) => events.error?.(err as Error));
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private stopping = false;
  private nextReq = 1;
  private readonly replies = new Map<number, (r: ZoneReply) => void>();

  /** An admin panel request; rejects with the zone's message (or after 5 s / when stopping). */
  request(req: ZoneRequest): Promise<ZoneReply & { ok: true }> {
    if (this.stopping) return Promise.reject(new Error(`${this.zone} is stopping.`));
    const reqId = this.nextReq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.replies.delete(reqId);
        reject(new Error(`${this.zone} did not answer.`));
      }, 5000);
      this.replies.set(reqId, (r) => {
        clearTimeout(timer);
        if (r.ok) resolve(r);
        else reject(new Error(r.error));
      });
      this.post({ t: 'request', reqId, req });
    });
  }

  setRates(rates: WorldRates): void {
    this.post({ t: 'rates', rates });
  }

  private post(msg: ToZone, transfer: ArrayBuffer[] = []): void {
    if (this.stopping) return; // late leave/input after the final flush
    this.worker.postMessage(msg, transfer);
  }

  join(connId: number, opts: JoinOptions): void {
    this.members.add(connId);
    this.lastActive = Date.now();
    this.post({ t: 'join', connId, opts });
  }

  attack(connId: number, kind: AttackKind = 'normal'): void {
    this.post({ t: 'attack', connId, kind });
  }

  castSpell(connId: number): void {
    this.post({ t: 'cast', connId });
  }

  selectSpell(connId: number, spell: SpellId): void {
    this.post({ t: 'selectSpell', connId, spell });
  }

  equip(connId: number, slot: number, equip: boolean, itemId?: string, to?: { x: number; y: number }): void {
    this.post({ t: 'equip', connId, slot, equip, ...(itemId !== undefined ? { itemId } : {}), ...(to ? { to } : {}) });
  }

  moveInventoryItem(connId: number, slot: number, x: number, y: number, itemId?: string): void {
    this.post({ t: 'moveInventoryItem', connId, slot, x, y, ...(itemId !== undefined ? { itemId } : {}) });
  }

  mergeInventoryStacks(connId: number, fromSlot: number, toSlot: number): void {
    this.post({ t: 'mergeInventoryStacks', connId, fromSlot, toSlot });
  }

  splitInventoryStack(connId: number, slot: number, quantity: number): void {
    this.post({ t: 'splitInventoryStack', connId, slot, quantity });
  }

  dropInventoryItem(connId: number, slot: number, itemId?: string): void {
    this.post({ t: 'dropInventoryItem', connId, slot, ...(itemId !== undefined ? { itemId } : {}) });
  }

  interact(connId: number, object: number, key = false): void {
    this.post({ t: 'interact', connId, object, key });
  }

  talk(connId: number, entity: number, ms: number): void {
    this.post({ t: 'talk', connId, entity, ms });
  }

  shopOpen(connId: number, shop: number): void {
    this.post({ t: 'shopOpen', connId, shop });
  }

  shopBuy(connId: number, shop: number, index: number, itemId: string): void {
    this.post({ t: 'shopBuy', connId, shop, index, itemId });
  }

  shopSell(connId: number, shop: number, slot: number, itemId?: string): void {
    this.post({ t: 'shopSell', connId, shop, slot, ...(itemId !== undefined ? { itemId } : {}) });
  }

  cutsceneDone(connId: number, sequence: string): void {
    this.post({ t: 'cutsceneDone', connId, sequence });
  }

  unstuck(connId: number): void {
    this.post({ t: 'unstuck', connId });
  }

  useItem(connId: number, slot: number): void {
    this.post({ t: 'use', connId, slot });
  }

  transfer(connId: number): void {
    this.members.delete(connId);
    this.lastActive = Date.now();
    this.post({ t: 'transfer', connId });
  }

  leave(connId: number): void {
    this.members.delete(connId);
    this.lastActive = Date.now();
    this.post({ t: 'leave', connId });
  }

  /** Takes ownership of `data` (transferred to the worker). */
  input(connId: number, data: ArrayBuffer): void {
    this.post({ t: 'input', connId, data }, [data]);
  }

  async stop(): Promise<void> {
    const stopped = new Promise<void>((resolve) => {
      const onMsg = (msg: FromZone) => msg.t === 'stopped' && resolve();
      this.worker.on('message', onMsg);
      this.worker.once('exit', () => resolve());
    });
    this.post({ t: 'stop' });
    this.stopping = true;
    await Promise.race([stopped, new Promise((r) => setTimeout(r, 2000))]);
    await this.worker.terminate();
  }
}

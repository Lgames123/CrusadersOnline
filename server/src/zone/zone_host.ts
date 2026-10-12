import { Worker } from 'node:worker_threads';
import type { SpellId } from '@crusaders/shared';
import type { JoinOptions, PersistReason, PersistRecord, TransferState } from '../simulation/world_zone.ts';
import type { AttackKind } from '@crusaders/shared';
import type { FromZone, ToZone, ZoneMetrics, ZoneWorkerData } from './messages.ts';

export interface ZoneHostEvents {
  deliver(connId: number, data: Uint8Array | string): void;
  metrics?(m: ZoneMetrics): void;
  persist?(records: PersistRecord[], reason: PersistReason): void;
  error?(err: Error): void;
  portal?(connId: number, target: string): void;
  transferred?(connId: number, record: PersistRecord | null, state: TransferState | null): void;
}

/** Main-thread handle for one zone worker. */
export class ZoneHost {
  readonly zone: string;
  /** Latest tick reported by the worker. */
  tick = 0;
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
            events.metrics?.(msg.metrics);
            break;
          case 'persist':
            events.persist?.(msg.records, msg.reason);
            break;
          case 'portal':
            events.portal?.(msg.connId, msg.target);
            break;
          case 'transferred':
            events.transferred?.(msg.connId, msg.record, msg.state);
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

  private post(msg: ToZone, transfer: ArrayBuffer[] = []): void {
    if (this.stopping) return; // late leave/input after the final flush
    this.worker.postMessage(msg, transfer);
  }

  join(connId: number, opts: JoinOptions): void {
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

  equip(connId: number, slot: number, equip: boolean): void {
    this.post({ t: 'equip', connId, slot, equip });
  }

  interact(connId: number, object: number, key = false): void {
    this.post({ t: 'interact', connId, object, key });
  }

  useItem(connId: number, slot: number): void {
    this.post({ t: 'use', connId, slot });
  }

  transfer(connId: number): void {
    this.post({ t: 'transfer', connId });
  }

  leave(connId: number): void {
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

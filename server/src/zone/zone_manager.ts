import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LEVEL_PREFIX } from '@crusaders/shared';
import type { PersistReason, PersistRecord, TransferState } from '../simulation/world_zone.ts';
import type { ZoneMetrics, ZoneWorkerData } from './messages.ts';
import { ZoneHost } from './zone_host.ts';

export interface ZoneManagerEvents {
  deliver(connId: number, data: Uint8Array | string): void;
  persist(records: PersistRecord[], reason: PersistReason): void;
  portal(arena: string, connId: number, target: string): void;
  transferred(arena: string, connId: number, record: PersistRecord | null, state: TransferState | null): void;
  metrics?(m: ZoneMetrics): void;
  error?(arena: string, err: Error): void;
}

export interface ZoneManagerOptions {
  /** A zone without players for this long is stopped (its world state resets). Default 5 min. */
  idleStopMs?: number;
  /** How often idle zones are looked for. Default 30 s. */
  sweepMs?: number;
}

/**
 * One zone worker per arena, started on first use (players enter through login or portals) and
 * stopped after it stays empty (except the kept ones, e.g. the default arena). Zones are named
 * after their arena ("synthetic-arena", "level:ca1a"...).
 */
export class ZoneManager {
  private readonly zones = new Map<string, Promise<ZoneHost>>();
  private readonly ready = new Map<string, ZoneHost>();
  private readonly base: Omit<ZoneWorkerData, 'zone' | 'arena'>;
  private readonly events: ZoneManagerEvents;
  private readonly kept = new Set<string>();
  private readonly idleStopMs: number;
  private readonly sweeper: ReturnType<typeof setInterval>;
  private stopping = false;

  constructor(base: Omit<ZoneWorkerData, 'zone' | 'arena'>, events: ZoneManagerEvents, opts: ZoneManagerOptions = {}) {
    this.base = base;
    this.events = events;
    this.idleStopMs = opts.idleStopMs ?? 5 * 60_000;
    this.sweeper = setInterval(() => void this.stopIdle(), opts.sweepMs ?? 30_000);
    this.sweeper.unref();
  }

  /** Never stops this arena's zone when idle. */
  keep(arena: string): void {
    this.kept.add(arena);
  }

  /** Stops the zones that have had no players for idleStopMs; resolves with their names. */
  async stopIdle(now = Date.now()): Promise<string[]> {
    const idle = [...this.ready.values()].filter((h) => !this.kept.has(h.zone) && h.members.size === 0 && now - h.lastActive >= this.idleStopMs);
    for (const h of idle) {
      this.ready.delete(h.zone);
      this.zones.delete(h.zone);
    }
    await Promise.all(idle.map((h) => h.stop()));
    return idle.map((h) => h.zone);
  }

  /** Whether an arena can be run: the synthetic arena, or a level act converted in generatedDir. */
  available(arena: string): boolean {
    if (arena === 'synthetic-arena') return true;
    if (!arena.startsWith(LEVEL_PREFIX)) return false;
    const act = arena.slice(LEVEL_PREFIX.length);
    if (!/^[a-z0-9_-]+$/.test(act)) return false;
    const placements = path.join(this.base.generatedDir, 'levels', `${act}.placements.json`);
    if (!existsSync(placements)) return false;
    try {
      const mesh = (JSON.parse(readFileSync(placements, 'utf8')) as { mesh?: string }).mesh;
      return !!mesh && existsSync(path.join(this.base.generatedDir, 'levels', `${mesh}.collision.bin`));
    } catch {
      return false;
    }
  }

  /** The running zone for an arena (null while it is starting or if it never started). */
  host(arena: string): ZoneHost | null {
    return this.ready.get(arena) ?? null;
  }

  /** Starts the zone if needed and resolves when it is ready. */
  get(arena: string): Promise<ZoneHost> {
    if (this.stopping) return Promise.reject(new Error('server stopping'));
    let p = this.zones.get(arena);
    if (!p) {
      const host = new ZoneHost(
        { ...this.base, zone: arena, arena },
        {
          deliver: (connId, data) => this.events.deliver(connId, data),
          persist: (records, reason) => this.events.persist(records, reason),
          portal: (connId, target) => this.events.portal(arena, connId, target),
          transferred: (connId, record, state) => this.events.transferred(arena, connId, record, state),
          ...(this.events.metrics ? { metrics: this.events.metrics } : {}),
          error: (err) => this.events.error?.(arena, err),
        },
      );
      p = host.whenReady().then(() => {
        host.lastActive = Date.now();
        this.ready.set(arena, host);
        return host;
      });
      p.catch(() => this.zones.delete(arena));
      this.zones.set(arena, p);
    }
    return p;
  }

  get names(): string[] {
    return [...this.ready.keys()];
  }

  /** Stops every zone; each flushes its characters (persist 'shutdown') before stopping. */
  async stopAll(): Promise<void> {
    this.stopping = true;
    clearInterval(this.sweeper);
    const hosts = await Promise.allSettled([...this.zones.values()]);
    await Promise.all(hosts.map((h) => (h.status === 'fulfilled' ? h.value.stop() : undefined)));
  }
}

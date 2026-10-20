import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { splitInstance, DEFAULT_RATES, LEVEL_PREFIX, type ExitCrossing, type WorldRates } from '@crusaders/shared';
import type { EconomyEvent, LootEvent, PartyVitals, PersistReason, PersistRecord, TransferState } from '../simulation/world_zone.ts';
import type { ZoneMetrics, ZoneWorkerData } from './messages.ts';
import { ZoneHost } from './zone_host.ts';

export interface ZoneManagerEvents {
  deliver(connId: number, data: Uint8Array | string): void;
  persist(records: PersistRecord[], reason: PersistReason): void;
  portal(arena: string, connId: number, target: string, keep?: { x: number; y: number; z: number; mesh: string }, via?: ExitCrossing, waypoint?: boolean): void;
  transferred(arena: string, connId: number, record: PersistRecord | null, state: TransferState | null): void;
  metrics?(m: ZoneMetrics): void;
  error?(arena: string, err: Error): void;
  loot?(arena: string, event: LootEvent): void;
  economy?(arena: string, event: EconomyEvent): void;
  dungeon?(arena: string, connId: number, dungeon: string): void;
  dungeonExit?(arena: string, connId: number): void;
  vitals?(arena: string, list: PartyVitals[]): void;
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
  /** Zones kept running for the admin panel (custom spawns in them), with a count per arena. */
  private readonly pinned = new Map<string, number>();
  /** Event rates every zone runs with (admin panel). */
  private rates: WorldRates = { ...DEFAULT_RATES };
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

  /** Keeps a zone running while something of the admin panel is in it (`unpin` releases it). */
  pin(arena: string): void {
    this.pinned.set(arena, (this.pinned.get(arena) ?? 0) + 1);
  }

  unpin(arena: string): void {
    const n = (this.pinned.get(arena) ?? 0) - 1;
    if (n > 0) this.pinned.set(arena, n);
    else this.pinned.delete(arena);
  }

  /** Sets the event rates of every running zone and of zones started later. */
  setRates(rates: WorldRates): void {
    this.rates = { ...rates };
    for (const h of this.ready.values()) h.setRates(this.rates);
  }

  get currentRates(): WorldRates {
    return { ...this.rates };
  }

  /** Every arena that can be run (the synthetic arena and each converted level act). */
  arenas(): string[] {
    const dir = path.join(this.base.generatedDir, 'levels');
    const acts = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.placements.json')).map((f) => `${LEVEL_PREFIX}${f.slice(0, -'.placements.json'.length)}`) : [];
    return ['synthetic-arena', ...acts.filter((a) => this.available(a)).sort()];
  }

  /** Stops the zones that have had no players for idleStopMs; resolves with their names. */
  async stopIdle(now = Date.now()): Promise<string[]> {
    const idle = [...this.ready.values()].filter((h) => !this.kept.has(h.zone) && !this.pinned.has(h.zone) && h.members.size === 0 && now - h.lastActive >= this.idleStopMs);
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
    // A dungeon instance: a known dungeon on its own act ("level:ca1d@crypt-3").
    const inst = splitInstance(arena);
    if (inst.instance !== null) {
      if (!inst.dungeon || !/^[a-z]+-[a-z0-9]{1,16}$/.test(inst.instance) || inst.base !== `${LEVEL_PREFIX}${inst.dungeon.act}`) return false;
      arena = inst.base;
    }
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
        { ...this.base, zone: arena, arena, rates: this.rates },
        {
          deliver: (connId, data) => this.events.deliver(connId, data),
          persist: (records, reason) => this.events.persist(records, reason),
          portal: (connId, target, keep, via, waypoint) => this.events.portal(arena, connId, target, keep, via, waypoint),
          transferred: (connId, record, state) => this.events.transferred(arena, connId, record, state),
          ...(this.events.metrics ? { metrics: this.events.metrics } : {}),
          error: (err) => this.events.error?.(arena, err),
          loot: (event) => this.events.loot?.(arena, event),
          economy: (event) => this.events.economy?.(arena, event),
          dungeon: (connId, dungeon) => this.events.dungeon?.(arena, connId, dungeon),
          dungeonExit: (connId) => this.events.dungeonExit?.(arena, connId),
          vitals: (list) => this.events.vitals?.(arena, list),
        },
      );
      p = host.whenReady().then(() => {
        host.lastActive = Date.now();
        // Rates changed while it was starting.
        host.setRates(this.rates);
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

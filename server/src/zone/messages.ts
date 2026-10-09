import type { JoinOptions, PersistRecord } from '../simulation/world_zone.ts';

/** Main thread <-> zone worker messages (ADR-009). Binary payloads are transferred, not copied. */

export type ToZone =
  | { t: 'join'; connId: number; opts: JoinOptions }
  | { t: 'leave'; connId: number }
  | { t: 'input'; connId: number; data: ArrayBuffer }
  | { t: 'stop' };

export interface ZoneMetrics {
  zone: string;
  players: number;
  ticks: number;
  p50: number;
  p99: number;
  max: number;
  late: number;
}

export type FromZone =
  | { t: 'ready'; zone: string }
  /** All outbound frames produced by one tick, in order. */
  | { t: 'out'; tick: number; batch: [connId: number, data: ArrayBuffer | string][] }
  | { t: 'metrics'; metrics: ZoneMetrics }
  /** Character states to save: periodic flush, a player leaving, or final flush before stop. */
  | { t: 'persist'; reason: 'periodic' | 'leave' | 'shutdown'; records: PersistRecord[] }
  | { t: 'stopped' };

export interface ZoneWorkerData {
  zone: string;
  arena: string;
}

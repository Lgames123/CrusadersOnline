import type { JoinOptions, PersistReason, PersistRecord } from '../simulation/world_zone.ts';

/** Main thread <-> zone worker messages (ADR-009). Binary payloads are transferred, not copied. */

export type ToZone =
  | { t: 'join'; connId: number; opts: JoinOptions }
  | { t: 'leave'; connId: number }
  | { t: 'input'; connId: number; data: ArrayBuffer }
  | { t: 'attack'; connId: number }
  | { t: 'equip'; connId: number; slot: number; equip: boolean }
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
  | { t: 'persist'; reason: PersistReason; records: PersistRecord[] }
  | { t: 'stopped' };

export interface ZoneWorkerData {
  zone: string;
  arena: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Converted items.json to use instead of the built-in catalog. */
  itemRulesPath: string | null;
  /** Converter output directory, for "level:<act>" arenas. */
  generatedDir: string;
}

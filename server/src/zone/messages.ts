import type { ExitCrossing, SpellId } from '@crusaders/shared';
import type { JoinOptions, PersistReason, PersistRecord, TransferState } from '../simulation/world_zone.ts';
import type { AttackKind } from '@crusaders/shared';

/** Main thread <-> zone worker messages (ADR-009). Binary payloads are transferred, not copied. */

export type ToZone =
  | { t: 'join'; connId: number; opts: JoinOptions }
  | { t: 'leave'; connId: number }
  | { t: 'input'; connId: number; data: ArrayBuffer }
  | { t: 'attack'; connId: number; kind: AttackKind }
  | { t: 'cast'; connId: number }
  | { t: 'selectSpell'; connId: number; spell: SpellId }
  | { t: 'equip'; connId: number; slot: number; equip: boolean; itemId?: string; to?: { x: number; y: number } }
  | { t: 'moveInventoryItem'; connId: number; slot: number; x: number; y: number; itemId?: string }
  | { t: 'mergeInventoryStacks'; connId: number; fromSlot: number; toSlot: number }
  | { t: 'splitInventoryStack'; connId: number; slot: number; quantity: number }
  | { t: 'dropInventoryItem'; connId: number; slot: number; itemId?: string }
  | { t: 'interact'; connId: number; object: number; key: boolean }
  | { t: 'talk'; connId: number; entity: number; ms: number }
  | { t: 'use'; connId: number; slot: number }
  | { t: 'cutsceneDone'; connId: number; sequence: string }
  /** Remove the player for a zone transfer; answered with 'transferred'. */
  | { t: 'transfer'; connId: number }
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
  /** A player entered a portal trigger (the main thread decides whether to transfer). */
  | { t: 'portal'; connId: number; target: string; keep?: { x: number; y: number; z: number; mesh: string }; via?: ExitCrossing }
  | { t: 'transferred'; connId: number; record: PersistRecord | null; state: TransferState | null }
  | { t: 'stopped' };

export interface ZoneWorkerData {
  zone: string;
  arena: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Non-original gameplay features switched on (GAME_FEATURES). */
  features?: string[];
  /** Converted items.json to use instead of the built-in catalog. */
  itemRulesPath: string | null;
  /** Converter output directory, for "level:<act>" arenas. */
  generatedDir: string;
}

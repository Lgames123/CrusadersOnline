import type { CustomSpawnSpec, ExitCrossing, SpellId, WorldRates } from '@crusaders/shared';
import type { JoinOptions, PersistReason, PersistRecord, TransferState, ZoneAdminReport } from '../simulation/world_zone.ts';
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
  | { t: 'shopOpen'; connId: number; shop: number }
  | { t: 'shopBuy'; connId: number; shop: number; index: number; itemId: string }
  | { t: 'shopSell'; connId: number; shop: number; slot: number; itemId?: string }
  | { t: 'use'; connId: number; slot: number }
  | { t: 'cutsceneDone'; connId: number; sequence: string }
  | { t: 'unstuck'; connId: number }
  /** Remove the player for a zone transfer; answered with 'transferred'. */
  | { t: 'transfer'; connId: number }
  /** Admin panel: event rates for every zone. */
  | { t: 'rates'; rates: WorldRates }
  /** Admin panel: a request answered with 'reply' (same reqId). */
  | { t: 'request'; reqId: number; req: ZoneRequest }
  | { t: 'stop' };

/** Admin panel requests a zone answers (WorldZone admin methods). */
export type ZoneRequest =
  | { kind: 'report' }
  | { kind: 'spawn'; spec: CustomSpawnSpec }
  | { kind: 'despawn'; id: string }
  | { kind: 'player'; connId: number; op: { action: 'heal' | 'unstuck' | 'gold' | 'xp' | 'item' | 'summon'; amount?: number; itemId?: string; toConn?: number } };

/** The answer: the request's result, or the error's message. */
export type ZoneReply = { ok: true; data: ZoneAdminReport | number[] | number | string } | { ok: false; error: string };

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
  | { t: 'reply'; reqId: number; reply: ZoneReply }
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
  /** Event rates in force when the zone starts (admin panel). */
  rates?: WorldRates;
}

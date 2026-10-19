import { z } from 'zod';

/**
 * Admin panel (client/admin.html) <-> server, over the HTTP API (/api/admin/*, admin accounts
 * only). Not original: server operation tools for the MMO.
 */

/** World rate multipliers an event sets (1 = the original's). */
export interface WorldRates {
  /** Experience per kill. */
  xp: number;
  /** Gold per kill. */
  gold: number;
  /** Item drops: loot-table chances, and the expected count of a creature's carried items. */
  drops: number;
  /** Creature respawn speed (2 = back in half the time). */
  respawn: number;
}

export const DEFAULT_RATES: Readonly<WorldRates> = { xp: 1, gold: 1, drops: 1, respawn: 1 };
/** Events without a stated length last this long, then everything goes back to default. */
export const DEFAULT_EVENT_MINUTES = 60;

const rate = z.number().min(0).max(100);
export const WorldRatesSchema = z.object({ xp: rate, gold: rate, drops: rate, respawn: z.number().min(0.1).max(100) });

export const EventRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  rates: WorldRatesSchema,
  /** ms since epoch; absent or past: now. */
  startsAt: z.number().int().optional(),
  minutes: z.number().int().min(1).max(60 * 24 * 14).default(DEFAULT_EVENT_MINUTES),
  /** Tell every player in chat when it starts and ends. */
  announce: z.boolean().default(true),
});
export type EventRequest = z.infer<typeof EventRequestSchema>;

export interface AdminEvent {
  id: string;
  name: string;
  rates: WorldRates;
  startsAt: number;
  endsAt: number;
  announce: boolean;
  createdBy: string;
  state: 'scheduled' | 'active' | 'ended' | 'cancelled';
}

const point = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });

/** A custom creature: an archetype with its numbers changed. */
export const SpawnRequestSchema = z.object({
  /** Zone (arena) name: "synthetic-arena" or "level:<act>". */
  zone: z.string().min(1).max(40),
  archetype: z.string().min(1).max(40),
  name: z.string().trim().max(32).optional(),
  count: z.number().int().min(1).max(50).default(1),
  /** Where: next to an online player, at a point (metres), or at the zone's first start point. */
  at: z.union([z.object({ player: z.string().min(1).max(20) }), point, z.object({ start: z.literal(true) })]),
  hp: z.number().min(1).max(1_000_000).optional(),
  xp: z.number().int().min(0).max(10_000_000).optional(),
  goldMin: z.number().int().min(0).max(1_000_000).optional(),
  goldMax: z.number().int().min(0).max(1_000_000).optional(),
  /** Replaces the archetype's loot table when given. */
  loot: z.array(z.object({ itemId: z.string().min(1).max(64), chance: z.number().min(0).max(1), quantity: z.number().int().min(1).max(999).default(1) })).max(20).optional(),
  /** Multipliers. */
  scale: z.number().min(0.2).max(5).default(1),
  damage: z.number().min(0).max(100).default(1),
  speed: z.number().min(0.1).max(5).default(1),
  /** Comes back after death (at its spawn point) until it expires; else gone after its first death. */
  respawn: z.boolean().default(false),
  /** Removed after this long, dead or alive. */
  minutes: z.number().int().min(1).max(60 * 24 * 14).default(DEFAULT_EVENT_MINUTES),
  /** Fights every player it sees at any range (like a relay's "fight nearest"). */
  aggressive: z.boolean().default(false),
});
export type SpawnRequest = z.infer<typeof SpawnRequestSchema>;

/** What a zone is told to spawn (positions resolved on the main thread or by the zone). */
export interface CustomSpawnSpec extends Omit<SpawnRequest, 'zone' | 'at'> {
  id: string;
  at: { x: number; y: number; z: number; yaw: number } | { player: string } | { start: true };
  expiresAt: number;
}

export interface CustomSpawnView {
  id: string;
  zone: string;
  archetype: string;
  name: string;
  count: number;
  alive: number;
  respawn: boolean;
  expiresAt: number;
  createdBy: string;
}

export const ChatRequestSchema = z.object({
  /** announce: everyone, on every tab; zone: players of one zone; whisper: one character. */
  mode: z.enum(['announce', 'zone', 'whisper']),
  text: z.string().trim().min(1).max(256),
  zone: z.string().max(40).optional(),
  to: z.string().max(20).optional(),
});

export const ModerationRequestSchema = z.object({
  action: z.enum(['kick', 'mute', 'unmute', 'timeout', 'ban', 'unban']),
  /** Account username or character name (any case). */
  target: z.string().trim().min(1).max(20),
  /** mute / timeout / ban length; absent on mute or ban: permanent. Timeout defaults to 10. */
  minutes: z.number().int().min(1).max(60 * 24 * 3650).optional(),
  reason: z.string().trim().max(200).optional(),
});
export type ModerationRequest = z.infer<typeof ModerationRequestSchema>;

export const PlayerActionSchema = z.object({
  action: z.enum(['heal', 'unstuck', 'gold', 'xp', 'item', 'summon']),
  /** Character name. */
  target: z.string().trim().min(1).max(20),
  amount: z.number().int().min(-1_000_000).max(10_000_000).optional(),
  itemId: z.string().max(64).optional(),
  /** summon: the character the target is brought next to (same zone only). */
  to: z.string().max(20).optional(),
});
export type PlayerAction = z.infer<typeof PlayerActionSchema>;

export interface AdminChatLine {
  seq: number;
  at: number;
  channel: 'local' | 'global' | 'private' | 'admin';
  from: string;
  to?: string;
  zone?: string;
  text: string;
}

export interface AdminPlayerView {
  connId: number;
  account: string;
  character: string;
  guest: boolean;
  admin: boolean;
  zone: string;
  state: string;
  since: number;
  mutedUntil: number | null;
  level?: number;
  hp?: number;
  maxHp?: number;
  gold?: number;
  xp?: number;
  dead?: boolean;
  x?: number;
  y?: number;
  z?: number;
}

export interface AdminAccountView {
  id: string;
  username: string;
  admin: boolean;
  createdAt: number;
  bannedUntil: number | null;
  banReason: string | null;
  mutedUntil: number | null;
  characters: { id: string; name: string; level: number; zone: string; online: boolean }[];
}

/** Far-future date standing for "permanent" (bans, mutes). */
export const PERMANENT_UNTIL = Date.UTC(9999, 0, 1);

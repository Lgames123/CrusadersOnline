import type { ColumnType, Generated } from 'kysely';

/** Kysely table types mirroring migrations/*.sql. */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface AccountsTable {
  id: Generated<string>;
  username: string;
  email: string | null;
  password_hash: string;
  is_admin: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** Moderation (006_admin.sql). */
  banned_until: Timestamp | null;
  ban_reason: string | null;
  muted_until: Timestamp | null;
}

export interface SessionsTable {
  id: Uint8Array;
  account_id: string;
  created_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface CharactersTable {
  id: Generated<string>;
  account_id: string;
  name: string;
  level: Generated<number>;
  experience_points: ColumnType<string, number | bigint | undefined, number | bigint>;
  current_hp: Generated<number>;
  max_hp: Generated<number>;
  current_mana: Generated<number>;
  max_mana: Generated<number>;
  /** Known spells, "spell:level" comma-separated (002_spells.sql). */
  spells: Generated<string>;
  selected_spell: string | null;
  /** Story progress, story.ts StoryState as JSON (003_story.sql). */
  story: Generated<string>;
  /** Migration 009: soft skills XP (crafting.ts SkillXp). */
  skills: ColumnType<unknown, string | undefined, string>;
  might: Generated<number>;
  intelligence: Generated<number>;
  endurance: Generated<number>;
  speed: Generated<number>;
  gold: Generated<number>;
  zone_id: Generated<string>;
  pos_x: number | null;
  pos_y: number | null;
  pos_z: number | null;
  yaw: Generated<number>;
  created_at: Timestamp;
  last_saved_at: Timestamp;
  /** Seconds spent in the world (004_play_time.sql). */
  play_seconds: ColumnType<string, number | bigint | undefined, number | bigint>;
  last_played_at: Timestamp | null;
}

export interface InventoryItemsTable {
  id: Generated<string>;
  character_id: string;
  item_id: string;
  slot_index: number;
  grid_x: number | null;
  grid_y: number | null;
  is_equipped: Generated<boolean>;
  quantity: Generated<number>;
  durability: Generated<number>;
  /** Migration 007: the instance's ItemMods (JSONB), null = plain. */
  mods: unknown | null;
}

export interface AdminEventsTable {
  id: Generated<string>;
  name: string;
  /** WorldRates as JSON. */
  rates: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  announce: Generated<boolean>;
  created_by: string;
  cancelled_at: Timestamp | null;
  created_at: Timestamp;
}

export interface AdminActionsTable {
  id: Generated<string>;
  at: Timestamp;
  admin: string;
  action: string;
  target: string | null;
  detail: string | null;
}

/** Migration 008: BIGINT columns come back as strings from pg, numbers from PGlite. */
type BigIntColumn = ColumnType<string | number, number, number>;

export interface AuctionListingsTable {
  id: Generated<string>;
  seller_character_id: string;
  seller_name: string;
  item_id: string;
  item_uid: string | null;
  quantity: Generated<number>;
  mods: unknown | null;
  price: BigIntColumn;
  deposit: BigIntColumn;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
  status: Generated<'open' | 'sold' | 'expired' | 'cancelled'>;
  buyer_character_id: string | null;
}

export interface MailboxTable {
  id: Generated<string>;
  character_id: string;
  sender: Generated<string>;
  subject: string;
  gold: ColumnType<string | number, number | undefined, number>;
  item_id: string | null;
  item_uid: string | null;
  quantity: Generated<number>;
  mods: unknown | null;
  created_at: Generated<Timestamp>;
}

export interface EconomyAuditTable {
  id: Generated<string>;
  kind: string;
  character_id: string | null;
  other_character_id: string | null;
  gold: ColumnType<string | number, number | undefined, number>;
  item_id: string | null;
  item_uid: string | null;
  detail: ColumnType<unknown, string | undefined, string>;
  created_at: Generated<Timestamp>;
}

export interface DB {
  accounts: AccountsTable;
  sessions: SessionsTable;
  characters: CharactersTable;
  inventory_items: InventoryItemsTable;
  admin_events: AdminEventsTable;
  admin_actions: AdminActionsTable;
  auction_listings: AuctionListingsTable;
  mailbox: MailboxTable;
  economy_audit: EconomyAuditTable;
}

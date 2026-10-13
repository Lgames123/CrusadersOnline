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
}

export interface InventoryItemsTable {
  id: Generated<string>;
  character_id: string;
  item_id: string;
  slot_index: number;
  is_equipped: Generated<boolean>;
  quantity: Generated<number>;
  durability: Generated<number>;
}

export interface DB {
  accounts: AccountsTable;
  sessions: SessionsTable;
  characters: CharactersTable;
  inventory_items: InventoryItemsTable;
}

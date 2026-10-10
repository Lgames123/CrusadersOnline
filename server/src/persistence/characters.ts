import type { Kysely } from 'kysely';
import type { InventoryEntry } from '@crusaders/shared';
import type { DB } from './schema.ts';

/** Character state the zone needs to spawn a player. */
export interface CharacterSpawnState {
  id: string;
  name: string;
  zone: string;
  /** Last saved feet position, or null for a fresh character (use a spawn point). */
  position: { x: number; y: number; z: number } | null;
  yaw: number;
  level: number;
  experience: number;
  gold: number;
  hp: number;
  inventory: InventoryEntry[];
}

/** Live state flushed from a zone (periodic, on leave, after progress and on shutdown). */
export interface CharacterPersistRecord {
  characterId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  level: number;
  experience: number;
  gold: number;
  hp: number;
  maxHp: number;
  /** Full inventory replacing the stored one; omitted when unchanged. */
  inventory?: InventoryEntry[];
}

export class CharacterRepository {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  /** Loads a character only if it belongs to `accountId`. */
  async loadOwned(accountId: string, characterId: string): Promise<CharacterSpawnState | null> {
    const r = await this.db
      .selectFrom('characters')
      .select(['id', 'name', 'zone_id', 'pos_x', 'pos_y', 'pos_z', 'yaw', 'level', 'experience_points', 'gold', 'current_hp'])
      .where('id', '=', characterId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (!r) return null;
    const items = await this.db
      .selectFrom('inventory_items')
      .select(['item_id', 'slot_index', 'is_equipped', 'quantity'])
      .where('character_id', '=', characterId)
      .orderBy('slot_index')
      .execute();
    const hasPos = r.pos_x !== null && r.pos_y !== null && r.pos_z !== null;
    return {
      id: r.id,
      name: r.name,
      zone: r.zone_id,
      position: hasPos ? { x: r.pos_x!, y: r.pos_y!, z: r.pos_z! } : null,
      yaw: r.yaw,
      level: r.level,
      experience: Number(r.experience_points),
      gold: r.gold,
      hp: r.current_hp,
      inventory: items.map((i) => ({ slot: i.slot_index, itemId: i.item_id, equipped: i.is_equipped, ...(i.quantity > 1 ? { quantity: i.quantity } : {}) })),
    };
  }

  async saveStates(records: readonly CharacterPersistRecord[]): Promise<void> {
    if (records.length === 0) return;
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      for (const r of records) {
        await trx
          .updateTable('characters')
          .set({
            pos_x: r.x,
            pos_y: r.y,
            pos_z: r.z,
            yaw: r.yaw,
            level: r.level,
            experience_points: r.experience,
            gold: r.gold,
            current_hp: r.hp,
            max_hp: r.maxHp,
            last_saved_at: now,
          })
          .where('id', '=', r.characterId)
          .execute();
        if (r.inventory) {
          await trx.deleteFrom('inventory_items').where('character_id', '=', r.characterId).execute();
          if (r.inventory.length > 0) {
            await trx
              .insertInto('inventory_items')
              .values(r.inventory.map((e) => ({ character_id: r.characterId, item_id: e.itemId, slot_index: e.slot, is_equipped: e.equipped, quantity: e.quantity ?? 1 })))
              .execute();
          }
        }
      }
    });
  }
}

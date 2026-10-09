import type { Kysely } from 'kysely';
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
      }
    });
  }
}

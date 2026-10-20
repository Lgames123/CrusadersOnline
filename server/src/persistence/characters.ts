import { sql, type Kysely } from 'kysely';
import {
  LEVEL_PREFIX,
  MAX_CHARACTERS,
  NEW_GAME_ACT,
  decodeSpells,
  ITEM_UID,
  encodeSpells,
  sanitizeMods,
  sanitizeStoryState,
  startingInventory,
  type CharacterDetails,
  type CharacterLook,
  type InventoryEntry,
  type ItemCatalog,
  type KnownSpell,
  type SpellId,
  type StoryState,
} from '@crusaders/shared';
import type { DB } from './schema.ts';

export class NameTakenError extends Error {}

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
  mana: number;
  spells: KnownSpell[];
  selectedSpell: SpellId | null;
  story: StoryState;
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
  mana: number;
  maxMana: number;
  spells: KnownSpell[];
  selectedSpell: SpellId | null;
  /** Full inventory replacing the stored one; omitted when unchanged. */
  inventory?: InventoryEntry[];
  /** Arena the character is in. */
  zone?: string;
  /** Clear the saved position (the character spawns at the zone's arrival point). */
  resetPosition?: boolean;
  /** Story progress; omitted = unchanged. */
  story?: StoryState;
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
      .select(['id', 'name', 'zone_id', 'pos_x', 'pos_y', 'pos_z', 'yaw', 'level', 'experience_points', 'gold', 'current_hp', 'current_mana', 'spells', 'selected_spell', 'story'])
      .where('id', '=', characterId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (!r) return null;
    const items = await this.db
      .selectFrom('inventory_items')
      .select(['id', 'item_id', 'slot_index', 'grid_x', 'grid_y', 'is_equipped', 'quantity', 'mods'])
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
      mana: r.current_mana,
      spells: decodeSpells(r.spells),
      selectedSpell: decodeSpells(r.selected_spell ? `${r.selected_spell}:1` : '')[0]?.spell ?? null,
      story: parseStory(r.story),
      inventory: items.map((i) => {
        const mods = sanitizeMods(typeof i.mods === 'string' ? safeJson(i.mods) : i.mods);
        return { slot: i.slot_index, itemId: i.item_id, equipped: i.is_equipped, uid: i.id, ...(i.grid_x !== null && i.grid_y !== null && !i.is_equipped ? { x: i.grid_x, y: i.grid_y } : {}), ...(i.quantity > 1 ? { quantity: i.quantity } : {}), ...(mods ? { mods } : {}) };
      }),
    };
  }

  /** The account's characters for the character screen, oldest first; `catalog` sorts what they wear. */
  async listDetails(accountId: string, catalog: ItemCatalog): Promise<CharacterDetails[]> {
    const rows = await this.db
      .selectFrom('characters')
      .select(['id', 'name', 'level', 'zone_id', 'gold', 'play_seconds', 'last_played_at', 'created_at'])
      .where('account_id', '=', accountId)
      .orderBy('created_at')
      .execute();
    if (rows.length === 0) return [];
    const items = await this.db
      .selectFrom('inventory_items')
      .select(['character_id', 'item_id', 'slot_index', 'is_equipped'])
      .where('character_id', 'in', rows.map((r) => r.id))
      .execute();
    return rows.map((r) => {
      const own = items.filter((i) => i.character_id === r.id).map((i) => ({ slot: i.slot_index, itemId: i.item_id, equipped: i.is_equipped }));
      // A character never saved yet starts with the zone's starting inventory.
      const inv = own.length > 0 ? own : startingInventory();
      const look: CharacterLook = {};
      for (const e of inv) {
        const type = e.equipped ? catalog.get(e.itemId)?.type : undefined;
        if (type === 'weapon' || type === 'shield' || type === 'armor') look[type] = e.itemId;
      }
      return {
        id: r.id,
        name: r.name,
        level: r.level,
        zone: r.zone_id,
        gold: r.gold,
        playSeconds: Number(r.play_seconds),
        lastPlayedAt: r.last_played_at ? new Date(r.last_played_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        look,
      };
    });
  }

  /**
   * A new character starting the new game, unless the account already has MAX_CHARACTERS.
   * Throws NameTakenError when the name is in use (names are unique across accounts).
   */
  async create(accountId: string, name: string): Promise<{ id: string } | 'limit'> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const { count } = await trx
          .selectFrom('characters')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('account_id', '=', accountId)
          .executeTakeFirstOrThrow();
        if (Number(count) >= MAX_CHARACTERS) return 'limit' as const;
        return trx
          .insertInto('characters')
          .values({ account_id: accountId, name, zone_id: `${LEVEL_PREFIX}${NEW_GAME_ACT}` })
          .returning(['id'])
          .executeTakeFirstOrThrow();
      });
    } catch (err) {
      if (/unique|duplicate/i.test((err as Error).message)) throw new NameTakenError('character name already taken');
      throw err;
    }
  }

  /** Deletes a character of `accountId` (its inventory goes with it). False if not theirs. */
  async delete(accountId: string, characterId: string): Promise<boolean> {
    const r = await this.db.deleteFrom('characters').where('id', '=', characterId).where('account_id', '=', accountId).executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  /** Adds a finished session's time in the world. */
  async addPlayTime(characterId: string, seconds: number): Promise<void> {
    await this.db
      .updateTable('characters')
      .set({ play_seconds: sql<number>`play_seconds + ${Math.max(0, Math.round(seconds))}`, last_played_at: new Date() })
      .where('id', '=', characterId)
      .execute();
  }

  async saveStates(records: readonly CharacterPersistRecord[]): Promise<void> {
    if (records.length === 0) return;
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      for (const r of records) {
        await trx
          .updateTable('characters')
          .set({
            pos_x: r.resetPosition ? null : r.x,
            pos_y: r.resetPosition ? null : r.y,
            pos_z: r.resetPosition ? null : r.z,
            ...(r.zone ? { zone_id: r.zone.slice(0, 32) } : {}),
            yaw: r.yaw,
            level: r.level,
            experience_points: r.experience,
            gold: r.gold,
            current_hp: r.hp,
            max_hp: r.maxHp,
            current_mana: r.mana,
            max_mana: r.maxMana,
            spells: encodeSpells(r.spells),
            selected_spell: r.selectedSpell,
            ...(r.story ? { story: JSON.stringify(r.story) } : {}),
            last_saved_at: now,
          })
          .where('id', '=', r.characterId)
          .execute();
        if (r.inventory) {
          await trx.deleteFrom('inventory_items').where('character_id', '=', r.characterId).execute();
          if (r.inventory.length > 0) {
            await trx
              .insertInto('inventory_items')
              .values(r.inventory.map((e) => ({
                // The instance keeps its identity across saves (MMO Stage 1).
                ...(e.uid && ITEM_UID.test(e.uid) ? { id: e.uid } : {}),
                character_id: r.characterId, item_id: e.itemId, slot_index: e.slot, is_equipped: e.equipped, grid_x: e.equipped ? null : e.x ?? null, grid_y: e.equipped ? null : e.y ?? null, quantity: e.quantity ?? 1,
                mods: e.mods ? JSON.stringify(e.mods) : null,
              })))
              .execute();
          }
        }
      }
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseStory(text: string): StoryState {
  try {
    return sanitizeStoryState(JSON.parse(text));
  } catch {
    return sanitizeStoryState(null);
  }
}

/**
 * HTTP account API payloads (server/src/http/api.ts): the realm list and the character screen.
 */

/** Characters an account may have. */
export const MAX_CHARACTERS = 3;

/** Character names: as account names, 3-20 letters, digits or _ (unique, case-insensitive). */
export const CHARACTER_NAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** What a character wears, as item ids (inventory_items.item_id), for the character screen's model. */
export interface CharacterLook {
  weapon?: string;
  shield?: string;
  armor?: string;
}

/** One character on the character screen. */
export interface CharacterDetails {
  id: string;
  name: string;
  level: number;
  /** Arena the character was last in ("level:<act>" or a test arena). */
  zone: string;
  gold: number;
  /** Seconds spent in the world. */
  playSeconds: number;
  /** ISO time the character last left the world, null if never played. */
  lastPlayedAt: string | null;
  createdAt: string;
  look: CharacterLook;
}

export interface CharacterListResponse {
  characters: CharacterDetails[];
  max: number;
}

export type RealmPopulation = 'low' | 'medium' | 'high' | 'full';

/** One entry of the server selection screen. */
export interface RealmInfo {
  id: string;
  name: string;
  /** Rules shown to the player, e.g. "Classic" or "Classic + features". */
  type: string;
  population: RealmPopulation;
  /** Players in the world right now. */
  online: number;
  /** The account's characters on this realm. */
  characters: number;
}

export interface RealmListResponse {
  realms: RealmInfo[];
}

/** Coarse population label for `online` players (shown instead of exact numbers, as MMOs do). */
export function realmPopulation(online: number): RealmPopulation {
  if (online >= 200) return 'full';
  if (online >= 60) return 'high';
  if (online >= 15) return 'medium';
  return 'low';
}

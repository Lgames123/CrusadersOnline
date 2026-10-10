import { SC } from '../opcodes.ts';
import type { ItemType } from '../../game/items.ts';

/** JSON control messages sent by the server. Trusted direction, so plain types (no Zod). */

export interface CharacterSummary {
  id: string;
  name: string;
}

export interface AuthSuccessMsg {
  op: typeof SC.AUTH_SUCCESS;
  d: { accountName: string; characters: CharacterSummary[] };
}

export interface WorldEnterMsg {
  op: typeof SC.WORLD_ENTER;
  d: {
    entityId: number;
    zone: string;
    arena: string;
    serverTick: number;
    spawn: { x: number; y: number; z: number };
  };
}

export type EntityKind = 'player' | 'mob';

export interface EntitySpawnMsg {
  op: typeof SC.ENTITY_SPAWN;
  d: { id: number; kind: EntityKind; name: string; maxHp: number; archetype?: string };
}

/** Sent to the owning player on entry and whenever any of these values change. */
export interface PlayerStatsMsg {
  op: typeof SC.PLAYER_STATS;
  d: { hp: number; maxHp: number; level: number; xp: number; gold: number; dead: boolean };
}

/** Broadcast to players near the target. */
export interface CombatEventMsg {
  op: typeof SC.COMBAT_EVENT;
  d: {
    attacker: number;
    target: number;
    damage: number;
    /** Target HP after the hit. */
    hp: number;
    killed: boolean;
    /** The target's raised shield stopped the hit (damage 0). */
    blocked?: boolean;
    /** Present when the attacker is a player who got rewarded for the kill (loot = item names added). */
    reward?: { xp: number; gold: number; loot?: string[] };
  };
}

/** One inventory slot as shown to its owner, with the item numbers the UI and prediction need. */
export interface InventoryItemView {
  slot: number;
  itemId: string;
  name: string;
  type: ItemType;
  equipped: boolean;
  quantity?: number;
  heal?: number;
  damage?: number[];
  speed?: number;
  protection?: number[];
}

/** Full inventory of the owning player: on entry and after every change. */
export interface InventoryUpdateMsg {
  op: typeof SC.INVENTORY_UPDATE;
  d: { items: InventoryItemView[]; slots: number; weaponSpeed: number };
}

/** World object states (original levels): full list on entry, then changes. */
export type WorldObjectState = 'present' | 'gone' | 'open';
export interface ObjectStateMsg {
  op: typeof SC.OBJECT_STATE;
  d: { objects: { id: number; state: WorldObjectState }[]; full?: boolean };
}

/**
 * The player is (re)entering the world in this arena: the client loads it, then answers
 * CS_ZONE_READY; SC_WORLD_ENTER follows. Sent on login and on every portal transition.
 */
export interface ZoneChangeMsg {
  op: typeof SC.ZONE_CHANGE;
  d: { arena: string };
}

export interface EntityDespawnMsg {
  op: typeof SC.ENTITY_DESPAWN;
  d: { id: number };
}

export interface PongMsg {
  op: typeof SC.PONG;
  d: { clientTime: number; serverTick: number };
}

export interface ErrorMsg {
  op: typeof SC.ERROR;
  d: { code: string; message: string };
}

export type ServerControlMsg =
  | AuthSuccessMsg
  | WorldEnterMsg
  | EntitySpawnMsg
  | EntityDespawnMsg
  | PongMsg
  | ErrorMsg
  | PlayerStatsMsg
  | CombatEventMsg
  | InventoryUpdateMsg
  | ObjectStateMsg
  | ZoneChangeMsg;

/** Animation state ids carried in snapshot `anim`. */
export const ANIM = {
  IDLE: 0,
  RUN: 1,
  WALK: 2,
  AIRBORNE: 3,
  /** ATTACK + combo index (0..2). */
  ATTACK: 4,
  HIT: 7,
  DEAD: 8,
  /** Shield raised. */
  BLOCK: 9,
} as const;

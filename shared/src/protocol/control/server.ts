import { INPUT, SC } from '../opcodes.ts';
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
  /** Walking backwards (ASM_RETREAT; also used for careful backward steps). */
  RETREAT: 10,
  /** Running sidesteps (ASM_SIDE_STEP_L / _R). */
  STRAFE_LEFT: 11,
  STRAFE_RIGHT: 12,
  /** Careful sidesteps (Shift). */
  WALK_STRAFE_LEFT: 13,
  WALK_STRAFE_RIGHT: 14,
  /** Directional attacks (forward / left / right + click); plain clicks use ATTACK + combo. */
  ATTACK_OVERHEAD: 15,
  ATTACK_LEFT: 16,
  ATTACK_RIGHT: 17,
  /** Rolls (C + direction): ROLL + direction - 1 (forward, back, left, right). */
  ROLL: 18,
  /** Ducking (C held). */
  CROUCH: 22,
  /** C + click (ASM_CHOP_LOW) and Space + click (ASM_JUMP_ATTACK). */
  ATTACK_LOW: 23,
  ATTACK_JUMP: 24,
  /** Fourth and fifth swings of the plain-click combo (combo states 103 / 104). */
  ATTACK_COMBO4: 25,
  ATTACK_COMBO5: 26,
  /** Forward hop (ASM_HOP_F): creatures lunge in before swinging. */
  HOP_FORWARD: 27,
} as const;

/** Animation for a character's own movement state (roll, duck, airborne, locomotion, idle). */
export function movementAnim(flags: number, grounded: boolean, rollDir: number): number {
  if (rollDir) return ANIM.ROLL + rollDir - 1;
  if (!grounded) return ANIM.AIRBORNE;
  if (flags & INPUT.DUCK) return ANIM.CROUCH;
  if (flags & INPUT.ROOTED) return ANIM.IDLE;
  return locomotionAnim(flags);
}

export type AttackKind = 'normal' | 'overhead' | 'left' | 'right' | 'low' | 'jump';

/**
 * The original's attack selection, measured in the running game (executable-analysis.md §14):
 * forward (running) or jump + click = ASM_JUMP_ATTACK, left / right + click = side swings;
 * a plain click, and a click while ducking, start the five-swing combo.
 */
export function attackKindFor(flags: number): AttackKind {
  if (flags & (INPUT.JUMP | INPUT.FORWARD)) return 'jump';
  if (flags & INPUT.LEFT && !(flags & INPUT.RIGHT)) return 'left';
  if (flags & INPUT.RIGHT && !(flags & INPUT.LEFT)) return 'right';
  return 'normal';
}

/** Animation code of a swing. */
export function attackAnim(kind: AttackKind, combo: number): number {
  switch (kind) {
    case 'overhead': return ANIM.ATTACK_OVERHEAD;
    case 'left': return ANIM.ATTACK_LEFT;
    case 'right': return ANIM.ATTACK_RIGHT;
    case 'low': return ANIM.ATTACK_LOW;
    case 'jump': return ANIM.ATTACK_JUMP;
    default: return combo >= 5 ? ANIM.ATTACK_COMBO5 : combo === 4 ? ANIM.ATTACK_COMBO4 : ANIM.ATTACK + combo - 1;
  }
}

export function isAttackAnim(anim: number): boolean {
  return (anim >= ANIM.ATTACK && anim < ANIM.ATTACK + 3) || (anim >= ANIM.ATTACK_OVERHEAD && anim <= ANIM.ATTACK_RIGHT) || anim === ANIM.ATTACK_LOW || anim === ANIM.ATTACK_JUMP || anim === ANIM.ATTACK_COMBO4 || anim === ANIM.ATTACK_COMBO5;
}

/**
 * Body yaw offset from the view yaw while moving: on diagonals the character turns into the
 * direction of travel (running) or away from it (retreating), so the run / retreat cycle
 * matches the motion instead of sliding sideways.
 */
export function movementFacingOffset(flags: number): number {
  const fwd = (flags & INPUT.FORWARD ? 1 : 0) - (flags & INPUT.BACK ? 1 : 0);
  const right = (flags & INPUT.RIGHT ? 1 : 0) - (flags & INPUT.LEFT ? 1 : 0);
  if (fwd === 0 || right === 0) return 0;
  return -Math.atan2(fwd * right, 1);
}

/** Ground locomotion animation for held movement flags (IDLE when none). */
export function locomotionAnim(flags: number): number {
  const walk = (flags & INPUT.WALK) !== 0;
  const fwd = (flags & INPUT.FORWARD ? 1 : 0) - (flags & INPUT.BACK ? 1 : 0);
  const right = (flags & INPUT.RIGHT ? 1 : 0) - (flags & INPUT.LEFT ? 1 : 0);
  if (fwd > 0) return walk ? ANIM.WALK : ANIM.RUN;
  if (fwd < 0) return ANIM.RETREAT;
  if (right > 0) return walk ? ANIM.WALK_STRAFE_RIGHT : ANIM.STRAFE_RIGHT;
  if (right < 0) return walk ? ANIM.WALK_STRAFE_LEFT : ANIM.STRAFE_LEFT;
  return ANIM.IDLE;
}

/** Whether an animation code is a ground locomotion cycle. */
export function isLocomotionAnim(anim: number): boolean {
  return anim === ANIM.RUN || anim === ANIM.WALK || (anim >= ANIM.RETREAT && anim <= ANIM.WALK_STRAFE_RIGHT);
}

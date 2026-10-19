import type { DoorMotion } from '../../arena/door_swing.ts';
import type { MoverMotion } from '../../arena/mover.ts';
import type { WorldObjectDef } from '../../arena/types.ts';
import { JUMP_KINDS } from '../../constants.ts';
import { INPUT, SC } from '../opcodes.ts';
import type { SpellId, StatusTag } from '../../game/spells.ts';
import type { DecalKind } from '../../game/decals.ts';
import type { ItemType } from '../../game/items.ts';
import type { GameplayFeatures } from '../../game/features.ts';
import type { QuestLog } from '../../game/story.ts';
import type { Attributes } from '../../game/original_stats.ts';
import type { Difficulty } from '../../game/ruleset.ts';

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
    /** Heading to face (radians, 0 = -Z): the act's start point or the saved one. */
    yaw?: number;
    /** Non-original gameplay features this server has on (features.ts); absent: none. */
    features?: Partial<GameplayFeatures>;
  };
}

export type EntityKind = 'player' | 'mob';

export interface EntitySpawnMsg {
  op: typeof SC.ENTITY_SPAWN;
  /** `placement`: a creature of an original level, its index in the act's placements. */
  d: {
    id: number; kind: EntityKind; name: string; maxHp: number; archetype?: string; placement?: number;
    /** Timed spell effects on it now (their looks), and whether it fights on the players' side (spectral ally). */
    statuses?: StatusTag[];
    ally?: boolean;
    /** Model scale of a creature that is not a level placement (an admin's custom spawn); placements' come from the level. */
    scale?: number;
  };
}

/** Sent to the owning player on entry and whenever any of these values change. */
export interface PlayerStatsMsg {
  op: typeof SC.PLAYER_STATS;
  d: {
    hp: number;
    maxHp: number;
    level: number;
    xp: number;
    gold: number;
    dead: boolean;
    mana: number;
    maxMana: number;
    /** Known spells and their levels, and the one R casts (T cycles). */
    spells: { spell: SpellId; level: number }[];
    spell: SpellId | null;
    /** Torch light around the player: radius in metres (0 = off). */
    light: number;
    /** Timed spell effects on the player and their seconds left. */
    statuses?: { tag: StatusTag; seconds: number }[];
    /** Speed multiplier (stats +0x24C): the rate the character's clips play at, x 1000/30 fps. */
    speed?: number;
    /** Character name, as the statistics screen (F1) heads it. */
    name: string;
    /** Might, Intelligence, Endurance, Speed. */
    attributes: Attributes;
    /** Damage multiplier (stats +0x248). */
    damageMultiplier: number;
    /** Damage-taken multipliers per type (DAMAGE_TYPES order) with the armour's protection (0x44CB60). */
    resist: number[];
    /** The wielded weapon's damage per type (0x46C0D0); zeros unarmed. */
    damage: number[];
  };
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
    /** A weapon blow (landed or stopped): the attacker's weapon is sharp (slash above bash); picks the impact row. */
    sharp?: boolean;
    /** Blocked: the attacker's blade sweep, world x / z (unit); the sparks line up along it. */
    sweep?: [number, number];
    /**
     * A shield rush's roll came up (contact sounds at the attacker). Target = the rusher itself: the
     * rush's own 1 HP cost.
     */
    rush?: boolean;
    /** Rush: this roll put the target into its impact (it reels; later rolls only sound). */
    reel?: boolean;
    /** A creature's long impact (its ASM state id, IMPACT_VARIANTS); absent: the directional one. */
    impact?: number;
    /** Present when the attacker is a player who got rewarded for the kill (its items fall on the ground). */
    reward?: { xp: number; gold: number };
  };
}

type V3 = [number, number, number];

/**
 * What the spell objects show and sound (SC.SPELL_EVENT), each part optional. Positions are
 * world metres; `level` is 1-3 (effects.stg variants level - 1).
 */
export interface SpellEventMsg {
  op: typeof SC.SPELL_EVENT;
  d: {
    /** A cast begins (wind-up effect and sound at the hand; `upper`: on the upper body while moving) or takes effect. */
    cast?: { caster: number; spell: SpellId; level: number; phase: 'begin' | 'release'; upper?: boolean };
    /** effects.stg effects; `entity`: follows that character, `at` relative to its feet. */
    fx?: { name: string; level: number; at: V3; dir?: V3; entity?: number }[];
    /** Sound.ctx sounds; `rate`: playback rate (the bolt's and the explosion's 0.8-1.2, 0x004BF480 / 0x004BE980). */
    sounds?: { id: number; at: V3; rate?: number }[];
    /** A flying spell (fire ball, slow, snap freeze): its state; `end` when it is gone. */
    /** `look`: the effect it carries when not its spell's own (a creature's FIREBALL_PROJ_EVIL). */
    projectile?: { id: number; spell: SpellId; level: number; pos: V3; vel: V3; look?: string; end?: boolean };
    /**
     * The Boomer Axe's thrown axe (type-3 object, 0x0043EAE0): its state (sent at the throw, when it
     * turns back and every few ticks on the curve home); `owner`'s right hand is empty meanwhile.
     * `end` when it is caught (the weapon is back in the hand).
     */
    axe?: { id: number; owner: number; pos: V3; vel: V3; end?: boolean };
    /** A growing area (explosions, holy wrath, revelation): to `radius` over `seconds`; `dark`: a creature's unholy wrath. */
    burst?: { spell: SpellId; level: number; at: V3; radius: number; seconds: number; dark?: boolean };
    /** Lightning bolts. */
    bolts?: { from: V3; to: V3 }[];
    /** Soul drinker: life flowing from one character to another for `seconds` (0 = stop). */
    drain?: { id: number; from: number; to: number; seconds: number; level: number };
    /** A timed effect starts (`seconds` left) or ends on a character. */
    status?: { target: number; tag: StatusTag; on: boolean; seconds?: number; level?: number }[];
    /** A short light (r, g, b 0-255) fading over `seconds`. */
    light?: { at: V3; color: V3; radius: number; seconds: number };
    /** Marks stamped on the level's faces round `at` (scorch, lightning, frost). */
    decals?: { kind: DecalKind; at: V3 }[];
  };
}

/** One inventory slot as shown to its owner, with the item numbers the UI and prediction need. */
export interface InventoryItemView {
  slot: number;
  itemId: string;
  name: string;
  type: ItemType;
  /** Resolved items.ctx dimensions. Optional to keep mixed-version clients compatible. */
  width?: number;
  height?: number;
  /** Original items.ctx Model id, when available. */
  model?: number;
  /** items.ctx Texture index into the model's models.ctx textures (absent = the first). */
  texture?: number;
  /** Origin in the inventory grid (undefined for equipped and pre-migration records). */
  x?: number;
  y?: number;
  equipped: boolean;
  /** A door key: shown on the Key Items page, takes no bag cell, cannot be dropped. */
  keyItem?: boolean;
  quantity?: number;
  heal?: number;
  /** Potions: the cooldown its use starts (seconds) and, while it runs, the seconds left (potionCooldown). */
  cooldown?: number;
  cooldownLeft?: number;

  damage?: number[];
  speed?: number;
  protection?: number[];
  /** Worn: attribute bonus (rings, accessories). */
  attributes?: Partial<Attributes>;
  /** What else it does, as tooltip lines (soul drinking, what a shield also stops, reflection). */
  effects?: string[];
  /** What a merchant pays for it (items.ctx Price × count); absent = it takes no item without a price. */
  value?: number;
}

/** An item a shop offers this visit: its view, its count and its price (Price × count). */
export type ShopItemView = Omit<InventoryItemView, 'slot' | 'equipped' | 'x' | 'y' | 'value'> & { price: number };

/** Full inventory of the owning player: on entry and after every change. */
export interface InventoryUpdateMsg {
  op: typeof SC.INVENTORY_UPDATE;
  d: { items: InventoryItemView[]; slots: number; weaponSpeed: number };
}

/** World object states (original levels): full list on entry, then changes. */
export type WorldObjectState = 'present' | 'gone' | 'open';
export interface ObjectStateMsg {
  op: typeof SC.OBJECT_STATE;
  /**
   * `swing`: a swinging door's motion (opening / held open / closing) as of this message;
   * `mover`: any other mover's (gates, levers...), stepped on from it by the client.
   */
  d: { objects: { id: number; state: WorldObjectState; def?: WorldObjectDef; by?: number; loot?: string[]; damage?: number; hp?: number; swing?: DoorMotion; mover?: MoverMotion }[]; full?: boolean };
}

/**
 * The player is (re)entering the world in this arena: the client loads it, then answers
 * CS_ZONE_READY; SC_WORLD_ENTER follows. Sent on login and on every portal transition.
 */
export interface ZoneChangeMsg {
  op: typeof SC.ZONE_CHANGE;
  /** `difficulty`: the server's, which level placements are there (absent: medium). */
  d: { arena: string; difficulty?: Difficulty };
}

/**
 * A scripted sequence of the player's level starts (story.ts): its name in the act's placements,
 * and the entity playing each of its actors (null: the stand-in for Drake, or not present).
 */
export interface CutsceneMsg {
  op: typeof SC.CUTSCENE;
  d: { sequence: string; actors: (number | null)[] };
}

/** The player's quest book; `news` lists what changed with this message (absent on entry). */
export interface QuestLogMsg {
  op: typeof SC.QUEST_LOG;
  d: { log: QuestLog; news?: { assigned: number[]; completed: number[]; journal: number[] } };
}

/**
 * A message trigger of the player's level fired for them (0x4632B0): `message` is its id in the
 * act's story.messages; the client shows its text for MESSAGE_MS.
 */
export interface StoryMessageMsg {
  op: typeof SC.STORY_MESSAGE;
  d: { message: number };
}

/** A sound trigger fired by a relay (0x461490): Sound.ctx id at each position (metres). */
export interface StorySoundMsg {
  op: typeof SC.STORY_SOUND;
  d: { sound: number; positions: [number, number, number][]; volume: number };
}

/**
 * A shop (cap type 0x1C) opened for this player, or its offer after a trade. `greeting`: the
 * merchant's line (Sound.ctx id), on opening only. `gift`: a reward handed out (every item free,
 * taken once per character, nothing bought).
 */
export interface ShopMsg {
  op: typeof SC.SHOP;
  d: { shop: number; stock: ShopItemView[]; greeting?: number; gift?: boolean };
}

export interface EntityDespawnMsg {
  op: typeof SC.ENTITY_DESPAWN;
  d: { id: number };
}

export interface PongMsg {
  op: typeof SC.PONG;
  d: { clientTime: number; serverTick: number };
}

export type ChatChannel = 'local' | 'global' | 'private' | 'system';
/** What a server (`system`) line reports: the chat tints it by kind. */
/** `admin`: a line from the server's staff (the admin panel), shown on every tab. */
export type ChatNoticeKind = 'loot' | 'gold' | 'xp' | 'level' | 'spell' | 'quest' | 'trade' | 'error' | 'info' | 'admin';

/**
 * A chat line. Players' lines carry `from` (and `to` on private ones, echoed to the sender
 * too); `system` lines are the server telling this player what happened (loot, experience…).
 */
export interface ChatBroadcastMsg {
  op: typeof SC.CHAT_BROADCAST;
  /** `sent`: the sender's own copy of their line. */
  d: { channel: ChatChannel; text: string; from?: string; to?: string; sent?: boolean; kind?: ChatNoticeKind };
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
  | ChatBroadcastMsg
  | PlayerStatsMsg
  | CombatEventMsg
  | InventoryUpdateMsg
  | ObjectStateMsg
  | ZoneChangeMsg
  | CutsceneMsg
  | QuestLogMsg
  | StoryMessageMsg
  | StorySoundMsg
  | ShopMsg
  | SpellEventMsg;

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
  /** Creature jab (ASM_THRUST). */
  ATTACK_THRUST: 28,
  /** Side hops (ASM_HOP_L / _R): sideways movement with the shield up. */
  HOP_LEFT: 29,
  HOP_RIGHT: 30,
  /** Standing still with the shield up: the normal idle; the shield is an upper-body layer. */
  SHIELD_IDLE: 31,
  /** Knocked down (ASM_IMPACT_SEVERE, PI02). */
  KNOCKDOWN: 32,
  /** Stunned (ASM_IMPACT_MEDIUM: no clip of its own). */
  STUNNED: 33,
  /** Shield bash (ASM_RAM_SHOULDER, PL01). */
  ATTACK_BASH: 34,
  /** Casting (ASM_SPELL_CONJURE, before the spell's own state). */
  SPELL_CONJURE: 35,
  /** On the alert (ASM_COMBAT_STANDING): a citizen who just saw an assault, before running off. */
  ALERT: 36,
  /** Talking (ASM_GESTURE_POLITE_CONVERSATION): a peaceful creature gesturing through its line. */
  GESTURE: 37,
  /** Jumps: JUMP + the kind's index in JUMP_KINDS (V, F, running, L, R, B), standing before take-off and in the air. */
  JUMP: 38,
  /** Soft landing (ASM_LAND_SOFT, PD03). */
  LAND_SOFT: 44,
  /** A spell's own state after the conjure (or at once): SPELL_CAST + its index in SPELLS (ASM_SPELL_*). */
  SPELL_CAST: 45,
  /** Drinking a potion (PK12_u_ptn "use potion": models.ctx loads it but binds no state). */
  USE_POTION: 56,
  /** Using mana crystals (PJ01_u_ky "use crystal", ASM_GESTURE_MISC_04). */
  USE_CRYSTAL: 57,
  /** Drawing a weapon / readying a shield just equipped (ASM_READY_WEAPON PP01 / ASM_READY_SHIELD PT01). */
  READY_WEAPON: 58,
  READY_SHIELD: 59,
  /** Pulling up onto a ledge caught in the air (ASM_LOW_MOUNT, PF01). */
  MOUNT_LOW: 60,
} as const;

/** Clip seconds of the item actions (Drake's clips at 30 fps: PK12 60 frames, PJ01 49, PP01 30, PT01 38). */
export const ITEM_ACTION_SECONDS: Readonly<Record<number, number>> = {
  [ANIM.USE_POTION]: 60 / 30,
  [ANIM.USE_CRYSTAL]: 49 / 30,
  [ANIM.READY_WEAPON]: 30 / 30,
  [ANIM.READY_SHIELD]: 38 / 30,
};

/** Animation for a character's own movement state (roll, jump, duck, airborne, locomotion, idle). */
export function movementAnim(flags: number, grounded: boolean, rollDir: number, diagonalMoves = false, airKind = 0): number {
  // A jump's clip plays from its stand before take-off through the flight.
  const jump = JUMP_KINDS.indexOf(airKind);
  if (jump >= 0 && (rollDir === 24 || !grounded)) return ANIM.JUMP + jump;
  if (rollDir === 25) return ANIM.LAND_SOFT;
  if (rollDir === 26) return ANIM.MOUNT_LOW;
  if (rollDir === 5) return ANIM.HOP_LEFT;
  if (rollDir === 6) return ANIM.HOP_RIGHT;
  if (rollDir === 7) return ANIM.SHIELD_IDLE; // stand after a side hop, shield still up
  if (rollDir >= 1 && rollDir <= 4) return ANIM.ROLL + rollDir - 1;
  if (rollDir === 16) return ANIM.HIT; // directional impact (the client picks the side)
  if (rollDir === 17) return ANIM.STUNNED;
  if (rollDir === 18) return ANIM.KNOCKDOWN;
  if (rollDir === 13) return ANIM.ATTACK_BASH; // shield rush
  // rollDir >= 8: an attack's root motion (the attack clip is chosen from the swing).
  if (!grounded) return ANIM.AIRBORNE;
  if (flags & INPUT.DUCK) return ANIM.CROUCH;
  if (flags & INPUT.ROOTED) return ANIM.IDLE;
  if (flags & INPUT.BLOCK) {
    // Shield up: a sideways key hops (it overrides forward / back), forward walks, back retreats.
    const fwd = flags & INPUT.BACK ? -1 : flags & INPUT.FORWARD ? 1 : 0;
    const right = flags & INPUT.LEFT ? -1 : flags & INPUT.RIGHT ? 1 : 0;
    if (!diagonalMoves && right < 0) return ANIM.HOP_LEFT;
    if (!diagonalMoves && right > 0) return ANIM.HOP_RIGHT;
    if (fwd > 0) return ANIM.WALK;
    if (fwd < 0) return ANIM.RETREAT;
    return ANIM.SHIELD_IDLE;
  }
  return locomotionAnim(flags, diagonalMoves);
}

export type AttackKind = 'normal' | 'overhead' | 'left' | 'right' | 'low' | 'jump' | 'thrust' | 'bash' | 'air';

/**
 * Swings the original plays on the upper body only (animation controller layer state 2) while
 * the legs keep their own clip: the side swings (ASM ids 87 / 88, the character keeps moving
 * with the held key) and a click in the air (SWING_LEVEL over the jump / fall). Logged live.
 */
export function isLayeredSwing(kind: AttackKind): boolean {
  return kind === 'left' || kind === 'right' || kind === 'air';
}
/** Entity flags bits 1-2: the layered swing playing (1 left, 2 right, 3 air); bit 3 flips per swing. */
export const UPPER_SWING_CODES: readonly AttackKind[] = ['left', 'right', 'air'];
/** The same bits on a creature: the swing it plays on the upper body during its forward hop. */
export const MOB_UPPER_SWING_CODES: readonly AttackKind[] = ['normal', 'low', 'overhead'];

/**
 * The original's attack selection, measured in the running game (executable-analysis.md §14):
 * forward (running) or jump + click = ASM_JUMP_ATTACK, left / right + click = side swings;
 * a plain click, and a click while ducking, start the five-swing combo.
 */
export function attackKindFor(flags: number, grounded = true): AttackKind {
  // Already in the air: the level swing over the jump (the take-off click is the jump attack).
  if (!grounded) return 'air';
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
    case 'thrust': return ANIM.ATTACK_THRUST;
    case 'bash': return ANIM.ATTACK_BASH;
    case 'air': return ANIM.ATTACK + 1;
    default: return combo >= 5 ? ANIM.ATTACK_COMBO5 : combo === 4 ? ANIM.ATTACK_COMBO4 : ANIM.ATTACK + combo - 1;
  }
}

export function isAttackAnim(anim: number): boolean {
  return (anim >= ANIM.ATTACK && anim < ANIM.ATTACK + 3) || (anim >= ANIM.ATTACK_OVERHEAD && anim <= ANIM.ATTACK_RIGHT) || anim === ANIM.ATTACK_LOW || anim === ANIM.ATTACK_JUMP || anim === ANIM.ATTACK_COMBO4 || anim === ANIM.ATTACK_COMBO5 || anim === ANIM.ATTACK_THRUST || anim === ANIM.ATTACK_BASH;
}

/**
 * Body yaw offset from the view yaw while moving. The original keeps the body on the view
 * heading (a diagonal plays the sidestep); with feature diagonalMoves (not original) the body
 * turns into a diagonal's travel (running) or away from it (retreating).
 */
export function movementFacingOffset(flags: number, diagonalMoves = false): number {
  if (!diagonalMoves) return 0;
  const fwd = (flags & INPUT.FORWARD ? 1 : 0) - (flags & INPUT.BACK ? 1 : 0);
  const right = (flags & INPUT.RIGHT ? 1 : 0) - (flags & INPUT.LEFT ? 1 : 0);
  if (fwd === 0 || right === 0) return 0;
  return -Math.atan2(fwd * right, 1);
}

/**
 * Ground locomotion animation for held movement flags (IDLE when none): as the original's
 * selector (0x42AFC0), a sideways key overrides forward / back (back wins over forward, left
 * over right); feature diagonalMoves keeps the forward / back cycle on diagonals.
 */
export function locomotionAnim(flags: number, diagonalMoves = false): number {
  const walk = (flags & INPUT.WALK) !== 0;
  const fwd = flags & INPUT.BACK ? -1 : flags & INPUT.FORWARD ? 1 : 0;
  const right = flags & INPUT.LEFT ? -1 : flags & INPUT.RIGHT ? 1 : 0;
  if (!diagonalMoves && right > 0) return walk ? ANIM.WALK_STRAFE_RIGHT : ANIM.STRAFE_RIGHT;
  if (!diagonalMoves && right < 0) return walk ? ANIM.WALK_STRAFE_LEFT : ANIM.STRAFE_LEFT;
  if (fwd > 0) return walk ? ANIM.WALK : ANIM.RUN;
  if (fwd < 0) return ANIM.RETREAT;
  if (right > 0) return walk ? ANIM.WALK_STRAFE_RIGHT : ANIM.STRAFE_RIGHT;
  if (right < 0) return walk ? ANIM.WALK_STRAFE_LEFT : ANIM.STRAFE_LEFT;
  return ANIM.IDLE;
}

/** Whether an animation code is a ground locomotion cycle. */
export function isLocomotionAnim(anim: number): boolean {
  return anim === ANIM.RUN || anim === ANIM.WALK || (anim >= ANIM.RETREAT && anim <= ANIM.WALK_STRAFE_RIGHT) || anim === ANIM.HOP_LEFT || anim === ANIM.HOP_RIGHT;
}

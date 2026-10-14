/** Client -> server opcodes (network-protocol.md §2). */
export const CS = {
  AUTH_TICKET: 0x01,
  SELECT_CHARACTER: 0x02,
  PLAYER_INPUT: 0x03,
  PLAYER_ATTACK: 0x04,
  PLAYER_BLOCK: 0x05,
  CAST_SPELL: 0x06,
  INTERACT: 0x07,
  CHAT_MESSAGE: 0x08,
  PING: 0x09,
  EQUIP_ITEM: 0x0a,
  USE_ITEM: 0x0b,
  ZONE_READY: 0x0c,
  SELECT_SPELL: 0x0d,
  /** The client finished playing a scripted sequence (or skipped it). */
  CUTSCENE_DONE: 0x0e,
  /** Move one carried item to a grid origin. */
  MOVE_INVENTORY_ITEM: 0x0f,
  MERGE_INVENTORY_STACK: 0x10,
  SPLIT_INVENTORY_STACK: 0x11,
  /** Drop one carried item to the ground. */
  DROP_INVENTORY_ITEM: 0x12,
} as const;

/** Server -> client opcodes. */
export const SC = {
  AUTH_SUCCESS: 0x40,
  WORLD_ENTER: 0x41,
  WORLD_SNAPSHOT: 0x42,
  ENTITY_SPAWN: 0x43,
  ENTITY_DESPAWN: 0x44,
  COMBAT_EVENT: 0x45,
  INVENTORY_UPDATE: 0x46,
  CHAT_BROADCAST: 0x47,
  PONG: 0x48,
  PLAYER_STATS: 0x49,
  OBJECT_STATE: 0x4a,
  ZONE_CHANGE: 0x4b,
  /** A scripted sequence starts for this player (the client plays it). */
  CUTSCENE: 0x4c,
  /** The player's quest book. */
  QUEST_LOG: 0x4d,
  ERROR: 0x4f,
} as const;

/** Input flag bits carried in CS_PLAYER_INPUT. */
export const INPUT = {
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  WALK: 1 << 5,
  /** Shield raised (held). Does not affect movement, so prediction is unchanged. */
  BLOCK: 1 << 6,
  /**
   * The player's own swing is playing: no ground movement this step (the original plants the
   * feet while attacking). Set by the client from its swing; it only ever restricts the sender.
   */
  ROOTED: 1 << 7,
  /** Crouch / duck (C held). Second flags byte. */
  DUCK: 1 << 8,
  /** Roll in the held direction (C pressed with a direction; latched like JUMP). */
  ROLL: 1 << 9,
} as const;

/**
 * Bits 10-13: the root motion of an attack starting this step (attackMotion(), 0 = none). Sent
 * on the swing's first step only; the shared movement step then follows the clip's curve.
 */
export const INPUT_ATTACK_SHIFT = 10;
export const INPUT_ATTACK_MASK = 0xf << INPUT_ATTACK_SHIFT;

export const INPUT_VALID_MASK = 0b11_1111_1111_1111;

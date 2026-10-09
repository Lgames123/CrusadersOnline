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
} as const;

export const INPUT_VALID_MASK = 0b0011_1111;

import { z } from 'zod';
import { CS } from '../opcodes.ts';

/** JSON control messages (network-protocol.md §4). Hot-path messages are binary, see ../binary. */

export const AuthTicketPacketSchema = z.object({
  op: z.literal(CS.AUTH_TICKET),
  seq: z.number().int().nonnegative(),
  d: z.object({
    ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), // base64url, 32 random bytes
  }),
});

export const SelectCharacterPacketSchema = z.object({
  op: z.literal(CS.SELECT_CHARACTER),
  seq: z.number().int().nonnegative(),
  d: z.object({
    characterId: z.uuid(),
  }),
});

export const PlayerAttackPacketSchema = z.object({
  op: z.literal(CS.PLAYER_ATTACK),
  seq: z.number().int().positive(),
  d: z.object({
    comboIndex: z.number().int().min(1).max(3),
    clientTick: z.number().int().nonnegative(),
    /** Attack chosen by the movement key held with the click (original controls). */
    kind: z.enum(['normal', 'overhead', 'left', 'right', 'low', 'jump', 'thrust', 'air']).optional(),
  }),
});

export const ChatMessagePacketSchema = z.object({
  op: z.literal(CS.CHAT_MESSAGE),
  seq: z.number().int().positive(),
  d: z.object({
    channel: z.enum(['local', 'global']),
    text: z.string().trim().min(1).max(256),
  }),
});

export const PingPacketSchema = z.object({
  op: z.literal(CS.PING),
  seq: z.number().int().nonnegative(),
  d: z.object({ clientTime: z.number() }),
});

export const EquipItemPacketSchema = z.object({
  op: z.literal(CS.EQUIP_ITEM),
  seq: z.number().int().positive(),
  d: z.object({
    slot: z.number().int().min(0).max(31),
    equip: z.boolean(),
  }),
});

export const InteractPacketSchema = z.object({
  op: z.literal(CS.INTERACT),
  seq: z.number().int().positive(),
  d: z.object({ object: z.number().int().min(0).max(1_000_000) }),
});

export const UseItemPacketSchema = z.object({
  op: z.literal(CS.USE_ITEM),
  seq: z.number().int().positive(),
  d: z.object({ slot: z.number().int().min(0).max(31) }),
});

export const ZoneReadyPacketSchema = z.object({
  op: z.literal(CS.ZONE_READY),
  seq: z.number().int().positive(),
  d: z.object({ arena: z.string().min(1).max(64) }),
});

export const ClientControlPacketSchema = z.discriminatedUnion('op', [
  AuthTicketPacketSchema,
  SelectCharacterPacketSchema,
  PlayerAttackPacketSchema,
  EquipItemPacketSchema,
  InteractPacketSchema,
  UseItemPacketSchema,
  ZoneReadyPacketSchema,
  ChatMessagePacketSchema,
  PingPacketSchema,
]);

export type ClientControlPacket = z.infer<typeof ClientControlPacketSchema>;

/** Maximum accepted size of a JSON control frame, bytes. */
export const CONTROL_MAX_BYTES = 4096;

export function parseClientControl(text: string): ClientControlPacket | null {
  if (text.length > CONTROL_MAX_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = ClientControlPacketSchema.safeParse(raw);
  return r.success ? r.data : null;
}

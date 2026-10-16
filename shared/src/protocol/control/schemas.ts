import { z } from 'zod';
import { CS } from '../opcodes.ts';
import { SPELLS } from '../../game/spells.ts';

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

const ItemIdSchema = z.string().min(1).max(64);

export const EquipItemPacketSchema = z.object({
  op: z.literal(CS.EQUIP_ITEM),
  seq: z.number().int().positive(),
  d: z.object({
    slot: z.number().int().min(0).max(63),
    equip: z.boolean(),
    /** The item the client believes is in `slot`: a stale request for another item is refused. */
    itemId: ItemIdSchema.optional(),
    /** Unequipping: the bag cell to put it in (must be free). */
    x: z.number().int().min(0).max(7).optional(),
    y: z.number().int().min(0).max(5).optional(),
  }),
});

export const MoveInventoryItemPacketSchema = z.object({
  op: z.literal(CS.MOVE_INVENTORY_ITEM),
  seq: z.number().int().positive(),
  d: z.object({ slot: z.number().int().min(0).max(63), x: z.number().int().min(0).max(7), y: z.number().int().min(0).max(5), itemId: ItemIdSchema.optional() }),
});

export const MergeInventoryStackPacketSchema = z.object({
  op: z.literal(CS.MERGE_INVENTORY_STACK),
  seq: z.number().int().positive(),
  d: z.object({ fromSlot: z.number().int().min(0).max(63), toSlot: z.number().int().min(0).max(63) }),
});

export const SplitInventoryStackPacketSchema = z.object({
  op: z.literal(CS.SPLIT_INVENTORY_STACK),
  seq: z.number().int().positive(),
  d: z.object({ slot: z.number().int().min(0).max(63), quantity: z.number().int().min(1).max(98) }),
});

export const DropInventoryItemPacketSchema = z.object({
  op: z.literal(CS.DROP_INVENTORY_ITEM),
  seq: z.number().int().positive(),
  d: z.object({ slot: z.number().int().min(0).max(63), itemId: ItemIdSchema.optional() }),
});

export const InteractPacketSchema = z.object({
  op: z.literal(CS.INTERACT),
  seq: z.number().int().positive(),
  /** `talk`: talking to a peaceful creature (`object` is then its entity id) for that many ms (its line). */
  d: z.object({ object: z.number().int().min(0).max(10_000_000), key: z.boolean().optional(), talk: z.number().int().min(0).max(20_000).optional() }),
});

export const UseItemPacketSchema = z.object({
  op: z.literal(CS.USE_ITEM),
  seq: z.number().int().positive(),
  d: z.object({ slot: z.number().int().min(0).max(63) }),
});

export const CastSpellPacketSchema = z.object({
  op: z.literal(CS.CAST_SPELL),
  seq: z.number().int().positive(),
  d: z.object({}),
});

export const SelectSpellPacketSchema = z.object({
  op: z.literal(CS.SELECT_SPELL),
  seq: z.number().int().positive(),
  d: z.object({ spell: z.enum(SPELLS) }),
});

export const ZoneReadyPacketSchema = z.object({
  op: z.literal(CS.ZONE_READY),
  seq: z.number().int().positive(),
  d: z.object({ arena: z.string().min(1).max(64) }),
});

export const CutsceneDonePacketSchema = z.object({
  op: z.literal(CS.CUTSCENE_DONE),
  seq: z.number().int().positive(),
  d: z.object({ sequence: z.string().min(1).max(64) }),
});

export const ClientControlPacketSchema = z.discriminatedUnion('op', [
  AuthTicketPacketSchema,
  SelectCharacterPacketSchema,
  PlayerAttackPacketSchema,
  EquipItemPacketSchema,
  MoveInventoryItemPacketSchema,
  MergeInventoryStackPacketSchema,
  SplitInventoryStackPacketSchema,
  DropInventoryItemPacketSchema,
  InteractPacketSchema,
  UseItemPacketSchema,
  ZoneReadyPacketSchema,
  CastSpellPacketSchema,
  SelectSpellPacketSchema,
  ChatMessagePacketSchema,
  PingPacketSchema,
  CutsceneDonePacketSchema,
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

# Network Protocol: Opcodes, Packets & Schemas

## 1. Protocol Architecture & Framing

Communication occurs over full-duplex WebSockets (ADR-004). Two encodings share one socket:

| Class | Encoding | Validation | Used for |
|---|---|---|---|
| **Hot path** | Binary WebSocket frame (`ArrayBuffer`) | Structural decode (length, ranges, finite floats) in `shared/src/protocol/binary/` | `CS_PLAYER_INPUT`, `SC_WORLD_SNAPSHOT` |
| **Control** | Text WebSocket frame (JSON) | Zod schemas in `shared/src/protocol/control/` | Auth, character select, inventory, chat, interaction, errors |

The frame type (binary vs text) tells the receiver which decoder to use. Binary frames start with a 1-byte opcode. JSON frames follow:
```json
{
  "op": <OPCODE_NUMBER>,
  "seq": <SEQUENCE_NUMBER>,
  "d": <PAYLOAD_OBJECT>
}
```

All game code talks to a `Transport` interface (`send(bytes|object)`, `onMessage`, `close`), never to `ws` directly, so the transport can later be replaced (uWebSockets.js, WebTransport).

---

## 2. Opcode Table

### Client to Server (C -> S: `0x00` - `0x3F`)
| Opcode | Name | Encoding | Description |
|---|---|---|---|
| `0x01` | `CS_AUTH_TICKET` | JSON | Redeem single-use WebSocket ticket (ADR-008) |
| `0x02` | `CS_SELECT_CHARACTER`| JSON | Select character to enter the world |
| `0x03` | `CS_PLAYER_INPUT` | **Binary** | Input frame(s): flags, yaw, pitch, client tick — **no positions** (ADR-006) |
| `0x04` | `CS_PLAYER_ATTACK` | JSON | Trigger weapon attack action |
| `0x05` | `CS_PLAYER_BLOCK` | JSON | Raise or lower shield |
| `0x06` | `CS_CAST_SPELL` | JSON | Trigger spellcast with aim direction |
| `0x07` | `CS_INTERACT` | JSON | Interact with chest, door, NPC, or item drop |
| `0x08` | `CS_CHAT_MESSAGE` | JSON | Send local or global chat text |
| `0x09` | `CS_PING` | JSON | Latency measurement heartbeat |
| `0x0A` | `CS_EQUIP_ITEM` | JSON | `{ slot: 0..31, equip: boolean }` — equip or unequip an inventory slot (deferred to the end of a swing in progress) |

### Server to Client (S -> C: `0x40` - `0x7F`)
| Opcode | Name | Encoding | Description |
|---|---|---|---|
| `0x40` | `SC_AUTH_SUCCESS` | JSON | Authentication acknowledged, character list sent |
| `0x41` | `SC_WORLD_ENTER` | JSON | Player spawned; zone id, entity id, full initial state |
| `0x42` | `SC_WORLD_SNAPSHOT` | **Binary** | 20Hz interest-filtered entity state, delta-compressed |
| `0x43` | `SC_ENTITY_SPAWN` | JSON | New player, mob, or drop entered interest area (static data: model, name) |
| `0x44` | `SC_ENTITY_DESPAWN`| JSON | Entity exited interest area or died |
| `0x45` | `SC_COMBAT_EVENT` | JSON | Damage dealt, missed, flinch, or death trigger |
| `0x46` | `SC_INVENTORY_UPDATE`| JSON | Full inventory of the owner: `{ items: [{ slot, itemId, name, type, equipped, damage?, speed?, protection? }], slots, weaponSpeed }`, on entry and after every change |
| `0x47` | `SC_CHAT_BROADCAST` | JSON | Incoming chat message |
| `0x48` | `SC_PONG` | JSON | Heartbeat response with server timestamp |
| `0x4F` | `SC_ERROR` | JSON | Rejection reason (insufficient mana, invalid target) |

---

## 3. Binary Hot-Path Layouts (`shared/src/protocol/binary/`)

All multi-byte values little-endian. Angles quantized to `uint16` (`angle / 2π × 65536`).

### 3.1 `CS_PLAYER_INPUT` (client → server, sent every client tick)
To tolerate packet loss on reconnect bursts, each packet carries the last up to 3 input frames (redundancy).
```
offset  size  field
0       1     opcode (0x03)
1       1     frameCount (1..3)
2       4     ackSnapshotTick (uint32) — last snapshot the client applied
--- repeated frameCount times (10 bytes each) ---
+0      4     clientTick (uint32)
+4      1     inputFlags (bit0 W, bit1 S, bit2 A, bit3 D, bit4 Jump, bit5 Walk, bit6 Block (held), bit7 reserved)
+5      1     reserved
+6      2     yaw   (uint16 quantized)
+8      2     pitch (uint16 quantized)
```
Server rules: at most one input applied per server tick per player (extras queued up to a small cap, then dropped); unknown flag bits → packet dropped; frames with `clientTick` already applied are ignored.

### 3.2 `SC_WORLD_SNAPSHOT` (server → client, every tick)
```
0       1     opcode (0x42)
1       4     serverTick (uint32)
5       4     baselineTick (uint32) — 0 = full snapshot, otherwise delta vs this acked tick
9       4     lastProcessedInput (uint32) — for client reconciliation
13      4     selfVelY (int32, mm/s) — receiver's own vertical velocity (replay mid-jump)
17      1     selfFlags (bit0 grounded; other bits must be 0)
18      2     entityCount (uint16)
--- per entity ---
+0      4     entityId (uint32)
+4      1     changedMask (bit0 pos, bit1 yaw, bit2 anim, bit3 hp, bit4 flags)
+...          pos: 3 × int32 (millimetres) | yaw: uint16 | anim: uint8 state + uint8 phase | hp: uint16 | flags: uint8
--- trailer ---
+0      2     removedCount (uint16)
+2      4×n   removed entity ids (uint32) — present in the baseline, absent now
```
Only fields set in `changedMask` are present; with a baseline, unchanged entities are omitted entirely. Entities new to the client must be sent with all fields. Because the shared movement step snaps position (mm) and vertical velocity (mm/s) to wire resolution every tick, a client that resets to the snapshot (position + `selfVelY` + grounded) and replays its unacknowledged inputs reproduces the server's result exactly. Delta baseline is the last snapshot the client acknowledged via `ackSnapshotTick`; if the baseline is too old (> 1 s), the server sends a full snapshot.

### 3.3 Codec API
```typescript
export interface InputFrame { clientTick: number; flags: number; yaw: number; pitch: number; }

export function encodeInput(view: DataView, ackSnapshotTick: number, frames: readonly InputFrame[]): number; // returns byte length
export function decodeInput(view: DataView, out: InputFrame[]): { ackSnapshotTick: number; count: number } | null; // null = malformed
```
Decoders write into caller-provided preallocated objects (zero allocation on the server tick path) and return `null` on any structural violation.

---

## 4. Control Message Schemas (`shared/src/protocol/control/`)

```typescript
import { z } from 'zod';

export const AuthTicketPacketSchema = z.object({
  op: z.literal(0x01),
  seq: z.number().int().nonnegative(),
  d: z.object({
    ticket: z.string().length(43) // base64url, 32 random bytes
  })
});

export const PlayerAttackPacketSchema = z.object({
  op: z.literal(0x04),
  seq: z.number().int().positive(),
  d: z.object({
    comboIndex: z.number().int().min(1).max(3),
    clientTick: z.number().int().nonnegative()
  })
});
```
Note: attack packets carry **no target and no damage**; the server resolves hits with Rapier queries at the corresponding tick.

---

## 5. Reconnection & Disconnect Recovery

1. If the WebSocket disconnects, the client retains state and initiates exponential backoff reconnect attempts (1s, 2s, 4s, 8s, max 15s).
2. Each reconnect requests a fresh WebSocket ticket using the still-valid session cookie (`POST /api/ws-ticket`).
3. The server keeps the disconnected character entity in the world for a 15-second grace window (combat-logging protection).
4. On reconnect, the server sends `SC_WORLD_ENTER` with a full snapshot (baseline reset) and the client clears its input history.

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
| `0x04` | `CS_PLAYER_ATTACK` | JSON | Trigger weapon attack action; `kind` normal (combo) / overhead / left / right / low / jump / thrust (wall jab) / air, from the movement key held with the click (an unknown kind is malformed and disconnects) |
| `0x05` | `CS_PLAYER_BLOCK` | JSON | Raise or lower shield |
| `0x06` | `CS_CAST_SPELL` | JSON | `{}`: conjure the selected spell (server checks state and mana; 1.54 s ASM_SPELL_CONJURE, the client roots itself meanwhile) |
| `0x07` | `CS_INTERACT` | JSON | Interact with chest, door, NPC, or item drop: `{ object, key? }` (`key`: unlock a locked door with the key carried) |
| `0x08` | `CS_CHAT_MESSAGE` | JSON | Send local or global chat text |
| `0x09` | `CS_PING` | JSON | Latency measurement heartbeat |
| `0x0B` | `CS_USE_ITEM` | JSON | `{ slot }`, drink a potion |
| `0x0C` | `CS_ZONE_READY` | JSON | `{ arena }`, the arena announced by SC_ZONE_CHANGE is loaded |
| `0x0D` | `CS_SELECT_SPELL` | JSON | `{ spell }`, a known spell becomes the one CS_CAST_SPELL casts |
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
| `0x49` | `SC_PLAYER_STATS` | JSON | Own HP, level, XP, gold, death; mana / max mana, known spells (level), the selected spell, the torch light radius (m, 0 = off) |
| `0x4A` | `SC_OBJECT_STATE` | JSON | World object states (items, chests, breakables): full list on entry, then changes |
| `0x4B` | `SC_ZONE_CHANGE` | JSON | `{ arena }`: load this arena, answer CS_ZONE_READY; SC_WORLD_ENTER follows (login and every portal) |
| `0x46` | `SC_INVENTORY_UPDATE`| JSON | Full inventory of the owner: `{ items: [{ slot, itemId, name, type, equipped, damage?, speed?, protection? }], slots, weaponSpeed }`, on entry and after every change |
| `0x47` | `SC_CHAT_BROADCAST` | JSON | Incoming chat message |
| `0x48` | `SC_PONG` | JSON | Heartbeat response with server timestamp |
| `0x4F` | `SC_ERROR` | JSON | Rejection reason (insufficient mana, invalid target) |
| `0x53` | `SC_ENDING` | JSON | `{ at, yaw, first }`: Necros fell and this player hurt him; play his death timeline (ending.ts); the ending act (Cs5b) loads 10.5 s later |
| `0x54` | `SC_ENTITY_FADE` | JSON | `{ id, seconds }`: fade that entity out (the ending's cast leaving); its despawn follows |

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
+4      1     inputFlags (bit0 W, bit1 S, bit2 A, bit3 D, bit4 Jump, bit5 Walk, bit6 Block (held), bit7 Rooted — own swing playing, no ground movement; set by the client, it only restricts the sender. Gap: a modified client could omit it to move while attacking; a server-side swing-window check is pending)
+5      1     inputFlags2 (bit0 Duck (C held), bit1 Roll (C pressed with a direction, latched), bits2-5 attack motion starting this step (0 none, 1 combo step 1, 2 combo step 3, 3 combo step 5, 4 jump attack; sent on the swing's first step); other bits must be 0)
+6      2     yaw   (uint16 quantized)
+8      2     pitch (uint16 quantized)
```
Server rules: at most one input applied per server tick per player (extras queued up to a small cap, then dropped); unknown flag bits → packet dropped; frames with `clientTick` already applied are ignored.

### 3.2 `SC_WORLD_SNAPSHOT` (server → client, every tick)
```
0       1     opcode (0x42)
1       4     serverTick (uint32)
5       1     baselineAge (uint8) — 0 = full snapshot, otherwise delta vs serverTick - baselineAge (an acked tick)
6       4     lastProcessedInput (uint32) — for client reconciliation
10      1     selfBits: bit0 grounded; bits1-5 timed movement action (0 none, 1-4 roll forward / back / left / right, 5/6 shield side hop left / right, 7 stand after a hop, 8-11 attack root motion, 16 impact / 17 stun / 18 knock-down); bit6 jump block follows; bit7 selfVelY follows
11      1     selfRollTicks (uint8) — ticks left of the receiver's timed action (replay mid-action)
12      1     selfLocoState (uint8) — locomotion clip state (0 standing)
13      1     selfLocoFrame (uint8, quarter frames)
14      2     entityCount (uint16)
16      4     selfVelY (int32, mm/s) — only with bit7: receiver's own vertical velocity (replay mid-jump)
+0     13     jump block, only with bit6: selfAirKind uint8 (0 none, else its JUMP_* state), selfAirVelX int32 (mm/s), selfAirVelZ int32, selfAirTravel uint16 (mm since take-off), selfAirRise uint16 (mm)
--- per entity ---
+0    1-5     entityId (unsigned LEB128 varint)
+n      1     mask: bit0 pos, bit1 yaw, bit2 anim, bit3 hp, bit4 flags (the fields present);
              bits5-6 update interval code (1, 2, 4, 8 ticks); bit7 pos is a delta
              flags: bit0 shield up; bits1-2 upper-body swing (1 left, 2 right, 3 air); bit3 swing parity; bits4-5 torch light level (0 off)
+...          pos: 3 × int32 (millimetres), or with bit7 3 × int16 (mm from the baseline's) | yaw: uint16 | anim: uint8 state + uint8 phase | hp: uint16 | flags: uint8
--- trailer ---
+0      2     removedCount (uint16)
+2   1-5×n    removed entity ids (varint) — present in the baseline, absent now
```
Only fields set in the mask are present; an entity left out decodes as the baseline's value. Entities new to the client must be sent with all fields and absolute positions. Because the shared movement step snaps position (mm) and vertical velocity (mm/s) to wire resolution every tick, a client that resets to the snapshot (position + `selfVelY` + grounded) and replays its unacknowledged inputs reproduces the server's result exactly. Delta baseline is the last snapshot the client acknowledged via `ackSnapshotTick`; if the baseline is too old (> 1 s), the server sends a full snapshot. A standing receiver's header is 16 bytes (33 at most).

**Per-receiver update rates** (bandwidth, `performance-testing.md` §3). The receiver's own entity goes out whenever it differs from the baseline. Another entity goes out only when it changed since it was last written to that receiver and its interval (`updateInterval(rank, distance)`) has run, or at once when its HP changed:
- every tick: the nearest eight, and anything within 4 m;
- then every 2, 4 and 8 ticks by distance rank (ranks 8, 16 and 24 and beyond);
- beyond 40 m at least every 4 ticks, and beyond 52 m every 8.

A rate-limited entity decodes as the (older) baseline value, so the client draws only the entities written in the snapshot (`decodeSnapshot`'s `sent`), not the decoded map. It draws a rate-limited entity (interval − 1) ticks further back, easing that delay when the rate changes, and it holds a still entity's last sample until one interval before its next one.

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

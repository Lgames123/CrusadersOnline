# Security: Cheating Prevention, Input Validation & Authorization

## 1. Threat Posture: The Untrusted Browser

In web gaming, the browser is an entirely hostile, untrusted environment. Players can inspect source code, alter runtime memory, inject WebSocket packets, modify delta times, and execute automated bot scripts.

**Core Rule:** Never trust data originating from the client. Every incoming packet is validated for structure (binary codec decode, or Zod for control messages), rate limits, range bounds, and game rule consistency.

---

## 2. Specific Attack Vectors & Mitigations

### 2.1 Speed Hacking & Teleportation
- **Attack:** Modifying player speed variables, sending accelerated input streams, or injecting coordinates.
- **Server Defense:** Input-only movement (ADR-006). The protocol has no position field; the server simulates every player with the shared Rapier controller using server-side stats. At most one input frame is applied per tick per player, so sending inputs faster does not move a character faster. Local client modifications only desynchronize that client's prediction, which is corrected by the next snapshot.

### 2.2 Combat Damage Manipulation
- **Attack:** Sending custom damage payloads (e.g. "I hit Drake for 9999 damage").
- **Server Defense:** The client packet `CS_PLAYER_ATTACK` contains *zero damage numbers*. The server looks up the player's equipped weapon, executes the damage formula using server-side stats, and applies the damage authoritative.

### 2.3 Packet Flooding & Denial of Service
- **Attack:** Flooding thousands of WebSocket packets per second.
- **Server Defense:** Token-bucket rate limiter per connection:
  - Movement: Max 25 packets/sec.
  - Actions (Attack/Interact): Max 5 packets/sec.
  - Chat: Max 1 message/2 sec.
  - Exceeding the bucket closes the socket with close code `1008` (Policy Violation).

### 2.4 Authentication & Session Security (ADR-008)
- Passwords hashed with argon2id (minimum m=19 MiB, t=2, p=1).
- Login issues an opaque, random session ID in an `HttpOnly; Secure; SameSite=Strict` cookie, backed by the `sessions` table (server-side expiry, revocable on logout/ban).
- The game socket is authenticated by a single-use, 30-second ticket from `POST /api/ws-ticket`, redeemed in the first WebSocket message. Tickets never appear in URLs or logs.
- Login, registration and ticket endpoints are rate-limited per IP and per account.
- Database access goes through Kysely (parameterized by construction) to prevent SQL injection.

# Milestone 06: Authoritative Multiplayer Server

## 1. Objective
Build the authoritative Node.js server: WebSocket gateway on the main thread, one zone worker running a fixed 20Hz loop, input-driven movement with the shared controller, and interest-filtered binary snapshots.

## 2. Prerequisites
- Milestone 04 and 05 complete.
- `ws` and `pino` configured in `server/`.

## 3. Implementation Steps
1. Implement `server/src/network/transport.ts` (`Transport` interface) and `gateway.ts` (`ws` implementation) on the main thread.
2. Implement `server/src/zone/worker.ts` hosting a `WorldZone` in a `worker_thread`; main ↔ worker messages use transferable `ArrayBuffer`s.
3. Implement `server/src/simulation/clock.ts` (monotonic `performance.now()` accumulator, see engine-design §2).
4. Apply at most one queued input per player per tick through `stepCharacter()`; no client positions are accepted.
5. Encode per-client delta snapshots (`SC_WORLD_SNAPSHOT`) including `lastProcessedInput`.
6. Client: prediction + reconciliation (input ring buffer, replay on snapshot).

## 4. Acceptance Criteria
- [ ] Server sustains a fixed 20Hz tick with p99 tick duration < 10ms for the arena.
- [ ] Accelerated or forged input streams never move a character faster than the controller allows.
- [ ] Client prediction converges with server positions (no visible correction under normal play on localhost).

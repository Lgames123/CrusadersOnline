# World Simulation: Authoritative Movement & Interest Management

## 1. Objective

Specify the server-authoritative world simulation, entity lifecycle, spatial interest management, and movement authority.

---

## 2. World Simulation Architecture

The simulation runs at **20 Hz (50ms ticks)** on the server. Each world zone runs in its **own `worker_thread`** (ADR-009) and is represented by a `WorldZone` instance managing:
1. A Rapier collision world built from level geometry (trimesh colliders from converted `.msh` data or the synthetic arena) — ADR-005.
2. Connected player entity pool (kinematic capsules driven by the shared character controller).
3. Active enemy and NPC spawn managers.
4. Loot and interactive trigger volumes (Rapier sensors).
5. 2D Spatial Hash Grid (32m × 32m cell resolution) for interest management.

The main thread owns HTTP, WebSocket I/O and routing; it forwards decoded input frames to the zone worker and relays encoded snapshots back, using transferable `ArrayBuffer`s.

---

## 3. Interest Management: The Spatial Horizon

To prevent sending every world entity to every connected player (which would overwhelm bandwidth and leak player positions to radar cheats), the server uses **Interest Management**:

```typescript
export function collectInterest(
  playerX: number,
  playerZ: number,
  spatialGrid: SpatialHashGrid,
  out: number[] // preallocated, reused every tick
): number {
  // Query 64m radius (roughly 5x5 cells in a 32m grid)
  return spatialGrid.queryRadius(playerX, playerZ, 64, out);
}
```
Snapshots are then encoded per client as deltas against that client's last acknowledged baseline ([network-protocol.md](network-protocol.md) §3.2).

---

## 4. Movement Authority (ADR-006)

The client never sends positions. Each tick, for every player:
1. **Input selection:** Take the next queued input frame (`inputFlags`, `yaw`, `pitch`, `clientTick`). If none arrived, repeat the last input (with a decay to idle after a few ticks). At most **one** input is applied per tick; the queue is capped, excess frames are dropped.
2. **Input sanity:** Unknown flag bits, non-monotonic `clientTick`, or malformed frames → frame discarded (and counted toward the rate limiter).
3. **Shared movement step:** `stepCharacter(world, character, input, dt)` from `shared/src/movement/` computes desired velocity from stats (run speed, jump impulse, gravity), then Rapier's `KinematicCharacterController` resolves collisions, slopes, steps and ground snapping.
4. **Result:** The resulting position is authoritative. It is included in the next snapshot along with `lastProcessedInput` so the client can reconcile.

Because positions are computed only on the server from bounded inputs, speedhacks, teleports, flying and wall-clipping are not possible by construction. There is no "speed clamp" tolerance window to tune.

### 4.1 Client Prediction & Reconciliation
1. The client runs the same `stepCharacter` locally for each input it sends and stores the input in a ring buffer.
2. On each snapshot, the client resets its local player to the authoritative position at `lastProcessedInput`, then replays all newer inputs from the buffer.
3. Small residual errors (cross-engine float differences) are smoothed visually over ~100ms; large errors snap.

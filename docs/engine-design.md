# Engine Design: Simulation, Game Loop & Spatial Indexing

## 1. Engine Architecture & Fixed Tick Model

To ensure deterministic physics and synchronization between connected browser clients, CrusadersOnline employs a **Fixed-Tick Authoritative Simulation Loop** decoupled from variable rendering frame rates.

```
+-------------------------------------------------------------------------------+
|                       SERVER ENGINE LOOP (20 HZ / 50ms)                       |
+-------------------------------------------------------------------------------+
| 1. Ingest Inbound Client Packets (Input queues)                                |
| 2. Advance Spatial Hash Grid (Reindex moving entities)                        |
| 3. Tick Environmental Hazards & AI State Machines (Chasing, Patrol, Attacks)   |
| 4. Apply Player Inputs via Shared Controller; Resolve Melee Hits (Rapier)      |
| 5. Apply Status Effects, Buffs, and Health Regeneration                        |
| 6. Generate State Snapshots for Interest-Filtered Clients                     |
| 7. Transmit Outbound WebSocket Packets (20Hz broadcast)                       |
+-------------------------------------------------------------------------------+
```

---

## 2. Timing Model & Accumulator

The loop uses a monotonic clock (`performance.now()`), never `Date.now()` (wall clock, can jump) and never a bare `setInterval(fn, 50)` (millisecond jitter on Windows and under load accumulates drift). A coarse `setTimeout` wakes the loop slightly early; the accumulator decides how many fixed steps to run.

```typescript
import { performance } from 'node:perf_hooks';

export class SimulationClock {
  private readonly stepMs = 1000 / 20; // 50 ms
  private lastTime = performance.now();
  private accumulator = 0;
  public tick = 0;

  public start(step: (dt: number, tick: number) => void): void {
    const loop = () => {
      const now = performance.now();
      this.accumulator += Math.min(now - this.lastTime, 250); // clamp spiral of death
      this.lastTime = now;

      while (this.accumulator >= this.stepMs) {
        step(this.stepMs / 1000, ++this.tick);
        this.accumulator -= this.stepMs;
      }
      // Sleep until ~2 ms before the next step is due.
      const wait = Math.max(0, this.stepMs - this.accumulator - 2);
      setTimeout(loop, wait);
    };
    setTimeout(loop, this.stepMs);
  }
}
```

Tick duration (p50/p99) and late-tick count are exported per zone as metrics.

---

## 3. Spatial Partitioning: Spatial Hash Grid

Comparing all entities against all other entities is $O(N^2)$, which collapses server performance with $>50$ entities. CrusadersOnline uses a **2D Uniform Spatial Hash Grid** partitioning the world into $32	ext{m} 	imes 32	ext{m}$ cells ($O(1)$ lookup). Cell keys are **integers** (no per-query string allocation), and queries write into a caller-provided array:

```typescript
const CELL = 32;
const OFFSET = 1 << 15; // supports cell coords in [-32768, 32767]

function cellKey(cx: number, cz: number): number {
  return (cx + OFFSET) * 65536 + (cz + OFFSET);
}

export class SpatialHashGrid {
  private cells = new Map<number, number[]>();

  public insert(entityId: number, x: number, z: number): void {
    const key = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = []));
    cell.push(entityId);
  }

  public queryRadius(x: number, z: number, radius: number, out: number[]): number {
    let n = 0;
    const minX = Math.floor((x - radius) / CELL), maxX = Math.floor((x + radius) / CELL);
    const minZ = Math.floor((z - radius) / CELL), maxZ = Math.floor((z + radius) / CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const cell = this.cells.get(cellKey(cx, cz));
        if (cell) for (let i = 0; i < cell.length; i++) out[n++] = cell[i];
      }
    }
    return n; // number of valid entries in out
  }
}
```

The spatial hash is used for **interest management and AI proximity**. Precise collision, ground detection and weapon hit tests are delegated to Rapier (§3.1).

### 3.1 Collision & Physics (ADR-005)

- One Rapier `World` per zone, built from level trimesh colliders (converted `.msh` or synthetic arena geometry).
- Players and creatures are kinematic capsules moved by `KinematicCharacterController` through the shared `stepCharacter()` in `shared/src/movement/` — the exact code the client runs for prediction.
- Melee arcs and projectiles use Rapier shape-casts / intersection queries at the attack's tick.
- Rapier's WASM module is initialized once at worker boot (`await RAPIER.init()`).

---

## 4. Entity Component Architecture

Entities are plain numeric IDs with component bags:
- `TransformComponent`: X, Y, Z position, yaw, pitch, scale.
- `VelocityComponent`: VX, VY, VZ, ground contact flag.
- `CombatComponent`: Current HP, Max HP, Mana, Attack Cooldown, Flinch Timer.
- `StatsComponent`: Might, Intelligence, Endurance, Speed.
- `NetworkComponent`: Owner Client ID, Last Validated Sequence Number, Dirty Flag.
- `AIComponent`: Target Entity ID, Current State (IDLE, CHASE, ATTACK), Aggro Table.

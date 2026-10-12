# Performance Testing: Benchmarks, Tick Latency & Bot Swarms

## 1. Objective

Provide automated load-testing tools and benchmarks to verify that the authoritative server sustains a stable 20 Hz simulation tick under concurrent player loads.

---

## 2. Tools

- **`tests/load/bot_swarm.ts`** — starts the server in-process (its zone runs in a worker thread) and connects N guest bots (`ClientSession`, the browser client's own code, with prediction), which run, turn, jump, block and attack at random at the 20 Hz client rate. It collects the zone's tick metrics (published every 5 s: p50 / p99 / max of the last 100 ticks, late ticks) and fails when the worst p99 reaches 15 ms (milestone 10).
  `pnpm --filter @crusaders/tests load -- --bots 100 --seconds 60 --arena level:ca1a`
- **`tests/load/zone_profile.ts`** — the same load on one `WorldZone` without the network, for CPU profiles (`node --cpu-prof`); it also counts the character-controller queries per tick.

## 3. Measurements (2026-10-12, Ryzen 7 5700X, Node 24)

| Scenario | p50 tick | worst p99 (5 s windows) | Late ticks | Out per client |
|---|---|---|---|---|
| 100 bots, synthetic arena | 1.4–3.6 ms | 8.7 ms | 0 | — |
| 100 bots, level `ca1a` (41 k collision triangles, 28 creatures) | 7.7–9.6 ms | 12.8–24.4 ms (varies run to run) | 0 | ~29 KB/s (145 KiB per tick for 100 viewers) |

Profile of the level case: ~77 % of the tick is the shared movement step's character-controller query (~80 queries per tick at ~0.08 ms each against the trimesh), ~9 % snapshots, ~8 % creature AI. Optimisations made: a settled character standing still skips its collision query (identical result, so prediction stays exact); entity states are built once per tick and shared by every viewer's snapshot (it copied players × entities objects per tick). The worst-window p99 is effectively the slowest of 100 ticks, so GC pauses and OS scheduling show up in it.

Open: the p99 target is met only in some runs on a real level with every bot moving at once; the per-client bandwidth with 100 mutually visible players is ~6× the target (all entities in the 64 m interest radius are sent every tick). Candidates: a smaller interest radius or lower update rates for distant entities, and cheaper controller settings for creatures far from players.

## 4. Acceptance Targets

| Concurrency Level | Target Tick Latency | Max P99 Tick Latency | Network Out per Client |
|---|---|---|---|
| **10 Players** | < 2.0 ms | < 5.0 ms | < 2.5 KB/s |
| **50 Players** | < 5.0 ms | < 12.0 ms | < 4.0 KB/s |
| **100 Players** | < 10.0 ms | < 20.0 ms | < 5.0 KB/s |
| **200 Players** | < 18.0 ms | < 35.0 ms | < 6.5 KB/s |

Any tick duration exceeding 45.0 ms triggers a server alarm, indicating that spatial hash partitioning or vector pooling optimizations must be investigated.

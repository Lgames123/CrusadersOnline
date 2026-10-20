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

**2026-10-20, snapshot bandwidth** (`bot_swarm.ts` now prints the down rate per client after everyone is in):

| 100 bots, `ca1a`, 30 s | Down per client | p50 tick | worst p99 |
|---|---|---|---|
| Before | 22.2 KB/s | 8.7 ms | 21.2 ms |
| Varint ids, int16 position deltas, per-receiver rates (nearest 10 / within 8 m at 20 Hz) | 5.8–6.0 KB/s | 10.4–12.4 ms | 18–30 ms |
| + compact header (36 → 16 bytes standing) | 5.0–5.2 KB/s | | |
| + nearest 8 / within 4 m at 20 Hz, rank ≥ 24 at 2.5 Hz (shipped) | **4.3 KB/s** (two runs) | 10.2–11.1 ms | 18–31 ms |

Of that, JSON control messages are ~0.45 KB/s and full snapshots under 2 %. The plan (sort by distance, per-entity last-written state) costs about 0.5–1 ms of the tick at 100 players: the old code ran 10.2–12.5 ms p50 on the same machine on different runs, so the variance hides most of it. The tick is still ~65 % character-controller queries (73 per tick at ~0.1 ms); the controller settings are left alone because they are the movement fidelity and client prediction must match them.

Open: the p99 target is met only in some runs on a real level with every bot moving at once; the bandwidth target is met (above). Candidates for the tick: cheaper controller queries for creatures far from players, or splitting a crowded zone; measure on the production host, since this desktop's run-to-run spread (p99 13–31 ms) is larger than the effect of most changes.

## 4. Acceptance Targets

| Concurrency Level | Target Tick Latency | Max P99 Tick Latency | Network Out per Client |
|---|---|---|---|
| **10 Players** | < 2.0 ms | < 5.0 ms | < 2.5 KB/s |
| **50 Players** | < 5.0 ms | < 12.0 ms | < 4.0 KB/s |
| **100 Players** | < 10.0 ms | < 20.0 ms | < 5.0 KB/s |
| **200 Players** | < 18.0 ms | < 35.0 ms | < 6.5 KB/s |

Any tick duration exceeding 45.0 ms triggers a server alarm, indicating that spatial hash partitioning or vector pooling optimizations must be investigated.

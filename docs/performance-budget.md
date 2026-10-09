# Performance Budget: Client & Server Constraints

## 1. Client Performance Budget (Target: 60 FPS on Integrated GPU)

| Metric | Target Budget | Hard Maximum | Rationale |
|---|---|---|---|
| **Frame Time** | 16.6 ms (60 FPS) | 33.3 ms (30 FPS) | Smooth responsiveness for real-time melee combat |
| **Draw Calls** | < 80 per frame | 150 per frame | Keep WebGL CPU driver overhead negligible |
| **Visible Triangles** | < 40,000 | 100,000 | Matches retro aesthetic while ensuring high mobile/laptop FPS |
| **VRAM / GPU Textures**| < 120 MB | 250 MB | Low footprint prevents browser tab crashes |
| **Initial JS Bundle** | < 450 KB (gzip) | 1.0 MB | Instant loading without frustrating loading spinners |
| **Audio Memory** | < 25 MB | 50 MB | Decoded audio buffers kept small via streaming |

---

## 2. Server Performance Budget (Target: 20 Hz / 50ms Tick)

| Metric | Target Budget | Hard Maximum | Rationale |
|---|---|---|---|
| **Simulation Tick Time** | < 12 ms | 35 ms | Leaves 15ms headroom before missing 50ms tick window |
| **Memory per Player** | < 45 KB | 120 KB | Allows 500 concurrent players in <100 MB heap |
| **Network Bandwidth In**| < 1.5 KB/s / player | 4.0 KB/s | 20 input packets/sec (timestamp, input flags, yaw) |
| **Network Bandwidth Out**| < 4.0 KB/s / player | 10.0 KB/s | Spatial interest snapshot of ~15 visible entities |
| **DB Query Latency** | < 5 ms (Indexed) | 25 ms | Fast character saves and item lookups |

---

## 3. Enforcement & Continuous Telemetry

1. **In-Game FPS Counter:** Toggleable dev HUD displaying current FPS, draw calls, and memory usage via `renderer.info`.
2. **Server Tick Telemetry:** Pino logger alerts warning if tick duration exceeds 25 ms.
3. **Automated Vitest Benchmarks:** Fail test run if vector math operations exceed microsecond budgets.

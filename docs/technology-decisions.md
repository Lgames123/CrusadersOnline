# Technology Decisions & Architecture Decision Records (ADRs)

## 1. Overview & Evaluation Framework

To ensure that every technology choice is grounded in engineering pragmatism, maintainability, and alignment with developer constraints, this document records the evaluation matrix and formal Architecture Decision Records (ADRs) for CrusadersOnline.

> **Revision 2 (2026-10-09):** Stack review. Core choices (Node.js/TypeScript server, Three.js client, WebSocket transport, PostgreSQL) were confirmed. The review added or replaced decisions on the asset converter (ADR-003), protocol serialization (ADR-004), physics/collision (ADR-005), movement authority (ADR-006), database access (ADR-007), authentication (ADR-008), zone process model (ADR-009), workspace tooling (ADR-010) and project naming (ADR-011).

### 1.1 Stack Summary

| Layer | Decision | ADR |
|---|---|---|
| Server runtime | Node.js 24 LTS + TypeScript | ADR-001 |
| Renderer | Three.js (WebGLRenderer, WebGL2 baseline) | ADR-002 |
| Asset converter | Single TypeScript converter package (Node CLI + browser Web Worker) | ADR-003 |
| Transport | WebSocket (`ws`) behind a `Transport` interface | ADR-004 |
| Serialization | Binary for hot-path messages, JSON + Zod for control messages | ADR-004 |
| Physics / collision | Rapier deterministic build (`@dimforge/rapier3d-deterministic-compat`), shared client/server | ADR-005 |
| Movement authority | Input-only client, server-simulated movement | ADR-006 |
| Persistence | PostgreSQL 18 (17 minimum) | §2.3 |
| Database access | Kysely + plain-SQL migrations | ADR-007 |
| Auth | argon2id + opaque session + single-use WebSocket ticket | ADR-008 |
| Scaling unit | One worker thread per zone | ADR-009 |
| Workspace | pnpm workspaces, Vite, Vitest, Playwright | ADR-010 |
| Project name | CrusadersOnline | ADR-011 |

---

## 2. Technology Comparison Matrix

### 2.1 Backend Server & World Simulation

| Dimension | Rust | C++20 | TypeScript (Node.js) |
|---|---|---|---|
| **Raw Throughput** | Very High (Zero-cost abstractions) | Extremely High | High (V8 JIT, Single-thread event loop) |
| **Memory Safety** | Compile-time guaranteed | Manual / Pointer risks | Memory managed / GC pauses |
| **Development Speed** | Moderate (Borrow checker learning curve) | Low-Moderate | Very High (Unified stack with client) |
| **Cross-Platform / Windows Dev** | Requires MSVC build tools + Cargo | Complex CMake / MSVC toolchain | Native Windows support; Node.js v24 verified |
| **Code Sharing** | Requires WASM or duplicate schemas | Requires WASM or duplicate headers | 100% Shared TypeScript types, packets, math, movement |
| **Concurrency Model** | Multi-threaded async (Tokio) | Multi-threaded native pthreads | Event loop + Worker threads (one per zone, ADR-009) |
| **Database Drivers** | SQLx / Diesel (Excellent) | libpq (Cumbersome) | `pg` + Kysely (Mature, typed) |

**Evaluation:**
While Rust provides the ideal performance ceiling for massive scale, a clean-room modular monolith simulating 50–200 concurrent players per zone benefits enormously from a unified TypeScript ecosystem across client and server — most importantly, the **same movement and collision code runs in both** (ADR-005/006). Node.js v24.14.0 is verified on the workstation while Cargo is not installed. **TypeScript on Node.js** is chosen, with clean module boundaries allowing a future Rust/WASM simulation core if CPU profiling mandates it.

---

### 2.2 Browser Client & 3D Renderer

| Dimension | Three.js | Babylon.js | Pure WebGPU/WebGL2 |
|---|---|---|---|
| **API Abstraction** | Minimalist, highly flexible scene graph | Feature-rich, opinionated game engine | Bare-metal command buffers |
| **Ecosystem & Community** | Industry standard, massive glTF ecosystem | Excellent, but larger bundle size | Minimal high-level utilities |
| **Skeletal Animation** | Native `AnimationMixer` & bone rigging | Native skeletal system | Must write custom GPU skinning shaders |
| **Bundle Size** | ~600 KB minified / ~150 KB gzip (core + GLTFLoader) | Larger (multi-MB unless heavily tree-shaken) | Smallest, but everything is hand-written |
| **Browser Compatibility** | WebGL2 universal; optional WebGPU renderer | WebGL2 universal; WebGPU engine | WebGPU not universal; WebGL2 fallback required |

**Evaluation:**
**Three.js** is selected. Its complete glTF loader pipeline, `AnimationMixer`, modular shader chunks and community tooling provide the fastest and most stable path to render the game's retro aesthetic (low-poly 1999 models, low-resolution textures) in WebGL2 across all browsers. The client uses `WebGLRenderer`; `WebGPURenderer` is an optional future upgrade that does not change scene code.

---

### 2.3 Database & State Persistence

| Dimension | PostgreSQL 18 | Redis | SQLite |
|---|---|---|---|
| **Relational Integrity** | ACID transactions, foreign keys, row locks | In-memory key-value, optional append | Single-file ACID, local only |
| **Inventory / Anti-Dupe** | Row locks / serializable transactions eliminate dupes | Requires custom Lua scripts | Single-writer lock bottleneck |
| **Persistence Guarantee** | Durable WAL (Write-Ahead Logging) | Configurable snapshot/AOF | Durable local disk |

**Evaluation:**
**PostgreSQL** is the authoritative store for accounts, sessions, character stats, equipment, bank slots and progression. Target **PostgreSQL 18** (current major); **17** is the minimum supported version. There is no reason to start a new project on 16. In-memory state (position, aggro, combat timers) lives in the zone worker and flushes dirty character records periodically and on disconnect. Redis is **not** part of v1; it becomes a candidate only when cross-zone pub/sub or multi-host session sharing is needed.

---

## 3. Architecture Decision Records

### ADR-001: Choice of Server Runtime & Simulation Language
- **Decision:** Implement the Authoritative Game Server in TypeScript on Node.js 24 LTS.
- **Context:** The project requires a 20Hz tick simulation with spatial indexing, WebSocket packet validation, and database operations.
- **Alternatives Considered:** Rust (Tokio/Bevy), C++20, Go.
- **Evaluation Criteria:** Developer velocity, verified local toolchain, code sharing with browser client, debugging ease.
- **Reasons for Choice:**
  1. The local machine already has Node.js v24.14.0 and npm 11.9.0 configured and tested.
  2. Code sharing for math, packet codecs, and the character movement controller (`shared/`) eliminates protocol and physics drift between client prediction and server authority.
  3. A single-threaded 20Hz loop per zone (ADR-009) with non-blocking database calls is adequate for 50–200 concurrent players per zone.
- **Risks & Limitations:** V8 garbage-collection pauses can induce micro-stutter if objects are allocated per tick. `setInterval`/`setTimeout` have millisecond-level jitter on Windows and under load.
- **Mitigation:**
  - Zero-allocation tick: reusable vector pools, preallocated typed arrays, integer spatial-hash keys (no string keys).
  - Fixed-step accumulator driven by `performance.now()` (monotonic), not `Date.now()` and not a bare `setInterval`; see [engine-design.md](engine-design.md) §2.
- **Verification Method:** Benchmark tick duration (p50/p99) under 100 simulated bot connections in `tests/performance/`. Figures in the docs are targets until this benchmark exists.

---

### ADR-002: Choice of Browser 3D Rendering Framework
- **Decision:** Adopt Three.js (`WebGLRenderer`, WebGL2 baseline) with custom retro post-processing.
- **Context:** The client must render 3DO-style low-poly environments (approx. 5,000–20,000 polygons per scene) with smooth third-person camera tracking and bone animations.
- **Alternatives Considered:** Babylon.js, PlayCanvas, custom WebGPU engine.
- **Evaluation Criteria:** Asset pipeline interoperability (glTF/GLB), memory footprint, animation support, simplicity.
- **Reasons for Choice:** Three.js provides the best balance of low boilerplate, tree-shaking, native animation blending, and WebGL2 universal compatibility.
- **Risks & Limitations:** No built-in physics engine.
- **Mitigation:** Physics and collision are provided by Rapier through the shared movement module (ADR-005), not by the renderer. The renderer only draws.
- **Verification Method:** Frame-time telemetry in the browser canvas ensuring consistent 60 FPS on standard integrated GPUs.

---

### ADR-003: Asset Distribution Model & Converter Implementation (Zero-IP Clean Room)
- **Decision:**
  1. Pure synthetic fallback client with local user-fed conversion (unchanged policy).
  2. The converter is written **once, in TypeScript**, as the `converter/` workspace package. It runs in two hosts: a Node.js CLI (`pnpm convert`) and a browser Web Worker (fed via the File System Access API / file picker). Output glTF is written with `@gltf-transform/core`.
- **Context:** 3DO and Ubisoft hold intellectual property rights over original game assets, dialogue, sounds and binary code. The plan offers two user paths (offline conversion and in-browser import). A Python converter cannot run in the browser, so a Python pipeline would force writing every format parser twice. Off-the-shelf mesh libraries (e.g. `trimesh`) do not understand the proprietary `.mdl`/`.msh`/`.ani` formats and do not export skinned/animated glTF.
- **Alternatives Considered:**
  1. Distributing game assets directly on the web server (Rejected — copyright infringement).
  2. Requiring users to upload 600MB of assets to the multiplayer server (Rejected — privacy and distribution risks).
  3. Python + Pillow + trimesh converter (Rejected — cannot run in browser; no skinning/animation export; duplicate implementation).
- **Design:**
  - `converter/src/formats/` — pure parsers (`ArrayBuffer` in, typed structures out): `mdl`, `msh`, `ani`, `cap`, `tga`, `ctx` (text rules). No Node or DOM APIs.
  - `converter/src/emit/` — glTF emission via `@gltf-transform/core` (meshes, skins, animation channels), rules JSON.
  - `converter/src/hosts/node.ts` — CLI: reads the install dir, writes `local/generated/`. Image encoding via `sharp`.
  - `converter/src/hosts/worker.ts` — browser: reads user-picked files, writes to OPFS/IndexedDB. Image encoding via `OffscreenCanvas.convertToBlob()`.
  - ZIP reading (`Textures/textures.zip`) via `fflate` (isomorphic).
- **Role of Python:** Research only — `tools/inventory.py`, `tools/analyze_pe.py` and ad-hoc format probes. Python is not part of the user-facing pipeline.
- **Verification Method:** CI script auditing the repository for proprietary hashes and binary extensions; converter parser unit tests run against synthetic fixtures only (never original files in CI).

---

### ADR-004: Network Transport & Serialization Format
- **Decision:**
  - **Transport:** WebSocket via `ws`, hidden behind a `Transport` interface in `server/src/network/` and `client/src/network/` so that `uWebSockets.js` (server) or WebTransport (both) can be swapped in later without touching game code.
  - **Hot-path messages are binary from day one:** `CS_PLAYER_INPUT` and `SC_WORLD_SNAPSHOT` use hand-written `DataView` codecs in `shared/src/protocol/binary/`, with quantized fields and delta compression against the last client-acknowledged snapshot.
  - **Control messages stay JSON + Zod:** login/character select, inventory, chat, interaction, errors. Low frequency, human-readable, validated server-side.
- **Context:** Real-time movement (20 updates/sec per client in both directions) plus infrequent RPCs.
- **Alternatives Considered:** WebRTC DataChannels (rejected: STUN/TURN complexity), all-JSON with later binary migration (rejected: Zod parsing every packet at 20Hz × N players wastes CPU, and migrating later means rewriting codecs, tests and tooling), Colyseus (rejected: its room-wide state sync conflicts with our spatial interest management; we would fight the framework).
- **Reasons for Choice:**
  - WebSocket provides universal firewall traversal. TCP head-of-line blocking under packet loss is acceptable at 20Hz for v1.
  - Binary hot path keeps bandwidth under the 5 KB/s per-client budget and avoids per-packet allocation of JSON objects.
  - Binary codecs are validated structurally (length, ranges, finite floats) during decode — no Zod on the hot path.
- **Verification Method:** Round-trip codec unit tests, fuzz tests with random byte buffers, bandwidth measurement in the bot swarm.

---

### ADR-005: Physics, Collision & Character Controller
- **Decision:** Use **Rapier** (`@dimforge/rapier3d-deterministic-compat`, WASM — the cross-platform deterministic build) for collision queries and the kinematic character controller. The movement step lives in `shared/src/movement/` and runs identically in the browser (prediction) and in the zone worker (authority).
- **Context:** The original game has sloped terrain, ramps, stairs, multi-level dungeons, fall damage and ledges. Simple AABB/capsule checks against hand-placed volumes cannot represent level geometry. Client-side prediction only works if client and server run the **same** movement code against the **same** collision data.
- **Alternatives Considered:**
  1. Hand-written AABB + capsule checks (Rejected — cannot represent triangle-mesh levels).
  2. `three-mesh-bvh` + custom capsule controller (Viable fallback — lighter, but slope/step/ground-snap logic must be written and maintained by us).
  3. Ammo.js / cannon-es (Rejected — heavier or less maintained; not designed for kinematic character controllers).
- **Design:**
  - Level collision: trimesh colliders built from converted `.msh` geometry (or synthetic arena geometry); `.cap` capsules for creature collision once reverse-engineered.
  - Player: kinematic capsule driven by `KinematicCharacterController` (slopes, step-up, ground snap).
  - Combat hit tests: Rapier shape-casts/intersection queries for weapon arcs.
  - Rapier runs only on the server and client; the renderer never owns collision.
- **Risks:** WASM init is async (handled at boot). The deterministic build plus per-step snapping of position (mm) and vertical velocity (mm/s) makes replays exact; any residual divergence is still corrected by reconciliation (ADR-006). The `-compat` build embeds the WASM as base64 (~5 MB client bundle, 1.8 MB gzip); switching to the non-compat build with a separate `.wasm` file is a later optimisation.
- **Verification Method:** Shared movement unit tests (same input sequence → same final position within ε on Node); E2E test that client-predicted and server positions converge.

---

### ADR-006: Movement Authority Model
- **Decision:** The client sends **inputs only** (`inputFlags`, `yaw`, `pitch`, client tick number). The server simulates movement with the shared controller (ADR-005) and is the sole source of positions. The client predicts locally, and reconciles by replaying unacknowledged inputs when an authoritative snapshot arrives.
- **Context:** The previous design accepted client-reported positions and rejected moves exceeding `v_max × Δt × 1.15`. That model trusts the client within the tolerance window, is prone to false positives on jitter, and allows wall-clipping/flying wherever the check is incomplete.
- **Consequences:**
  - Speedhacks and teleports are impossible by construction — there is no position field to tamper with.
  - Server-side checks reduce to input sanity: one input per tick (excess inputs are dropped), finite angles, valid flag bits.
  - The client must keep an input history ring buffer for reconciliation.
- **Verification Method:** Integration test that sends forged/accelerated input streams and asserts server position never exceeds controller limits; E2E criterion 10 in [milestones/08-vertical-slice.md](milestones/08-vertical-slice.md).

---

### ADR-007: Database Access Layer
- **Decision:** **Kysely** (typed SQL query builder) on top of `pg`, with **plain `.sql` migration files** in `server/src/persistence/migrations/` applied by a small migration runner (Kysely `Migrator` with a SQL-file provider).
- **Alternatives Considered:** Prisma (rejected: separate query engine, awkward explicit locking such as `SELECT … FOR UPDATE`), Drizzle (viable; Kysely chosen for closer-to-SQL semantics), raw `pg` only (viable but untyped).
- **Reasons for Choice:** Explicit transactions and row locks (`.forUpdate()`), compile-time column typing, zero runtime engine, and migrations reviewable as SQL.
- **Embedded development database:** `DATABASE_URL=pglite:<dir>` runs **PGlite** (PostgreSQL 18 compiled to WASM, in-process) through a small custom Kysely dialect (`server/src/persistence/pglite_dialect.ts`); `pglite:memory` is used by integration tests. The same SQL migrations and queries run on PGlite and on a real server, so no Docker or native install is needed to develop. PGlite is single-process and single-connection: it is **not** a production option, and concurrency/locking behaviour must still be verified against a real PostgreSQL before launch.
- **Verification Method:** Integration tests run against PGlite (real PostgreSQL SQL semantics, no mocks). When `TEST_POSTGRES_URL` is set, the persistence suite also runs against a real PostgreSQL 18 (docker-compose.dev.yml), including a concurrent-registration race; verified 2026-10-09. Inventory dupe tests join this suite when inventory exists.

---

### ADR-008: Authentication & Session Model
- **Decision:**
  - Passwords hashed with **argon2id** (`argon2` package; OWASP parameters: m=19 MiB, t=2, p=1 minimum).
  - HTTP login issues an **opaque session ID** stored in an `HttpOnly; Secure; SameSite=Strict` cookie and in the `sessions` table (revocable, server-side expiry).
  - To open the game socket, the client calls `POST /api/ws-ticket` and receives a **single-use, 30-second ticket**; the first WebSocket message (`CS_AUTH_TICKET`) redeems it. Tickets are never placed in the URL.
  - Rate limiting on login/registration (per IP and per account) and on ticket issuance.
- **Replaces:** bcrypt + 24-hour JWT on the WebSocket handshake (long-lived bearer tokens cannot be revoked and leak easily via logs/URLs).
- **Verification Method:** Integration tests for ticket reuse, expiry, revoked sessions and login rate limiting.

---

### ADR-009: Zone Process Model
- **Decision:** Each world zone runs in its **own `worker_thread`** from the first multi-zone milestone; the main thread owns HTTP, WebSocket I/O and routing. Messages between main thread and zone workers use transferable `ArrayBuffer`s. The vertical slice (one zone) uses the same structure with a single worker.
- **Reasons:** Keeps one CPU core per zone, isolates a slow zone from the rest, and maps directly to a later multi-process / multi-host split.
- **Verification Method:** Tick metrics reported per zone; load test with two zones under load.

---

### ADR-010: Workspace & Build Tooling
- **Decision:** **pnpm workspaces** (`shared`, `converter`, `server`, `client`, `tests`), Vite for the client, Node 24 native TypeScript type stripping / `tsx` for server dev, `tsc --noEmit` for type checking, Vitest for unit/integration, Playwright for E2E.
- **Reasons:** pnpm's strict, non-flat `node_modules` prevents phantom imports between packages (e.g. client accidentally importing a server-only dependency), and is faster and smaller on disk than npm workspaces.

---

### ADR-011: Project Naming & Trademark Boundary
- **Decision:** The project, repository, UI, domain, package names and all branding use **CrusadersOnline** only. "Crusaders of Might and Magic" and "Might and Magic" are third-party trademarks (currently Ubisoft) and appear only nominatively — to describe the original game the reimplementation is compatible with, and the name of the user's local install folder.
- **Reasons:** The zero-IP policy covers assets in the repository but not names and marks; a public MMO carrying the original title is a larger legal exposure than the assets themselves.
- **Verification Method:** Release checklist item: no original title, logos or franchise terms in UI strings, page titles, store/listing text or package metadata.

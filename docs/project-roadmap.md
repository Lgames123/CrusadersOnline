# Project Roadmap: CrusadersOnline Reconstruction

## 1. Executive Summary & Critical Path

The CrusadersOnline roadmap is organized into dependency-ordered phases. Work strictly progresses from foundational environment verification and game archaeology through the asset pipeline, core engine simulation, browser rendering, authoritative networking, and the **Minimum Playable Vertical Slice (Phase 7 / Milestone 08)** before expanding into full game mechanics reconstruction.

```
[ Phase 1: Environment & Discovery ]
                 |
                 v
[ Phase 2: Game Archaeology & PE Analysis ]
                 |
                 v
[ Phase 3: Asset Pipeline & Local Importers ]
                 |
                 v
[ Phase 4: Engine Foundation & Gameplay Specs ]
                 |
                 v
[ Phase 5: Browser 3D Prototype (Synthetic Assets) ]
                 |
                 v
[ Phase 6: Authoritative Server & Networking (20Hz) ]
                 |
                 v
[ Phase 7: MINIMUM PLAYABLE VERTICAL SLICE (M08) ]
                 |
                 v
[ Phase 8: Game Subsystem Reconstruction (Combat, AI, Stats) ]
                 |
                 v
[ Phase 9: Automated Testing & Performance Stress Tests ]
                 |
                 v
[ Phase 10: Production Deployment & Hardened Ops ]
```

### Current position (2026-10-19)

| Phase | State |
|---|---|
| 1–7 (M00–M08) | Done. The vertical slice runs on the original levels. |
| 8 (M09) | Far along: movement, combat, spells, creatures, items and the main story are in. See `PROJECT_STATUS.md` §2.1 for what is left. |
| 9 (M10) | Tests and a 100-bot run are in place; the tick p99 and bandwidth targets are not met yet. |
| 10 (M11) | Runs locally in Docker; no real domain or TLS yet. |
| 11, campaign completion (new) | Ending after Necros with a post-game state (all story areas open, completion reward), intro movie option at character creation, waypoints later. |
| 12, MMO systems (new) | Staged plan in `game-design/mmo/11-implementation-roadmap.md`. Stage 1 is mostly in place; Stage 2 needs a party system. |
| Side quests (feature) | Cut from the original. Inventory in `game-design/side-quests.md`; to be implemented later behind `sideQuests`. |

---

## 2. Phase-by-Phase Timeline & Deliverables

### Phase 1: Discovery & Environment Setup (Milestones 00 & 01)
- **Goal:** Audit workstation tools, initialize protected Git workspace, generate initial documentation, and catalog project assets.
- **Key Deliverables:**
  - `docs/01-project-overview.md`, `02-environment-setup.md`, `03-dependencies.md`, `04-repository-structure.md`.
  - `.gitignore` with strict IP filters.
  - Initial system audit confirming Node.js, Python, Git.
- **Exit Criteria:** Zero unversioned proprietary files in repository; workspace building cleanly.

---

### Phase 2: Game Archaeology & Executable Analysis (Milestone 02)
- **Goal:** Forensic examination of the user's GOG installation (`Crusaders of Might and Magic/`).
- **Key Deliverables:**
  - `tools/inventory.py` execution generating `local/inventory.json`.
  - Binary header analysis of `crusaders.exe` (PE32, DirectX 7, MSVC runtime, subsystem).
  - Identification of major container formats (`.ctx`, `.mdl`, `.msh`, `.ani`, `.cap`).
  - `docs/reverse-engineering/*` evidence tables.
- **Exit Criteria:** Every file extension classified with count, total byte size, and format hypothesis.

---

### Phase 3: User-Operated Asset Pipeline (Milestone 03)
- **Goal:** Build offline conversion tools that convert proprietary formats into browser standards without distributing original files.
- **Key Deliverables:**
  - `converter/` TypeScript package (ADR-003): pure parsers (`tga`, `ctx`, `mdl`, `ani`, `msh`, `cap`) + glTF emitter (`@gltf-transform/core`).
  - Two hosts over the same code: Node CLI (`pnpm convert`) and browser Web Worker (OPFS output).
  - Synthetic procedural placeholder assets and arena collider data.
- **Exit Criteria:** Both hosts produce identical, loadable glTF and WebP files from user data, verifiable in the Three.js editor.

---

### Phase 4: Core Engine Foundation & Math (Milestone 04)
- **Goal:** Establish everything shared between client and server: math, the Rapier-based movement step, binary hot-path codecs, control schemas, fixed-tick scheduling and spatial indexing.
- **Key Deliverables:**
  - `shared/src/math/` (Vector3, Quaternion, quantization).
  - `shared/src/movement/` — `stepCharacter()` on Rapier's kinematic character controller (ADR-005).
  - `shared/src/protocol/binary/` (input + snapshot codecs, delta compression) and `shared/src/protocol/control/` (Zod) — ADR-004.
  - Fixed-tick 20Hz clock and integer-keyed spatial hash grid.
- **Exit Criteria:** Movement determinism across 10,000 replayed ticks on Node; codec round-trip and fuzz tests pass.

---

### Phase 5: Browser Client 3D Prototype (Milestone 05)
- **Goal:** WebGL2 rendering canvas running Three.js, third-person camera, player input capture, and greybox test arena.
- **Key Deliverables:**
  - `client/src/main.ts` bootstrap.
  - Third-person orbital/chase camera tracking player orientation.
  - Keyboard/mouse input manager with configurable bindings.
  - Greybox synthetic arena with collidable obstacles and ground planes.
- **Exit Criteria:** User can open browser at `http://localhost:3000`, run around a 3D arena at 60 FPS using WASD, and collide with barriers.

---

### Phase 6: Authoritative Server & Networking (Milestones 06 & 07)
- **Goal:** WebSocket gateway, zone worker with 20Hz loop, client prediction/reconciliation, auth and PostgreSQL player persistence.
- **Key Deliverables:**
  - `server/src/network/` (`Transport` interface + `ws` gateway with heartbeat & disconnect handling).
  - `server/src/zone/worker.ts` (one `worker_thread` per zone, ADR-009).
  - Input-only movement simulated server-side with the shared controller (ADR-006).
  - Auth: argon2id, session cookie, single-use WS tickets (ADR-008).
  - Kysely + SQL migrations for accounts, sessions, characters, and inventory (ADR-007).
- **Exit Criteria:** Server ticks at steady 20Hz (50ms interval); player state is securely stored and loaded from PostgreSQL.

---

### Phase 7: Minimum Playable Vertical Slice (Milestone 08 - PRIMARY GATE)
- **Goal:** An end-to-end playable slice connecting two browser clients in a shared arena with a sync'd enemy mob.
- **Key Deliverables:**
  - Two browser windows connect to the authoritative server.
  - Players see each other's avatars moving smoothly with interpolation.
  - One interactive skeleton enemy responds to player presence and attacks.
  - Players can swing weapons, deal damage, and defeat the enemy.
  - Character XP and gold rewards persist across server restarts.
- **Exit Criteria:** All 14 criteria defined in `docs/milestones/08-vertical-slice.md` pass automated and manual verification.

---

### Phase 8: Gameplay Systems Reconstruction (Milestone 09)
- **Goal:** Port original combat combos, spell casting, AI patrol routines, inventory grids, and sound spatialization.
- **Key Deliverables:**
  - Attack animation frame timings and recovery windows.
  - Shield blocking and stamina drain.
  - Inventory grid management with equipment slots (weapon, shield, armor).
  - Spells (Fireball, Lightning, Heal) with server mana costs.
- **Exit Criteria:** Parity matrix reaches >80% verified implementation against original gameplay captures.

---

### Phase 9: Automated Testing, Validation & Load (Milestone 10)
- **Goal:** Full regression suite, Playwright browser E2E tests, and 100-client bot stress testing.
- **Key Deliverables:**
  - `tests/unit/` testing math and packet schemas.
  - `tests/e2e/` testing multi-tab browser synchronization.
  - `tools/bot_swarm.ts` headless load generator measuring server tick latency under load.
- **Exit Criteria:** Server maintains <15ms tick processing time under 100 concurrent simulated players.

---

### Phase 10: Production Deployment & Operations (Milestone 11)
- **Goal:** Docker containerization, reverse proxy configuration (Caddy/Nginx), TLS termination, and backup automation.
- **Key Deliverables:**
  - `deployment/Dockerfile.server` and `deployment/Dockerfile.client`.
  - `deployment/docker-compose.yml` orchestrating Server, Client, and PostgreSQL.
  - Database WAL backup and disaster recovery scripts.
- **Exit Criteria:** Single-command deployment boots clean production environment with passing health checks.

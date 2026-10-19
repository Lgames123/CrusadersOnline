# Implementation Backlog: CrusadersOnline

## 1. Overview & Status Conventions

This document tracks all actionable engineering tasks across the project lifecycle.
Status values:
- `BLOCKED`: Awaiting an upstream dependency or critical information.
- `NOT STARTED`: Defined and specified, pending scheduling.
- `READY`: All prerequisites met; ready for immediate execution.
- `IN PROGRESS`: Actively being implemented.
- `NEEDS INVESTIGATION`: Technical uncertainty requires research or dynamic experiment.
- `IMPLEMENTED`: Code complete; awaiting verification test suite.
- `TESTING`: Undergoing automated and manual test validation.
- `VERIFIED`: Confirmed passing all acceptance criteria with reproducible evidence.
- `DEFERRED`: Intentionally postponed to post-v1 releases.

---

## 2. Master Backlog Items

### Phase 1: Environment & Repository Setup
| Task ID | Description | Priority | Dependencies | Complexity | Status | Doc Link | Source Files |
|---|---|---|---|---|---|---|---|
| **ENV-001** | Create strict `.gitignore` blocking all original game files, binaries, and local dirs | P0 | None | Low | **VERIFIED** | [04-repository-structure.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/04-repository-structure.md) | `.gitignore` |
| **ENV-002** | Create `.env.example` defining database, network ports, and private asset paths | P0 | None | Low | **VERIFIED** | [02-environment-setup.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/02-environment-setup.md) | `.env.example` |
| **ENV-003** | Initialize Git and pnpm workspace (`shared/`, `converter/`, `server/`, `client/`, `tests/`) | P0 | ENV-001 | Low | **VERIFIED** | [04-repository-structure.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/04-repository-structure.md) | `package.json` |

---

### Phase 2: Game Archaeology & Analysis
| Task ID | Description | Priority | Dependencies | Complexity | Status | Doc Link | Source Files |
|---|---|---|---|---|---|---|---|
| **ARC-001** | Implement read-only inventory scanner tool in Python | P0 | None | Low | **VERIFIED** | [file-inventory.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/file-inventory.md) | `tools/inventory.py` |
| **ARC-002** | Execute inventory scan against `Crusaders of Might and Magic` local installation | P0 | ARC-001 | Low | **VERIFIED** | [file-inventory.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/file-inventory.md) | `local/inventory.json` |
| **ARC-003** | Dissect `crusaders.exe` headers, DLL imports, DirectX 7 subsystem, and string tables | P1 | ARC-002 | Medium | **IN PROGRESS** | [executable-analysis.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/executable-analysis.md) | `tools/analyze_pe.py` |
| **ARC-004** | Dissect `.mdl` 3D model format header, vertex layout, and bone tables | P1 | ARC-002 | High | **VERIFIED** (265/267 files; spec in asset-format-discovery.md §3) | [asset-format-discovery.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/asset-format-discovery.md) | `tools/` probes → `converter/src/formats/mdl.ts` |
| **ARC-005** | Dissect `.ctx` texture container format and compression headers | P1 | ARC-002 | Medium | **VERIFIED** (textures, models.ctx, items.ctx, Sound.ctx, messages.ctx read by the converter) | [asset-format-discovery.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/asset-format-discovery.md) | `tools/` probes → `converter/src/formats/ctx.ts` |

---

### Phase 3: Asset Pipeline & Synthetic Fallbacks
| Task ID | Description | Priority | Dependencies | Complexity | Status | Doc Link | Source Files |
|---|---|---|---|---|---|---|---|
| **AST-001** | Build synthetic procedural assets and arena collider export (`pnpm gen:synthetic`) | P0 | ENV-003 | Low | **IN PROGRESS** (runtime factory done; collider export pending) | [asset-pipeline.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/asset-pipeline.md) | `client/src/assets/synthetic_factory.ts`, `shared/src/arena/synthetic.ts` |
| **AST-002** | Converter package skeleton + TGA→WebP + `.ctx`→rules.json, with Node CLI host | P2 | ARC-005 | Medium | **VERIFIED** (default/items/models/Sound/messages .ctx, exe string table) | [asset-pipeline.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/asset-pipeline.md) | `converter/src/formats/`, `converter/src/hosts/node.ts` |
| **AST-003** | `.mdl` + `.ani` → skinned/animated glTF via `@gltf-transform/core` | P2 | ARC-004 | High | **IN PROGRESS** (247 models → skinned GLB in bind pose with textures, collision spheres and weapon lines; 1,501 animation clips with root motion and events) — **VERIFIED** in the dev viewer |
| **ARC-006** | Decode `.ani` animation tracks (UNK-005) | P1 | ARC-004 | High | **VERIFIED** (1,499/1,501 pairs; engine evaluator in Ghidra) |
| **ARC-008** | World unit + movement/physics constants from the executable (UNK-007) | P1 | ARC-006 | Medium | **IN PROGRESS** (locomotion/jump model and derived-stat formulas recovered) |
| **ARC-009** | Damage application, resists, armour (UNK-008) | P1 | ARC-008 | High | **IMPLEMENTED** (formulas + items.json; wiring into server combat pending) |
| **CMB-001** | Switch server combat to the original formulas (attributes, items.json weapons/armour, resists, flinch, block) | P1 | ARC-009 | Medium | **IMPLEMENTED** (attributes, HP, weapon hit, attack modes, resists, flinch, shield block, inventory-driven equipment, creature loadouts, XP curve) |
| **ARC-007** | Decode `.msh` level geometry and `.cap` collision | P1 | ARC-002 | High | **VERIFIED** (superseded by ARC-011) | [asset-formats.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/asset-formats.md) | `converter/src/formats/mdl.ts`, `converter/src/emit/gltf.ts` |
| **AST-004** | Browser Web Worker host for the converter (OPFS output) | P2 | AST-002 | Medium | **VERIFIED** (Web Worker + Cache Storage + service worker; import panel) | [asset-pipeline.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/asset-pipeline.md) | `converter/src/hosts/worker.ts` |

---

### Phase 4: Engine Foundation & Shared Protocol
| Task ID | Description | Priority | Dependencies | Complexity | Status | Doc Link | Source Files |
|---|---|---|---|---|---|---|---|
| **ENG-001** | Implement shared 3D math library (Vector3, Quaternion, quantization helpers) | P0 | ENV-003 | Medium | **VERIFIED** | [engine-design.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/engine-design.md) | `shared/src/math/` |
| **ENG-002** | Binary codecs for input/snapshot (delta, quantization) + Zod schemas for control messages | P0 | ENV-003 | Medium | **VERIFIED** | [network-protocol.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/network-protocol.md) | `shared/src/protocol/` |
| **ENG-003** | Implement spatial hash grid for world entity interest management | P1 | ENG-001 | Medium | **VERIFIED** | [world-simulation.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/world-simulation.md) | `shared/src/spatial_hash.ts` |
| **ENG-004** | Shared movement step on Rapier kinematic character controller | P0 | ENG-001 | High | **VERIFIED** | [world-simulation.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/world-simulation.md) | `shared/src/movement/` |

---

### Phase 5: Browser 3D Client
| Task ID | Description | Priority | Dependencies | Complexity | Status | Doc Link | Source Files |
|---|---|---|---|---|---|---|---|
| **CLI-001** | Scaffold Vite + Three.js browser client with WebGL2 canvas bootstrap | P0 | ENV-003 | Low | **IMPLEMENTED** | [browser-client.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/browser-client.md) | `client/src/main.ts` |
| **CLI-002** | Implement third-person chase camera with orbital mouse-look and pitch clamps | P1 | CLI-001 | Medium | **IMPLEMENTED** | [rendering-pipeline.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/rendering-pipeline.md) | `client/src/engine/camera.ts` |
| **CLI-003** | Implement keyboard movement controller (WASD + Jump + Strafe) | P1 | CLI-001 | Low | **IMPLEMENTED** | [gameplay-specification.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/gameplay-specification.md) | `client/src/input/` |
| **CLI-004** | Build synthetic test arena with terrain grid and collidable obstacles | P1 | CLI-001 | Low | **IMPLEMENTED** | [browser-client.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/browser-client.md) | `client/src/entities/arena.ts` |

---

### Phase 6: Authoritative Server & Persistence
| Task ID | Description | Priority | Dependencies | Complexity | Status | Doc Link | Source Files |
|---|---|---|---|---|---|---|---|
| **SRV-001** | Build WebSocket server gateway with connection tracking and heartbeats | P0 | ENG-002 | Medium | **VERIFIED** | [mmorpg-architecture.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/mmorpg-architecture.md) | `server/src/network/gateway.ts` |
| **SRV-002** | Zone worker (`worker_thread`) with monotonic fixed-step 20Hz clock | P0 | ENG-001 | Low | **VERIFIED** | [engine-design.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/engine-design.md) | `server/src/zone/`, `server/src/simulation/clock.ts` |
| **SRV-003** | Input-only movement: input queue (1 per tick), shared controller, `lastProcessedInput` in snapshots | P0 | SRV-002, ENG-004 | Medium | **VERIFIED** | [security.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/security.md) | `server/src/simulation/movement.ts` |
| **SRV-004** | Kysely + `pg` pool, plain-SQL migrations (accounts, sessions, characters, inventory) | P1 | SRV-001 | Medium | **VERIFIED** (PGlite in dev/tests; PostgreSQL 18 in CI and Docker) | [database-schema.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/database-schema.md) | `server/src/persistence/` |

---

### Phase 7: Minimum Playable Vertical Slice (Gate M08)
| Task ID | Description | Priority | Dependencies | Complexity | Status | Doc Link | Source Files |
|---|---|---|---|---|---|---|---|
| **SRV-005** | Auth: argon2id, session cookie, single-use WS ticket, rate limits | P0 | SRV-004 | Medium | **VERIFIED** | [security.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/security.md) | `server/src/auth/` |
| **VRT-001** | Connect two client browser sessions to single server room | P0 | CLI-001, SRV-001 | Medium | **VERIFIED** | [08-vertical-slice.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/08-vertical-slice.md) | `client/src/network/` |
| **VRT-002** | Interpolate remote players; predict + reconcile local player | P0 | VRT-001 | Medium | **IMPLEMENTED** (verified headless; visual smoothness pending interactive check) | [browser-client.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/browser-client.md) | `client/src/entities/remote_player.ts` |
| **VRT-003** | Spawn server-authoritative skeleton mob with aggro and melee attack | P0 | SRV-002 | Medium | **VERIFIED** | [gameplay-systems.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/gameplay-systems.md) | `server/src/simulation/mob.ts` |
| **VRT-004** | Authoritative melee combat resolution with damage numbers and health sync | P0 | VRT-003 | Medium | **VERIFIED** | [gameplay-specification.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/gameplay-specification.md) | `server/src/simulation/combat.ts` |
| **VRT-005** | Persist character level, gold, and inventory to DB and verify reload survival | P0 | SRV-004, VRT-004 | Medium | **VERIFIED** (position, XP, gold, level, HP, inventory) | [persistence.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/persistence.md) | `server/src/persistence/` |

---

### Phase 8+: Expanded Systems & Testing
| Task ID | Description | Priority | Dependencies | Complexity | Status | Doc Link | Source Files |
|---|---|---|---|---|---|---|---|
| **TST-001** | Implement Vitest suite for math, packet parsing, and movement validation | P1 | ENG-001 | Low | **VERIFIED** (unit + integration suites, run in CI) | [testing-strategy.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/testing-strategy.md) | `tests/unit/` |
| **TST-002** | Playwright multi-client end-to-end synchronization tests | P1 | VRT-001 | Medium | **VERIFIED** (move, combat number, despawn across two tabs; runs in CI) |
| **ARC-010** | `.cap`/`.msh` DCL compression and `.cap` creature records (UNK-009) | P1 | ARC-009 | High | **VERIFIED** (`tools/re/pkware_dcl.py`, `tools/re/cap_creatures.py`) |
| **ARC-011** | `.msh` level geometry, textures, lightmaps → GLB + collision; `.cap` placements | P0 | ARC-010 | High | **VERIFIED** (24/25 levels; client renders, server and client collide; skeletons at original placements) |
| **OPS-001** | CI (typecheck, tests with PostgreSQL, E2E, image publishing to GHCR) | P1 | TST-002 | Medium | **IMPLEMENTED** (`.github/workflows/ci.yml`; first run on push) |
| **OPS-002** | Scheduled database backups and restore procedure | P1 | SRV-004 | Low | **VERIFIED** (local restore drill) |
| **OPS-003** | TLS on a real domain with HSTS | P1 | DEP-001 | Low | **READY** (config in place; needs a domain) | [testing-strategy.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/testing-strategy.md) | `tests/e2e/` |
| **OPS-001** | Dockerize server, client, and PostgreSQL with single-command compose | P1 | VRT-005 | Low | **VERIFIED** (local Docker Desktop; TLS/backups pending) | [deployment.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/deployment.md) | `deployment/` |

---

### Phase 9+: Campaign Completion, Features and MMO Systems (added 2026-10-19)
Current priorities and the user's decisions are in `PROJECT_STATUS.md` §2–3.

| Task ID | Description | Priority | Dependencies | Complexity | Status | Notes |
|---|---|---|---|---|---|---|
| **CMP-001** | Ending after Necros's death: death timeline, Cs5b's Seq24, story marked complete, every door open (post-game state) | P0 | Necros fight | Medium | **VERIFIED** | executable-analysis §24; tests/unit/ending.test.ts; checked live |
| **CMP-008** | Completion reward (title, cape or similar) for characters with `completedAt` | P2 | CMP-001 | Low | **NOT STARTED** | To be decided |
| **CMP-002** | Waypoints: teleport to areas and maps the character has unlocked | P2 | CMP-001 | Medium | **NOT STARTED** | Not original |
| **CMP-003** | Intro movies (.bik): option at character creation to watch the introduction | P1 | Bink conversion in the importer | Medium | **NOT STARTED** | |
| **CMP-004** | Walk-in movers: wheels, Gl\*b crushers (with damage), chandeliers, Bs1a gears | P1 | — | Medium | **NOT STARTED** | |
| **CMP-005** | Creature against creature (guards vs hostiles, Ws5a fight) | P1 | — | High | **NOT STARTED** | |
| **CMP-006** | Relay ops still unconverted (0/1, 2/3, 0x0A–0x0E) | P2 | — | Medium | **NEEDS INVESTIGATION** | |
| **CMP-007** | Climbing and hanging (0x0042C310, 0x00490E80) | P2 | Climbable surfaces | High | **NEEDS INVESTIGATION** | |
| **SQ-001** | Side quests as a feature (`sideQuests`, off by default): records, NPC placements, objectives, rewards | P2 | CMP-001 | High | **NOT STARTED** | Cut content; spec in `game-design/side-quests.md` |
| **QOL-001** | Chat ignore list, kept in the browser and applied on display | P3 | — | Low | **NOT STARTED** | Chat history: not wanted |
| **MMO-001** | Party system | P1 | — | Medium | **NOT STARTED** | Needed by MMO Stage 2 |
| **MMO-002** | MMO Stage 1 remainder: item instances (UUID + affix payload) | P1 | — | Medium | **NOT STARTED** | Renumber the spec's migration 006 (taken by admin bans) |
| **OPS-004** | Load targets: tick p99 < 15 ms with 100 bots, ~5 KB/s per client | P1 | — | High | **IN PROGRESS** | Now 13–24 ms, ~29 KB/s |

Decided, no task: cooldowns and timers reset on relog (fine for now); the hotbar layout stays per browser (by design).


# 04 - Repository Structure: Architectural Boundaries & Layout

## 1. Objective

Define the layout, module separation boundaries, isolation protocols, and directory ownership for CrusadersOnline to guarantee zero contamination of version control with copyrighted game files and maintain clean modular separation between server, client, shared protocol, and tools.

---

## 2. Directory Layout & Boundaries

```
CrusadersOnline/
├── .env.example                       # Committed template for local configuration
├── .gitignore                         # Strict IP protection and build artifacts filter
├── package.json                       # Root scripts
├── pnpm-workspace.yaml                # Workspace packages (ADR-010)
├── pnpm-lock.yaml                     # Pinned dependency versions
├── tsconfig.json                      # Shared TypeScript base compiler configuration
├── prompt.md                          # Master project specification
│
├── docs/                              # Public documentation repository
│   ├── README.md                      # Documentation root index
│   ├── 01-project-overview.md         # Mission, scope, and clean-room policy
│   ├── 02-environment-setup.md        # Workstation configuration
│   ├── 03-dependencies.md             # Stack manifest and package list
│   ├── 04-repository-structure.md     # This document
│   ├── technology-decisions.md        # Architecture Decision Records (ADRs)
│   ├── project-roadmap.md             # Milestone sequence
│   ├── implementation-backlog.md      # Detailed task tracking
│   ├── risk-register.md               # Risk assessment & mitigations
│   ├── PROJECT_STATUS.md              # Real-time state and resumption notes
│   ├── milestones/                    # Phase-by-phase implementation gates (00 to 11)
│   └── reverse-engineering/           # Forensic notes on 3DO formats & executable
│
├── tools/                             # Research scripts only (Python, read-only, never bundled)
│   ├── inventory.py                   # Read-only game file scanner
│   └── analyze_pe.py                  # PE32 header dissector
│
├── converter/                         # TypeScript asset converter (ADR-003)
│   ├── src/
│   │   ├── formats/                   # Pure parsers: tga, ctx, mdl, ani, msh, cap
│   │   ├── emit/                      # glTF (@gltf-transform/core), rules JSON, manifest
│   │   └── hosts/
│   │       ├── node.ts                # CLI host: `pnpm convert` -> local/generated/
│   │       └── worker.ts              # Browser Web Worker host -> OPFS
│   └── package.json
│
├── shared/                            # Isomorphic TypeScript shared library
│   ├── src/
│   │   ├── protocol/
│   │   │   ├── opcodes.ts             # Packet IDs (CS_*, SC_*)
│   │   │   ├── binary/                # DataView codecs: input frames, delta snapshots
│   │   │   └── control/               # Zod schemas: auth, inventory, chat, combat events
│   │   ├── movement/                  # stepCharacter() on Rapier (client prediction + server authority)
│   │   ├── spatial_hash.ts            # Integer-keyed spatial hash grid
│   │   ├── math/                      # Vector, quaternion, quantization helpers
│   │   ├── constants.ts               # Tick rates (20Hz), max speeds, collision caps
│   │   └── types/                     # Character, item, and entity interfaces
│   └── package.json
│
├── server/                            # Authoritative Game Server
│   ├── src/
│   │   ├── index.ts                   # Server entrypoint and graceful shutdown
│   │   ├── config.ts                  # Environment loading & validation
│   │   ├── network/                   # Transport interface, ws gateway, connection manager
│   │   ├── zone/                      # worker_thread entry, one per zone (ADR-009)
│   │   ├── simulation/                # 20 Hz fixed tick world loop
│   │   │   ├── clock.ts               # Monotonic fixed-step accumulator
│   │   │   ├── world.ts               # Rapier world, spatial hash, entity registry
│   │   │   ├── inputs.ts              # Per-player input queue (1 input per tick)
│   │   │   └── combat.ts              # Rapier hit queries and damage calculation
│   │   ├── persistence/               # PostgreSQL via pg + Kysely (ADR-007)
│   │   │   ├── db.ts                  # Pool + Kysely instance
│   │   │   ├── migrations/            # Plain .sql migration files
│   │   │   └── repositories/          # Account & character repositories
│   │   └── auth/                      # argon2id, sessions, single-use WS tickets (ADR-008)
│   └── package.json
│
├── client/                            # Browser Client (Three.js / WebGL2)
│   ├── index.html                     # HTML5 canvas container and UI overlay mount
│   ├── vite.config.ts                 # Bundler and dev server configuration
│   ├── public/
│   │   └── assets/                    # Synthetic test assets ONLY (cubes, cylinders, audio)
│   ├── src/
│   │   ├── main.ts                    # Bootstrap loop and canvas initialization
│   │   ├── engine/                    # Three.js scene manager, camera, and render loop
│   │   ├── entities/                  # Local player, remote player, and mob renderers
│   │   ├── input/                     # Keyboard, mouse look, and keybinding mapper
│   │   ├── network/                   # Transport client, interpolation, prediction/reconciliation
│   │   ├── audio/                     # Web Audio API spatial emitter
│   │   ├── ui/                        # HUD, health bars, inventory grid, chat box
│   │   └── assets/                    # Asset loader (synthetic & user-fed), converter worker launcher
│   └── package.json
│
├── tests/                             # Automated Test Suites
│   ├── unit/                          # Math, codecs, movement, parser tests
│   ├── integration/                   # Server + real PostgreSQL, auth, inventory transactions
│   └── e2e/                           # Playwright multi-client synchronization tests
│
└── local/                             # [PRIVATE - GIT IGNORED]
    ├── inventory.json                 # Non-sensitive scan output
    ├── original/                      # User-supplied game installation
    ├── extracted/                     # Raw unpacked binary chunks
    └── generated/                     # User-converted glTF models & WebP textures
```

---

## 3. Physical Isolation Boundaries

1. **The Git Boundary:**
   - Any file under `local/` or `Crusaders of Might and Magic/` is unconditionally rejected by `.gitignore`.
   - Continuous integration checks verify that no binary files or files matching `*.mdl`, `*.ctx`, `*.msh`, `*.mp3`, `*.bik` are ever staged.
2. **The Server Asset Boundary:**
   - The production server never serves copyrighted game assets. It only synchronizes numerical physics states (entity ID, x, y, z, yaw, pitch, animation state ID, health, status).
3. **The Client Asset Boundary:**
   - In standard mode, the client loads procedural/synthetic geometry from `client/public/assets/`.
   - When the user enables "Original Assets" in settings, the client loads converted files directly from their browser's local sandbox or local proxy.

---

## 4. Acceptance Criteria

- [x] Clear physical separation between public source code and local user assets.
- [x] Directory purposes and responsibilities explicitly defined.
- [x] No proprietary formats allowed inside `shared/`, `server/`, or `client/public/`.

---

## 5. Next Steps

Proceed to:
- [technology-decisions.md](/docs/technology-decisions.md) — Architectural Decision Records.
- [project-roadmap.md](/docs/project-roadmap.md) — Implementation schedule and critical path.

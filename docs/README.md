# CrusadersOnline — Technical Documentation Repository

## 1. Project Purpose & Scope

**CrusadersOnline** is an open-source, clean-room reimplementation and persistent browser-based MMORPG compatible with assets from 3DO's 1999 action-RPG *Crusaders of Might and Magic* (third-party trademark, used only to identify the original game; see ADR-011). The project aims to reconstruct the movement physics, third-person combat feel, camera systems, and world exploration of the original game within a modern web architecture, augmented with server-authoritative multiplayer simulation and character persistence.

```
+-----------------------------------------------------------------------------------+
|                              CRUSADERSONLINE ARCHITECTURE                         |
+-----------------------------------------------------------------------------------+
|  [ Browser Client (Three.js / WebGL2 / TypeScript) ]                              |
|         ^                          ^                                              |
|         | WebSocket (binary inputs | Local Synthetic Fallbacks / User Assets      |
|         |  + binary snapshots)     | (TypeScript converter: CLI or Web Worker)    |
|         v                          |                                              |
|  [ Node.js / TypeScript Authoritative Game Server ]                               |
|     - 20 Hz Fixed Tick Simulation                                                 |
|     - Spatial Hash Entity Synchronization                                         |
|     - Input-Only Movement via Shared Rapier Controller                            |
|     - Authoritative Combat Resolution                                             |
|     - One worker_thread per Zone                                                  |
|         |                                                                         |
|         v                                                                         |
|  [ PostgreSQL 18 + Kysely (Accounts, Sessions, Characters, Inventory) ]           |
+-----------------------------------------------------------------------------------+
```

---

## 2. Intellectual Property & Asset Isolation Guarantee

This project operates under a strict **Zero-IP Distribution Policy**:
1. **No Proprietary Assets in Git:** No models (`.mdl`), textures (`.ctx`), sounds (`.wav`), music (`.mp3`), or binaries (`.exe`, `.dll`) from the original game are committed to or distributed through this repository.
2. **User-Fed Assets:** The browser client operates out of the box using built-in synthetic placeholder assets (procedural geometric primitives, greybox arenas, synthesized audio triggers). Players who legally own *Crusaders of Might and Magic* (e.g., GOG version) feed their own local files through the TypeScript asset converter, either offline (`pnpm convert`) or in the browser via the File System Access API (same code, ADR-003).
3. **Clean-Room Codebase:** All server simulation, networking protocols, mathematical models, and rendering pipelines are independently developed based on observable black-box behavior and reverse-engineered file specifications.

---

## 3. Documentation Map

### Architecture & Engineering
- [01-project-overview.md](/docs/01-project-overview.md) — High-level goals, project scope, and design principles.
- [02-environment-setup.md](/docs/02-environment-setup.md) — Windows and cross-platform workstation setup.
- [03-dependencies.md](/docs/03-dependencies.md) — Verified compilers, runtimes, package managers, and libraries.
- [04-repository-structure.md](/docs/04-repository-structure.md) — Directory layout and isolation boundaries.
- [technology-decisions.md](/docs/technology-decisions.md) — Architectural Decision Records (ADRs).
- [project-roadmap.md](/docs/project-roadmap.md) — Milestone breakdown and phase sequencing.
- [implementation-backlog.md](/docs/implementation-backlog.md) — Task tracker and status definitions.
- [risk-register.md](/docs/risk-register.md) — Technical, legal, and operational risks and mitigations.
- [PROJECT_STATUS.md](/docs/PROJECT_STATUS.md) — Real-time progress, completed tasks, and resumption checkpoints.

### Engine, Simulation & Mechanics
- [gameplay-specification.md](/docs/gameplay-specification.md) — Player controls, combat, AI, and progression specs.
- [engine-design.md](/docs/engine-design.md) — Fixed-tick game loop, spatial indexing, and collision pipeline.
- [gameplay-systems.md](/docs/gameplay-systems.md) — Subsystem specifications (health, loot, inventory, stats).
- [entity-and-data-model.md](/docs/entity-and-data-model.md) — ECS architecture and state representation.
- [implementation-parity-matrix.md](/docs/implementation-parity-matrix.md) — Parity tracking against original mechanics.

### Client & Rendering
- [browser-client.md](/docs/browser-client.md) — Client modular architecture and lifecycle.
- [rendering-pipeline.md](/docs/rendering-pipeline.md) — WebGL2/Three.js rendering passes, shaders, and materials.
- [performance-budget.md](/docs/performance-budget.md) — Frame time targets, draw call budgets, memory limits.

### Multiplayer, Networking & Persistence
- [mmorpg-architecture.md](/docs/mmorpg-architecture.md) — Authoritative server design and distributed topology.
- [network-protocol.md](/docs/network-protocol.md) — WebSocket packet format, opcode schema, serialization.
- [world-simulation.md](/docs/world-simulation.md) — Server tick, movement validation, and interest management.
- [database-schema.md](/docs/database-schema.md) — PostgreSQL table definitions, relations, and migrations.
- [persistence.md](/docs/persistence.md) — Transactional state management, save/load, crash recovery.
- [security.md](/docs/security.md) — Cheating prevention, input validation, and auth tokens.
- [threat-model.md](/docs/threat-model.md) — Attack surface enumeration and security boundaries.
- [security-checklist.md](/docs/security-checklist.md) — Pre-deployment security controls and verification.

### Asset Pipeline & Legal
- [asset-pipeline.md](/docs/asset-pipeline.md) — Conversion tools, intermediate artifacts, and manifest generation.
- [asset-formats.md](/docs/asset-formats.md) — Binary format reverse-engineering specifications (`.mdl`, `.msh`, `.ctx`).
- [asset-licensing-and-distribution.md](/docs/asset-licensing-and-distribution.md) — Legal boundaries, copyright compliance, and clean-room policy.

### Testing & Operations
- [testing-strategy.md](/docs/testing-strategy.md) — Unit, integration, E2E, and regression methodology.
- [test-matrix.md](/docs/test-matrix.md) — Feature-by-feature test coverage map.
- [performance-testing.md](/docs/performance-testing.md) — Load testing, tick latency benchmarks, synthetic bot harnesses.
- [known-discrepancies.md](/docs/known-discrepancies.md) — Differences between original single-player and multiplayer engine.
- [development-workflow.md](/docs/development-workflow.md) — Day-to-day coding, running, and debugging routines.
- [deployment.md](/docs/deployment.md) — Local Docker and production deployment guidelines.
- [operations.md](/docs/operations.md) — Monitoring, logs, telemetry, and administrative tasks.
- [backup-and-recovery.md](/docs/backup-and-recovery.md) — Database backup schedules, point-in-time recovery.
- [troubleshooting.md](/docs/troubleshooting.md) — Diagnostic guides for common runtime and network faults.

### Reverse Engineering Records
- [reverse-engineering/README.md](/docs/reverse-engineering/README.md) — Methodology and forensic toolchain.
- [reverse-engineering/file-inventory.md](/docs/reverse-engineering/file-inventory.md) — Empirical inventory of the GOG installation.
- [reverse-engineering/executable-analysis.md](/docs/reverse-engineering/executable-analysis.md) — PE32 inspection, DLL dependencies, symbol analysis.
- [reverse-engineering/asset-format-discovery.md](/docs/reverse-engineering/asset-format-discovery.md) — Header dissection and layout analysis.
- [reverse-engineering/runtime-observations.md](/docs/reverse-engineering/runtime-observations.md) — Frame capture, timing measurements, hitbox findings.
- [reverse-engineering/save-format-analysis.md](/docs/reverse-engineering/save-format-analysis.md) — Save slot structures and serialization.
- [reverse-engineering/gameplay-mechanics.md](/docs/reverse-engineering/gameplay-mechanics.md) — Combat mathematics and stat curves.
- [reverse-engineering/unknowns.md](/docs/reverse-engineering/unknowns.md) — Open technical questions and verification backlogs.

### Milestone Documents
- [milestones/00-discovery.md](/docs/milestones/00-discovery.md)
- [milestones/01-environment.md](/docs/milestones/01-environment.md)
- [milestones/02-game-archaeology.md](/docs/milestones/02-game-archaeology.md)
- [milestones/03-asset-pipeline.md](/docs/milestones/03-asset-pipeline.md)
- [milestones/04-engine-foundation.md](/docs/milestones/04-engine-foundation.md)
- [milestones/05-browser-prototype.md](/docs/milestones/05-browser-prototype.md)
- [milestones/06-multiplayer-server.md](/docs/milestones/06-multiplayer-server.md)
- [milestones/07-persistent-characters.md](/docs/milestones/07-persistent-characters.md)
- [milestones/08-vertical-slice.md](/docs/milestones/08-vertical-slice.md)
- [milestones/09-gameplay-reconstruction.md](/docs/milestones/09-gameplay-reconstruction.md)
- [milestones/10-testing-and-performance.md](/docs/milestones/10-testing-and-performance.md)
- [milestones/11-production-deployment.md](/docs/milestones/11-production-deployment.md)

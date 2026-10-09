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
- [01-project-overview.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/01-project-overview.md) — High-level goals, project scope, and design principles.
- [02-environment-setup.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/02-environment-setup.md) — Windows and cross-platform workstation setup.
- [03-dependencies.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/03-dependencies.md) — Verified compilers, runtimes, package managers, and libraries.
- [04-repository-structure.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/04-repository-structure.md) — Directory layout and isolation boundaries.
- [technology-decisions.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/technology-decisions.md) — Architectural Decision Records (ADRs).
- [project-roadmap.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/project-roadmap.md) — Milestone breakdown and phase sequencing.
- [implementation-backlog.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/implementation-backlog.md) — Task tracker and status definitions.
- [risk-register.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/risk-register.md) — Technical, legal, and operational risks and mitigations.
- [PROJECT_STATUS.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/PROJECT_STATUS.md) — Real-time progress, completed tasks, and resumption checkpoints.

### Engine, Simulation & Mechanics
- [gameplay-specification.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/gameplay-specification.md) — Player controls, combat, AI, and progression specs.
- [engine-design.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/engine-design.md) — Fixed-tick game loop, spatial indexing, and collision pipeline.
- [gameplay-systems.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/gameplay-systems.md) — Subsystem specifications (health, loot, inventory, stats).
- [entity-and-data-model.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/entity-and-data-model.md) — ECS architecture and state representation.
- [implementation-parity-matrix.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/implementation-parity-matrix.md) — Parity tracking against original mechanics.

### Client & Rendering
- [browser-client.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/browser-client.md) — Client modular architecture and lifecycle.
- [rendering-pipeline.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/rendering-pipeline.md) — WebGL2/Three.js rendering passes, shaders, and materials.
- [performance-budget.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/performance-budget.md) — Frame time targets, draw call budgets, memory limits.

### Multiplayer, Networking & Persistence
- [mmorpg-architecture.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/mmorpg-architecture.md) — Authoritative server design and distributed topology.
- [network-protocol.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/network-protocol.md) — WebSocket packet format, opcode schema, serialization.
- [world-simulation.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/world-simulation.md) — Server tick, movement validation, and interest management.
- [database-schema.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/database-schema.md) — PostgreSQL table definitions, relations, and migrations.
- [persistence.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/persistence.md) — Transactional state management, save/load, crash recovery.
- [security.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/security.md) — Cheating prevention, input validation, and auth tokens.
- [threat-model.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/threat-model.md) — Attack surface enumeration and security boundaries.
- [security-checklist.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/security-checklist.md) — Pre-deployment security controls and verification.

### Asset Pipeline & Legal
- [asset-pipeline.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/asset-pipeline.md) — Conversion tools, intermediate artifacts, and manifest generation.
- [asset-formats.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/asset-formats.md) — Binary format reverse-engineering specifications (`.mdl`, `.msh`, `.ctx`).
- [asset-licensing-and-distribution.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/asset-licensing-and-distribution.md) — Legal boundaries, copyright compliance, and clean-room policy.

### Testing & Operations
- [testing-strategy.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/testing-strategy.md) — Unit, integration, E2E, and regression methodology.
- [test-matrix.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/test-matrix.md) — Feature-by-feature test coverage map.
- [performance-testing.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/performance-testing.md) — Load testing, tick latency benchmarks, synthetic bot harnesses.
- [known-discrepancies.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/known-discrepancies.md) — Differences between original single-player and multiplayer engine.
- [development-workflow.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/development-workflow.md) — Day-to-day coding, running, and debugging routines.
- [deployment.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/deployment.md) — Local Docker and production deployment guidelines.
- [operations.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/operations.md) — Monitoring, logs, telemetry, and administrative tasks.
- [backup-and-recovery.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/backup-and-recovery.md) — Database backup schedules, point-in-time recovery.
- [troubleshooting.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/troubleshooting.md) — Diagnostic guides for common runtime and network faults.

### Reverse Engineering Records
- [reverse-engineering/README.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/README.md) — Methodology and forensic toolchain.
- [reverse-engineering/file-inventory.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/file-inventory.md) — Empirical inventory of the GOG installation.
- [reverse-engineering/executable-analysis.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/executable-analysis.md) — PE32 inspection, DLL dependencies, symbol analysis.
- [reverse-engineering/asset-format-discovery.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/asset-format-discovery.md) — Header dissection and layout analysis.
- [reverse-engineering/runtime-observations.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/runtime-observations.md) — Frame capture, timing measurements, hitbox findings.
- [reverse-engineering/save-format-analysis.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/save-format-analysis.md) — Save slot structures and serialization.
- [reverse-engineering/gameplay-mechanics.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/gameplay-mechanics.md) — Combat mathematics and stat curves.
- [reverse-engineering/unknowns.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/unknowns.md) — Open technical questions and verification backlogs.

### Milestone Documents
- [milestones/00-discovery.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/00-discovery.md)
- [milestones/01-environment.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/01-environment.md)
- [milestones/02-game-archaeology.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/02-game-archaeology.md)
- [milestones/03-asset-pipeline.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/03-asset-pipeline.md)
- [milestones/04-engine-foundation.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/04-engine-foundation.md)
- [milestones/05-browser-prototype.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/05-browser-prototype.md)
- [milestones/06-multiplayer-server.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/06-multiplayer-server.md)
- [milestones/07-persistent-characters.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/07-persistent-characters.md)
- [milestones/08-vertical-slice.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/08-vertical-slice.md)
- [milestones/09-gameplay-reconstruction.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/09-gameplay-reconstruction.md)
- [milestones/10-testing-and-performance.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/10-testing-and-performance.md)
- [milestones/11-production-deployment.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/milestones/11-production-deployment.md)

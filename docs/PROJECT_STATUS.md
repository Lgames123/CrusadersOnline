# Project Status: CrusadersOnline

## 1. Session Summary & Metadata
- **Current Milestone:** M04, M06 and M07 (except XP/gold, which need combat) done; M03 and M05 partially done; next is M08 (skeleton mob, melee combat, XP/gold, E2E).
- **Target Milestone:** Milestone 08 (Minimum Playable Vertical Slice).
- **Status Date:** 2026-10-09 (stack review, revision 2 of technology decisions).
- **Architectural Mode:** Clean-Room Reimplementation & Web MMORPG Architecture.

---

## 2. Completed Tasks
- [x] Audited workstation environment: confirmed Node.js v24.14.0, npm 11.9.0, Python 3.14.6, Git 2.52.0 on Windows 10.
- [x] Created root `.gitignore` with strict multi-layered filters preventing tracking of any original 3DO binaries (`.exe`, `.dll`), assets (`.mdl`, `.ctx`, `.msh`, `.ani`, `.mp3`), or local user directories.
- [x] Created `.env.example` defining database configuration, network ports, and private local asset directories.
- [x] Developed read-only forensic scanner `tools/inventory.py` and executed against the local `Crusaders of Might and Magic/` directory.
- [x] Generated `local/inventory.json` empirically cataloging 1,867 original game files (612.78 MB).
- [x] Produced architectural, dependency, and setup documentation (`docs/01-project-overview.md`, `docs/02-environment-setup.md`, `docs/03-dependencies.md`, `docs/04-repository-structure.md`, `docs/technology-decisions.md`, `docs/project-roadmap.md`, `docs/implementation-backlog.md`, `docs/risk-register.md`).

---

- [x] Stack review (2026-10-09): core stack confirmed; added ADR-003 (TypeScript converter), ADR-004 (binary hot path), ADR-005 (Rapier), ADR-006 (input-only movement), ADR-007 (Kysely), ADR-008 (argon2id + sessions + WS tickets), ADR-009 (zone workers), ADR-010 (pnpm), ADR-011 (name: CrusadersOnline). Docs, milestones, backlog and risks updated accordingly. Milestone acceptance criteria for unimplemented work were reset to unchecked.

- [x] Development session 1 (2026-10-09):
  - Git repository initialized (no commits yet); pnpm workspace with `shared`, `converter`, `client`, `tests`.
  - **M04:** shared constants/math, binary input + delta snapshot codecs, Zod control schemas, integer-keyed spatial hash, Rapier (deterministic build) character controller with per-step mm snapping, synthetic arena definition.
  - **M03 (partial):** TypeScript converter with TGA decoder, `default.ctx` table parser, host-agnostic pipeline with SHA-256 incremental cache, Node CLI (`pnpm convert`). Verified on the local install: 2,044 textures converted (82.8 MB zip -> 19 MB WebP) in 3.3 s; second run 0.1 s (cached).
  - **M05 (partial):** Vite + Three.js client — synthetic arena, mannequin, 20 Hz fixed-step prediction with the shared controller, interpolated rendering, pointer-lock input, over-the-shoulder camera with collision pull-in, debug HUD. Verified in browser: 6 m/s run, jump, wall collision.
  - 29 unit tests passing (`pnpm test`), `pnpm typecheck` clean, `pnpm --filter @crusaders/client build` succeeds.

- [x] Development session 2 (2026-10-09):
  - First commit `35eb63b` (local; not pushed). Remote `origin` = git@github.com:Lgames123/CrusadersOnline.git.
  - **M06:** `server/` package — `Transport` interface + `ws` gateway (heartbeat, 4 KB frame cap), session state machine (ticket auth -> character select -> world), token-bucket rate limits, single-use 30 s ticket store, dev guest-ticket endpoint, zone `worker_thread` with monotonic fixed-step clock and tick metrics, `WorldZone` (input queue 1/tick, shared controller, interest-filtered delta snapshots with spawn/despawn).
  - Shared `ClientSession` (browser + Node): ticket auth, prediction, exact reconciliation, remote interpolation buffer, RTT.
  - Client online mode via Vite proxy, correction smoothing, remote player mannequins, offline fallback.
  - Found and pinned a Rapier 0.20/0.21 character-controller regression (stuck on flat ground) -> 0.19.3, with regression test.
  - Verified: 35 tests passing; two browser tabs see each other with 0 corrections; tick p99 0.1–0.4 ms with 2 players.

- [x] Development session 3 (2026-10-09):
  - Server prints a clear error and exits when its port is already in use.
  - **M07:** Kysely + plain-SQL migrations (`001_initial_schema.sql`), PGlite dialect for development/tests (no Docker/PostgreSQL on this machine), `pg` for real servers. Accounts with argon2id, opaque server-side sessions (SHA-256 stored) in an `HttpOnly; SameSite=Strict` cookie, `/api/auth/{register,login,logout,me}`, `/api/ws-ticket`, per-IP and per-username rate limits. Characters spawn at their saved position; saved on leave, every 60 s and on shutdown. One connection per character. `pnpm db:migrate`.
  - Client login/registration panel (guest and offline options), auto-login from the session cookie, logout.
  - Verified: 40 tests (10 integration, incl. position surviving a server restart); in the browser: register -> play -> reload -> auto-login at the saved position -> logout.

- [x] Reverse-engineering session 1 (2026-10-09):
  - IDA Pro MCP configured but not reachable (IDA not running), so the work was data-first.
  - **`.mdl` fully specified** from the data (in-memory struct dump with stale pointers): header, depth-first nodes with subtree sizes, local quaternion + translation, rigid per-node skinning, 50-byte faces with per-corner UVs, normals, name table, collision spheres, weapon line dummies, attachment dummies. 265/267 files match byte for byte; bind pose reproduces the header bounding box exactly. Probe: `tools/re/mdl_probe.py`.
  - Converter: `mdl.ts` parser, `models_ctx.ts` bindings, skinned GLB emitter (external WebP textures). `pnpm convert` produces 247 models in 0.6 s.
  - Dev model viewer (`/viewer.html`): Drake, skeleton warrior and props render textured, with the collision spheres on the body.
  - 45 tests passing (includes a synthetic `.mdl` fixture).

- [x] Session 5 (2026-10-09):
  - **Real PostgreSQL:** Docker (inside WSL `dml-arch`) runs PostgreSQL 18 via `deployment/docker-compose.dev.yml`. Persistence tests run on both PGlite and PostgreSQL (fresh database per group) and include a concurrent-registration race; all pass on both.
  - **Ghidra:** the animation system was located and its functions renamed (executable-analysis.md §6). The `.ani` format was fully decoded from the evaluator: packed per-bone nibble flags, constant or piecewise-cubic channels in absolute frame time, root X/Z locked (root motion), 3ds Max tick events. 1,499/1,501 pairs verified. Probe: `tools/re/ani_probe.py`.
  - Converter: `ani.ts` parser and evaluator; models now carry their animation clips (1,501 in total, 106 for Drake) with labels, events and root motion. The dev viewer plays them.
  - Handedness confirmed (left-handed source, mirrored correctly); converted characters face −Z, like the client.
  - Locomotion speeds measured from root motion (gameplay-mechanics.md).
  - 50 tests passing on PGlite, plus 7 on PostgreSQL when enabled.

- [x] Session 6 (2026-10-09):
  - Commit `20e9f44` pushed to `origin/main`.
  - Windows toolchain: Docker Desktop 29.8.2 (Linux engine, Compose v5.5.1) verified; native PostgreSQL 18 running on port 5433 (scram-sha-256, localhost only) — app role script `deployment/sql/create_dev_database.sql` to be run by the user (needs the superuser password).
  - **Containerisation:** `Dockerfile.server`, `Dockerfile.client` (Caddy), `Caddyfile`, `docker-compose.yml`, `.dockerignore`, `deployment/.env.example`. Full stack verified end to end through Caddy (static client, cookie auth, WebSocket upgrade, movement).
  - **Bug found and fixed:** shutdown waited for clients to finish the WebSocket close handshake before saving; an unresponsive client meant connected characters were not saved on `docker restart`. New shutdown order flushes the zone first; covered by a new integration test (child process that stops servicing its socket). Verified on the container stack: position restored after restart.
  - Dev database compose moved to port 5434. 58 tests passing on PGlite + PostgreSQL.

- [x] Session 7 (2026-10-09):
  - Commits `2da6981` (containerisation, shutdown fix, port 8090) and `f98db37` (UV fix: engine texture origin is bottom-left; Drake's face no longer on his back).
  - **M08 combat:** Skeleton Warrior with aggro/chase/attack/leash/respawn, authoritative swings with combo and spam protection, cone hit tests, player death/respawn, XP/gold/level rewards persisted immediately; stats and combat events in the protocol.
  - **Client:** attack on left click, damage numbers, health bars, HP/XP/gold panel, death notice; in development the original Drake and Skeleton Warrior models and animations are used.
  - 7 new unit tests on the zone (combo damage 12/15/19, rewards, spam limit, death/respawn, level-up, leash) and a network test (kill → reward → reconnect keeps XP/gold) on PGlite and PostgreSQL. 59 tests total. Verified in the browser: kill sequence with combos, +25 XP +7 gold, HUD updated.

- [x] Reverse-engineering session 3 (2026-10-09):
  - Fixed folded characters (`.ani` quaternions are (w, x, y, z)); pushed through `9738d4c`.
  - Ghidra + Capstone: locomotion and jumps are root-motion driven (`Char_RootMotionVelocity` etc.), fallback speed 15 u/s; `default.ctx` loader mapped to player fields; effective attributes (cap 50) and derived stats recovered: max HP, max mana, damage multiplier, speed multiplier; weapon hit = stronger of slash/bash × multiplier. Implemented and tested in `shared/src/game/original_stats.ts`.

- [x] Reverse-engineering session 4 (2026-10-09):
  - `tools/re/ghidra/CreateFunctionsFromVtables.java` created 827 missing functions in the Ghidra database.
  - Full damage pipeline recovered: 11-type damage vector; outgoing = (unarmed + weapon) → stronger of slash/bash × Might multiplier → × attack mode (1.0/1.25) → + bonus → × multipliers; incoming = max(0, dmg − absorb) × resist(DR by difficulty) × armour protection, summed; flinch/stagger roll; shield block cone (cos(30 rad) ≈ ±81°, original quirk).
  - `items.ctx` parser (156 items) → `rules/items.json`; formulas in `shared/src/game/original_stats.ts`. 64 tests.

### Not Yet Done
- Playwright two-tab E2E (M08 criterion 14).
- Wire the original formulas into server combat (CMB-001).
- TLS on a real domain, backups, CI, image registry (M11).
- World unit / physics constants (UNK-007), `.msh` levels, `.cap` collision.
- Converter: browser Web Worker host, `.mdl`/`.ani`/`.msh` parsers, `items.ctx`/`models.ctx` parsers.
- Client: 60 FPS and camera clipping not yet verified interactively (browser pane was hidden during the session).
- Performance figures in the docs are targets, not measurements.

---

## 3. Verified Empirical Results
- **Game Files Cataloged:** 1,867 files totaling 612.78 MB.
  - 3D Models: 267 (`.mdl`)
  - Level Geometry Meshes: 25 (`.msh`)
  - Animation Tracks: 402 (`.ani`)
  - Collision Capsules: 84 (`.cap`)
  - Audio Soundtracks: 730 (`.mp3`)
  - Sound Effects: 302 (`.wav`)
  - Texture Containers: 6 (`.ctx`), 1 (`.czx`), 1 (`.tex`)
  - Video Cinematics: 2 (`.bik`)
  - Native Executables & DLLs: 4 (`.exe`), 15 (`.dll`)
- **System Toolchain:** Node.js v24, npm 11, Python 3.14, Git operational on host.

---

## 4. Files Created or Modified
- `.gitignore` (IP protection)
- `.env.example` (Configuration template)
- `tools/inventory.py` (Forensic scanner)
- `local/inventory.json` (Catalog output, private machine data)
- `docs/README.md`
- `docs/01-project-overview.md`
- `docs/02-environment-setup.md`
- `docs/03-dependencies.md`
- `docs/04-repository-structure.md`
- `docs/technology-decisions.md`
- `docs/project-roadmap.md`
- `docs/implementation-backlog.md`
- `docs/risk-register.md`
- `docs/PROJECT_STATUS.md`

---

## 5. Commands Executed
- `node -v; npm -v; git --version; python --version; cargo --version`
- `Get-ChildItem -Recurse '.\Crusaders of Might and Magic' | Group-Object Extension -NoElement`
- `python tools/inventory.py ".\Crusaders of Might and Magic" --out "local/inventory.json"`
- `python -c "import json; data=json.load(open('local/inventory.json')); ..."`

---

## 6. Known Failures & Diagnostic Findings
- `cargo` is not installed in the Windows PATH.
  - *Impact:* Evaluated in ADR-001; decision made to use TypeScript/Node.js for authoritative server simulation, removing Rust as a hard requirement and aligning with the active Node v24 toolchain.

---

## 7. Outstanding Questions & Research Items
1. What internal structure exists in `.mdl` files (fixed header size, vertex stride, bone table offsets)?
2. Does `uz.dll` indicate that `.ctx` or `.czx` texture archives use standard PKWARE/zlib deflate compression?
3. What is the coordinate scale and gravity constant in `crusaders.exe` (units per meter)?

---

## 8. Next Recommended Tasks
1. M08: skeleton mob with aggro/chase, authoritative melee, HP/XP/gold with persistence, Playwright two-tab E2E.
2. Run the persistence tests against a real PostgreSQL (Docker or native install — user decision).
3. Converter: browser worker host; begin `.mdl` format investigation (ARC-004).

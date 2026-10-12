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

- [x] Session 8 (2026-10-09): server combat switched to the original rules — difficulty attribute/resist columns (`DIFFICULTY`, default medium), max HP 50 + 0.6 × END × level, weapon hit (stronger of slash/bash × Might multiplier, power hit 1.25), Axe starting weapon (speed 1.1), resist × armour on incoming damage, flinch/stagger interrupts. Verified live: 65 HP start, hits 5/5/6.25, skeleton hits 7.2–10.8. 66 tests.
- [x] Shield block (right mouse, input flag bit 6): original ±81° frontal cone, stops the whole hit, not while swinging or flinching; `pt01_rdy_shld` clip / procedural shield raise. 69 tests.

- [x] Session 9 (2026-10-09):
  - Reverse engineering: creature template table (50 types: loadout, disposition, spell mask), creatures deal their whole weapon vector, original XP curve (500 / 1500 / 3500 / 6500 / 10500 / +4000), level-up adds the max-HP gain, block = whole hit (executable-analysis.md §9).
  - Inventory and equipment: item catalog (built-in or converted items.json), 32-slot inventory persisted in `inventory_items`, `CS_EQUIP_ITEM` / `SC_INVENTORY_UPDATE`, inventory window (I), skeleton with Long Sword + Wooden Shield, loot drops.
  - Playwright two-tab E2E (`pnpm test:e2e`): player 2 sees player 1 move, fight and despawn. 75 tests + 1 E2E.

- [x] Session 10 (2026-10-09):
  - Reverse engineering: `.cap`/`.msh` use PKWARE DCL compression (own decoder `tools/re/pkware_dcl.py`); `.cap` = level object placements with per-creature HP, XP, disposition and resists (`tools/re/cap_creatures.py`, UNK-009 resolved). The Skeleton Warrior now uses its original 25 HP, 40 XP and resists.
  - Creature shield AI: skeletons raise their shield against frontal swings (35%, 0.7 s, 1.5 s cooldown; slice values).
  - M11: GitHub Actions CI (typecheck, tests incl. PostgreSQL 18, E2E, GHCR images), scheduled `pg_dump` backups with restore script (drill done), HSTS on HTTPS. 77 tests + 1 E2E.

- [x] Session 11 (2026-10-10): **original levels in the browser.**
  - `.msh` decoded on 24 of 25 levels (asset-format-discovery.md §6.3): cells → faces → render fragments, texture axes, RGB555 lightmaps.
  - The converter writes level GLBs, lightmap atlases and collision meshes, plus `.cap` placements for all 84 acts (2,037 creatures).
  - The client renders an original level (textures × baked lightmap, sky box around the camera). Rapier collides against the original triangle mesh on both server and client.
  - Skeleton Warriors spawn where the original placed them, with each placement's HP, XP and resists.
  - Run with `ARENA=level:ca1a` on the server, or offline with `http://localhost:3000/?level=ca1a`. 81 tests.

- [x] Session 12 (2026-10-10): **populated levels.**
  - `.cap` generic object records decoded (components: transform, class data, render model id) for all 12,025 objects.
  - The client renders props, ground items and chests with their original models, plus torch flames with a pooled point-light set.
  - The server handles world objects: pick up items with E (gold, stacking potions, equipment), open chests, break props by melee (HP from the placement). Objects respawn after 5 minutes. Healing potions can be drunk from the inventory.
  - New melee archetypes: Skeleton Ghost, Shadow, Dark Mage (template loadouts, placement stats; model texture variants).
  - Original audio: Sound.ctx registry, executable creature and impact sound tables, swings, cries, block, chest, breaking, level-up, stone footsteps.
  - Reviewed `GeminiDecomp/` (local, git-ignored): verified Sound.ctx, textures.nfo, the ASM state table and the creature templates; rejected unverified claims. 85 tests.

- [x] Session 13 (2026-10-10): **the game in any browser, not just the dev server.**
  - The converter runs in the browser (Web Worker; WebP via OffscreenCanvas, PNG fallback; Cache Storage sink; lazy File reads). A full import takes about 25 s in Edge.
  - A service worker serves imported assets at /generated/*, and the dev-only gates are gone.
  - The import panel lets players pick their installation folder, re-import or remove it.
  - The server container mounts the operator's conversion; `ARENA` is configurable.
  - Same-floor mob aggro and spawn points 15+ m from any hostile.
  - New E2E `import_game.spec.ts` (local only; skipped without an installation) checks the import and the service-worker serving. 85 tests + 2 E2E.

- [x] Session 14 (2026-10-10): **level transitions — a connected world.**
  - `.cap` portals decoded (192; asset-format-discovery.md §6.2.2).
  - One zone worker per arena, started on demand (`ZoneManager`).
  - Walking into a portal moves the player to the destination zone, at its portal leading back. HP, XP, gold and inventory carry over, and the character's zone is saved, so login resumes there.
  - The client swaps levels in place (SC_ZONE_CHANGE / CS_ZONE_READY), without a page reload.
  - Verified in the browser: Cs1b-Inn → Cs1b. Integration test on two generated levels. 86 tests.
- [x] Session 15 (2026-10-11): **classic feel — camera, speeds, locomotion animations.**
  - Direction agreed with the user: the original's feel by default; quality-of-life features as options. Presentation options are per player; gameplay rules are per server.
  - Original camera recovered from the exe and made the default: `ClassicCamera`, executable-analysis.md §10. The former camera stays as the "Modern" setting.
  - Settings on the click-to-play screen: camera mode, mouse sensitivity, invert Y.
  - Original controls moved from ESDF to WASD (keybindings.ts).
  - Player speeds from Drake's root motion (§11): run 15.6 ft/s, retreat 3.9, sidestep 10.3.
  - models.ctx ASM state bindings kept by the converter. Retreat and sidestep clips are played.
  - 87 tests + 2 E2E.
  - Open: turn and look rates (UNK-011); jump impulse and clip playback rate (UNK-012).

- [x] Session 16 (2026-10-11 → 10-12): **the original's combat, measured live (x32dbg, then Frida).**
  - Physics and controls from x32dbg: gravity 78.4 ft/s², jump 50.45 ft/s with hold-lift and rising drag, air control and travel limits, turn rates (ground 270°/s, air 80°/s, arrows 200°/s, numpad look 150°/s), clip rate 1000/30 fps (executable-analysis §13–14).
  - Melee: clip-event timing, reach and arc, attack keys, the five-step combo (routine 0x0042CA20 decoded), side swings and the air swing on the upper body, the wall jab, attacks that carry Drake by root motion (combo steps 1/3/5, jump attack).
  - Shield: upper-body layer over the legs, walk / retreat / side hops with root-motion curves, diagonal hops.
  - Hit reactions from the HP-loss rule (v = 0.5·rand + damage/HP: 0.7–0.8 knock-down PI02, ≥ 0.8 stun), confirmed live; every landed hit interrupts the target.
  - Skeleton AI from four Frida logs of its SetNextState requests (0x004C8900): distance bands, lunge, direct swings, jab, retreat to 8 ft, stance shield 0.82 s, chains and bursts, rare shield bash. Reactive block kept as an option.
  - Equipment rendered at the models' attachment dummies (w-first quaternions); death clips keep their root motion.
  - Tools: Frida runner for non-pausing hooks and hardware watchpoints (memory note `frida-runtime-capture`).
  - 92 tests + 2 E2E.

### Not Yet Done
- Spells beyond Torch Light (the framework is in: spell table from default.ctx, spell books, mana and regeneration, conjuring, R / T keys, persistence): fireball, slow, freeze, stoneskin, lightning, heroism, spectral ally, revelation, holy wrath, soul drinker need live captures; creature spells / ranged attacks; mana regeneration rate (one sample).
- Creature hit reaction IMPACT_FRONT_TWO_STEPS_BACK (PI31); the third combo step's recoil (plays backwards after its impact); combo chain 105–107 (COMBO 6–8, weapon class unknown).
- Idle zones are never stopped; portals to acts without a converted mesh (Ws_a) answer "This way is blocked".
- Ogre / Dasher / Dwarf / elemental archetypes, levers, the original door scripting (doors are simplified: Tab opens, Z + key unlocks, they slide up and stay open) and scripted sequences, brush textures, `Ws_a.msh`, material-based footsteps.
- Packaging the converter for players (browser conversion into OPFS) so original levels work outside the dev server.
- Original AI maneuver scripts.
- First deployment on a real domain (TLS certificate), off-host backups, metrics.
- World unit / physics constants (UNK-007), `.msh` levels, `.cap` collision.
- Converter: browser Web Worker host, `.mdl`/`.ani`/`.msh` parsers, `items.ctx`/`models.ctx` parsers.
- Client: 60 FPS and camera clipping not yet verified interactively (browser pane was hidden during the session).
- Load: 100 bots in a real level run at p50 ~8–10 ms with a p99 of 13–24 ms (borderline for the 15 ms target) and ~29 KB/s per client (target 5 KB/s); see performance-testing.md §3.

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

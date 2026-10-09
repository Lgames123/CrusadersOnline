# Project Status: CrusadersOnline

## 1. Session Summary & Metadata
- **Current Milestone:** M04 done; M03 and M05 partially done; next is M06 (authoritative server).
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

### Not Yet Done
- No commits yet; `server/` package not created (M06).
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
1. First commit of the workspace.
2. M06: `server/` package — `Transport` + `ws` gateway, zone worker, fixed-step clock, input queue, per-client delta snapshots.
3. Client networking: prediction/reconciliation against the server, remote player interpolation.
4. Converter: browser worker host; begin `.mdl` format investigation (ARC-004).

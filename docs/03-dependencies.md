# 03 - Dependencies: Technical Stack & Package Manifest

## 1. Objective

Catalog all official runtimes, package dependencies, and utilities required across the CrusadersOnline stack: Browser Client, Authoritative Server, Shared Library, Asset Converter, and Automated Test Suites. Rationale for each choice lives in [technology-decisions.md](technology-decisions.md).

---

## 2. System Level Prerequisites

| Tool | Minimum Version | Verified Local Version | Official URL | Purpose |
|---|---|---|---|---|
| **Node.js** | 24.x LTS | 24.14.0 | https://nodejs.org/ | Server runtime, converter CLI, tooling |
| **pnpm** | 10.x | 12.4.2 | https://pnpm.io/ | Workspace package manager (ADR-010) |
| **Git** | 2.40+ | 2.52.0 | https://git-scm.com/ | Version control |
| **PostgreSQL** | 17 (18 recommended) | Not installed | https://postgresql.org/ | Relational player persistence |
| **Docker Desktop** | Optional | Not verified | https://docker.com/ | Local PostgreSQL and production parity |
| **Python** | 3.10+ (optional) | 3.14.6 | https://python.org/ | Reverse-engineering research scripts only (`tools/`) |

> Exact package versions are pinned by `pnpm-lock.yaml` at scaffold time. The ranges below are minimum majors.

---

## 3. Package Dependency Manifest

### 3.1 Shared Library (`shared/`)
Code that must behave identically on client and server:
- **`typescript`** (`>=7`, native compiler): Type-checking. Sources use erasable-only syntax so Node 24 runs them directly.
- **`zod`** (`>=4`): Validation of **control** (JSON) messages only.
- **`@dimforge/rapier3d-deterministic-compat`** (pinned `0.19.3`): Cross-platform deterministic Rapier build — collision world and kinematic character controller used by the shared movement step (ADR-005). The deterministic build makes client prediction and server simulation bit-identical.
- Binary codecs (`shared/src/protocol/binary/`) are hand-written over `DataView` — no dependency.

### 3.2 Authoritative Game Server (`server/`)
- **`ws`** (`>=8`): WebSocket server, wrapped by the `Transport` interface (ADR-004).
- **`@types/ws`** (dev).
- **`pg`** (`>=8`): PostgreSQL driver / pool.
- **`kysely`** (`>=0.27`): Typed SQL query builder, transactions, row locks, migrator (ADR-007).
- **`argon2`** (`>=0.40`): argon2id password hashing (ADR-008).
- **`pino`** (`>=9`): Structured JSON logger. **`pino-pretty`** for dev only.
- **`tsx`** (dev): TypeScript watch runner for development.
- Environment loading uses Node's built-in `--env-file` / `process.loadEnvFile()` (no `dotenv`).

### 3.3 Asset Converter (`converter/`)
Single TypeScript implementation with Node and browser hosts (ADR-003):
- **`@gltf-transform/core`** (`>=4`): glTF 2.0 / GLB document construction (meshes, skins, animations).
- **`fflate`** (`>=0.8`): Isomorphic ZIP reading for `Textures/textures.zip`.
- **`sharp`** (`>=0.33`, Node host only): WebP/PNG encoding in the CLI.
- Browser host encodes images with `OffscreenCanvas.convertToBlob()` — no dependency.
- TGA decoding is implemented in `converter/src/formats/tga.ts` (simple format, no dependency).
- **Movies (Bink → WebM), no package dependency.** Node host: the player's own **FFmpeg** (`FFMPEG`
  env var, else `ffmpeg` on the PATH; needs the `binkvideo` decoder and `libvpx` / `libvorbis`
  encoders, as the gyan.dev and most distribution builds have). Without it the movies are left out
  with a warning. Browser host: **ffmpeg.wasm core 0.12.10** (`@ffmpeg/core`, GPL-2.0-or-later),
  fetched from cdn.jsdelivr.net only when the picked folder has movies, checked against the npm
  package's SHA-256, run in the import worker. Neither is bundled, hosted or redistributed by the
  project; FFmpeg runs as a separate program over the player's own files.

### 3.4 Browser Client (`client/`)
- **`three`** (`>=0.170`) and **`@types/three`**: Scene graph, WebGL2 rendering, glTF loading, skeletal animation.
- **`vite`** (`>=8`): Bundler and HMR dev server.
- **`howler`** (`>=2.2`): Web Audio wrapper for spatial audio cues.
- **`lil-gui`** (dev HUD): In-game debug panel.

### 3.5 Automated Testing & Tooling (`tests/`)
- **`vitest`** (`>=5`): Unit and integration tests.
- **`@playwright/test`** (`>=1.48`): Multi-client browser E2E tests.
- **`supertest`**: HTTP endpoint tests for auth/character routes.
- **`@testcontainers/postgresql`** (optional): Real PostgreSQL for persistence integration tests.

### 3.6 Reverse-Engineering Research (`tools/`, optional)
Python is used only for read-only investigation scripts (`inventory.py`, `analyze_pe.py`, format probes). No Python package is required to build, run or convert assets. `Pillow` may be installed ad hoc for inspecting images.

---

> **Rapier pin:** 0.20.0 and 0.21.0 (both standard and deterministic builds) have a kinematic character controller regression: capsules get stuck on flat cuboid ground at roughly a third of start positions. 0.19.3 is unaffected. A regression test (`tests/unit/movement.test.ts`) guards any upgrade.

## 4. Installation Steps

### 4.1 Enable pnpm
```powershell
# Shell: PowerShell
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version
```

### 4.2 Install Workspace Dependencies
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
pnpm install
```

---

## 5. Verification Commands

```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
node --version
pnpm --version
pnpm -r exec tsc --version
```
*Expected Output:*
- Node `v24.x`
- pnpm `10.x`
- TypeScript `5.x` (or newer) for every workspace package

---

## 6. Acceptance Criteria

- [ ] Every runtime dependency listed with purpose and minimum version.
- [x] `pnpm install` succeeds on a clean checkout.
- [ ] Lockfile committed.
- [x] Zero external dependencies require downloading proprietary assets.

---

## 7. Troubleshooting

| Error | Cause | Remediation |
|---|---|---|
| `pnpm : The term 'pnpm' is not recognized` | Corepack not enabled | Run `corepack enable` from an elevated shell. |
| `sharp` install fails | Prebuilt binary download blocked | Run `pnpm rebuild sharp`; ensure network access to npm registry. |
| Rapier `RuntimeError` at startup | WASM not initialized | `await RAPIER.init()` before creating the world (client and server boot). |

---

## 8. Dependencies & Next Steps

Proceed to [04-repository-structure.md](04-repository-structure.md) to inspect directory architecture and physical isolation boundaries.

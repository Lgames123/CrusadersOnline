# 01 - Project Overview: CrusadersOnline Browser MMORPG

## 1. Objective

This document defines the high-level mission, scope, architectural philosophy, and non-negotiable boundaries for **CrusadersOnline**, a clean-room reconstruction of the gameplay of *Crusaders of Might and Magic* (3DO, 1999) as a persistent browser-based MMORPG. The project name and all branding are "CrusadersOnline" only; the original title is a third-party trademark used solely to identify the source game (ADR-011).

The ultimate objective is a multiplayer web game where players explore interconnected zones, engage in skill-indexed third-person melee and ranged combat, interact with NPCs, acquire loot, and progress persistently in a shared world, using modern web technologies (TypeScript, WebGL2/Three.js, Rapier, Node.js authoritative server, and PostgreSQL). See [technology-decisions.md](technology-decisions.md).

---

## 2. Prerequisites

1. Operating system: Windows 10/11 x64 workstation (or Linux/WSL2 equivalent).
2. Runtime tools: Node.js (>= 24.x, verified 24.14.0), pnpm (>= 10.x, via Corepack), Git (verified 2.52.0). Python (verified 3.14.6) is optional, for research scripts only.
3. Legally acquired game data: Local GOG installation of *Crusaders of Might and Magic* owned by the user (stored outside public version control).
4. Strict IP isolation configured via `.gitignore`.

---

## 3. Investigation & Scope Definition

### 3.1 What Crusaders of Might and Magic Is
Released in December 1999 by The 3DO Company, *Crusaders of Might and Magic* was a 3D third-person action RPG set in the *Might and Magic* universe. Key defining gameplay elements include:
- Third-person over-the-shoulder chase camera.
- Gridless free-form physics: jumping, strafing, ledge clambering, fall damage.
- Real-time weapon combat: sword swings, shield blocking, combo chains, projectile/magic casting.
- Linear-to-hub zone progression: dungeons, citadels, catacombs, strongholds.
- RPG progression: XP, leveling, strength/endurance/intellect stats, weapon skill upgrades, spellbook progression.
- Static and animated props: chests, doors, switches, breakables.

### 3.2 What the Reconstruction Expands (The MMORPG Layer)
The original game was strictly single-player. Reconstructing it as a persistent MMORPG requires augmenting its architecture with:
1. **Server-authoritative state:** Movement physics, combat hitboxes, inventory mutations, and enemy AI run entirely on the server.
2. **Multi-client spatial synchronization:** Interest management (grid/spatial hash), entity state interpolation, and delta compression.
3. **Account & session lifecycle:** Secure authentication, multi-character slots, persistent inventory, and bank storage in PostgreSQL.
4. **Cooperative & contested encounters:** Shared enemy aggro tables, instanced or public zone mob respawn rules, drop allocation.

---

## 4. Design & Clean-Room Boundaries

### 4.1 Strict Intellectual Property Policy
To ensure total legal compliance and protect intellectual property:
- **Zero Proprietary Asset Distribution:** No assets (textures, meshes, audio, dialogue, level maps, video) from 3DO/Ubisoft are included in the repository, distributed over the public web, or bundled into client builds.
- **Client/User Asset Feeding:** The public client ships with synthetic, greybox geometric test assets and procedural sounds. Users who legally own the game convert their local files with the TypeScript converter, either via `pnpm convert` or in the browser (File System Access API → Web Worker → OPFS/IndexedDB).
- **Clean-Room Logic:** All server systems, networking packets, game logic, and shaders are written from first principles without copying original disassembled binary machine code into source.

### 4.2 System Topology
```
[ User Browser (Client) ]
   | (WSS / binary inputs & snapshots, JSON control messages)
   v
[ Edge Gateway / Static Server ]
   |
   v
[ Authoritative Game Server (Node.js/TS, one 20Hz worker per zone) ]
   |-- Spatial Hash World Manager
   |-- Shared Rapier Movement Controller & Combat Hit Queries
   |-- Entity Component System (ECS)
   |-- Database Access (pg + Kysely)
   |
   v
[ PostgreSQL 18 DB ] (Durable User, Session, Character, Inventory, Quest State)
```

---

## 5. Implementation Steps

### 5.1 Verification of Environment
Run from PowerShell in the workspace root:
```powershell
# Shell: PowerShell 7+ / Windows PowerShell
# Working Directory: CrusadersOnline/
node -v
pnpm -v
git status
```
*Expected Output:*
- Node version >= 24.0.0
- pnpm version >= 10.0.0
- Git repository active with `.gitignore` tracking.

### 5.2 Verification of Local Game Directory
```powershell
# Verify that the local Crusaders of Might and Magic directory is present
Test-Path ".\Crusaders of Might and Magic"
```
*Expected Output:* `True`.

---

## 6. Testing Strategy

1. **Synthetic Mode Testing:** Verify that the client and server run completely and allow two connected players to fight a dummy enemy without requiring any original game files.
2. **User-Fed Pipeline Testing:** Verify that when a user points the conversion tool to their local game directory, meshes and textures convert to standard glTF/WebP and load correctly without publishing them to any server.

---

## 7. Acceptance Criteria

- [x] Zero copyrighted game files are committed to Git.
- [x] The architecture diagram and subsystem responsibilities are explicitly documented.
- [x] The boundaries between original single-player mechanics and new MMORPG systems are defined.
- [ ] Local developer commands are fully functional in PowerShell (pending workspace scaffold).

---

## 8. Troubleshooting

| Symptom | Cause | Diagnostic Command / Fix |
|---|---|---|
| `git status` shows `.mdl` or `.exe` files | Missing or malformed `.gitignore` | Check `.gitignore` rules; run `git rm --cached -r .` if files were staged. |
| Game directory not found | Incorrect folder name or path | Confirm path in `.env` matches your local install path. |

---

## 9. Dependencies & Next Steps

- **Downstream Documents:** Proceed to [02-environment-setup.md](/docs/02-environment-setup.md) and [03-dependencies.md](/docs/03-dependencies.md).
- **Evidence Confidence:** High (Verified on local Windows 10 machine with GOG game files cataloged).

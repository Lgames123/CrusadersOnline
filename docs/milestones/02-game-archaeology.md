# Milestone 02: Game Archaeology & Forensic Analysis

## 1. Objective
Perform forensic analysis of `crusaders.exe`, unpack format headers, and document game balancing constants.

## 2. Prerequisites
- Milestone 01 complete.
- Local game files cataloged in `local/inventory.json`.

## 3. Investigation
- Dissect `crusaders.exe` PE headers, section table, and imported DLLs.
- Inspect `Textures/textures.zip` (verified: 2,045 `.tga` files).
- Inspect `script/*.ctx` balancing tables (verified: Drake base stats and damage types).

## 4. Acceptance Criteria
- [x] PE architecture confirmed as x86 32-bit compiled with MSVC 6.0.
- [x] Graphics HAL architecture verified via `gfxdll.cfg` (`gfx_d3d.dll`).
- [x] All 1,867 files categorized in `docs/reverse-engineering/file-inventory.md`.

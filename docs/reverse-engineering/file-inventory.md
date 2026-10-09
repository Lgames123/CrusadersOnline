# File Inventory: Crusaders of Might and Magic (GOG Release)

## 1. Overview & Verification Summary

- **Inspection Source:** Local user installation (`Crusaders of Might and Magic/`)
- **Scanner Tool:** `tools/inventory.py` (Read-only forensic script)
- **Inventory Artifact:** `local/inventory.json` (Machine-local, git-ignored)
- **Total Cataloged Files:** 1,867
- **Total Installation Footprint:** 612.78 MB (642,544,128 bytes)
- **Verification Confidence:** `[CONFIRMED]`

---

## 2. Global Extension & Category Breakdown

| Category | Extension | Count | Description / Role |
|---|---|---|---|
| **Audio Music** | `.mp3` | 730 | Ambient and dynamic music tracks (MPEG Layer-3) |
| **Animation Tracks** | `.ani` | 402 | Keyframe transformation and skeleton tracks |
| **Audio SFX** | `.wav` | 302 | Sound effects (weapons, impacts, monsters, footsteps) |
| **3D Models** | `.mdl` | 267 | Rigged character, monster, weapon, and prop models |
| **Collision Capsules** | `.cap` | 84 | Capsule / cylinder collision bounds |
| **Mesh Geometry** | `.msh` | 25 | Level geometry and terrain meshes |
| **Native Libraries** | `.dll` | 15 | Direct3D HAL, Miles Sound System, helper modules |
| **Texture Containers** | `.ctx` | 6 | Multi-texture binary containers |
| **Miles Drivers** | `.m3d` | 5 | Miles Sound System 3D audio drivers |
| **Documentation** | `.txt` | 5 | EULA, Readme, changelogs |
| **Executables** | `.exe` | 4 | Main game, uninstaller, configuration tool, installer |
| **Icons** | `.ico` | 3 | GOG and Windows application icons |
| **Stage Definitions** | `.stg` | 2 | Level scene manifests and entity placement tables |
| **Binary Tables** | `.bin` | 2 | Packed lookup tables / script bytecodes |
| **Video Cinematics** | `.bik` | 2 | RAD Game Tools Bink video cutscenes |
| **Configuration** | `.cfg` / `.ini` | 2 | `gfxdll.cfg` (HAL selection) and uninstaller config |
| **Texture Archives** | `.czx` | 1 | Compressed texture archive |
| **Compressed Drivers** | `.asi` | 1 | MP3 decoder ASI plugin (`Mp3dec.asi`) |
| **Texture Index** | `.tex` | 1 | Global texture lookup table |
| **Lookup Array** | `.ary` | 1 | Array data definition |
| **Data Table** | `.tab` | 1 | Numerical item/stat table |
| **Installer Data** | `.dat` / `.msg` | 2 | GOG InnoSetup metadata |
| **Driver Helper** | `.VXD` | 1 | Legacy Windows 98 virtual device driver |

---

## 3. Directory Subsystem Analysis

### 3.1 `Models/` (3D Entities & Props)
Contains 267 `.mdl` files and associated `.ani` files.
- `drake.mdl`: Protagonist character model (Drake).
- `skel*.mdl`: Skeleton warrior variations (sword, shield, archer).
- `ogre*.mdl`: Ogre and brute monster archetypes.
- `dwarf*.mdl`: Dwarven citadel inhabitants and blacksmiths.
- `wpn_*.mdl`: Detachable weapon attachments (swords, maces, shields, bows).

### 3.2 `Meshes/` (Level Architecture & Terrains)
Contains 25 `.msh` files representing zones:
- Citadel, Catacombs, Stronghold, Duskwood, Canyons, Corrak's Sanctuary.
- Accompanied by `.stg` stage definition manifests that anchor static props, spawn volumes, and trigger regions.

### 3.3 `Textures/` (Surface Graphics)
Contains `.ctx` containers (e.g. `world.ctx`, `creatures.ctx`, `items.ctx`) and compressed `.czx` bundles.
- These archive files bundle paletted (8-bit) and 16-bit RGB 565 textures mapped to `.mdl` and `.msh` vertex UV coordinates.

### 3.4 `Sound/` & `Music/` (Acoustic Assets)
- `Sound/`: 302 uncompressed PCM `.wav` files (22,050 Hz and 44,100 Hz, 16-bit mono/stereo) covering blade clashes, spell incantations, pain grunts, and ambient water drips.
- `Music/`: 730 short and looped `.mp3` tracks loaded dynamically by `Mp3dec.asi` for adaptive ambient score.

### 3.5 `script/` (Gameplay & Dialogue Triggers)
Contains `.bin` files and dialogue lookup tables mapping NPC conversations and quest advancement flags.

---

## 4. Verification Evidence & Hashes

Representative non-sensitive file records cataloged in `local/inventory.json`:
- `crusaders.exe`: 1,085,440 bytes | SHA256 verified
- `gfx_d3d.dll`: 110,592 bytes | SHA256 verified
- `gfx_sw.dll`: 258,048 bytes | SHA256 verified
- `gfxdll.cfg`: 20 bytes (Contains `gfx_d3d.dll`) | SHA256 verified
- `audio.dll`: 33,792 bytes | SHA256 verified
- `mss32.dll`: 319,488 bytes (Miles Sound System v5.0+) | SHA256 verified

---

## 5. Next Steps

Proceed to [executable-analysis.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/reverse-engineering/executable-analysis.md) for binary dissection of `crusaders.exe`.

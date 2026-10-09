# Asset Format Discovery: Crusaders of Might and Magic

## 1. Executive Forensic Findings

Our empirical forensic examination of the user's local GOG installation revealed groundbreaking insights into the 1999 3DO engine asset architecture:

1. **Textures (`Textures/textures.zip`):**
   - Packaged in a standard PKWARE zip archive (`textures.zip`, 82.8 MB).
   - Contains **2,045 standard Truevision Targa (`.tga`) files**.
   - Standard dimensions: 64x64, 128x128, 256x256, 16-bit and 24/32-bit RGB/RGBA with alpha channels.
   - Standard Targa headers (`0x00 0x00 0x02` uncompressed RGB).
   - Conversion complexity: **Trivial**. A small TGA decoder in `converter/src/formats/tga.ts` parses these without reverse-engineering bespoke decompression.

2. **Configuration & Balancing Tables (`script/*.ctx`):**
   - Contrary to early hypotheses of `.ctx` being a binary texture container, **`.ctx` files are plain-text game configuration and balance scripts**.
   - Files include:
     - `default.ctx`: Character starting attributes (Might, Intelligence, Endurance, Speed), damage types (Slash, Bash, Fire), resistance multipliers across difficulty modes (Easy, Medium, Hard).
     - `items.ctx`: Weapon definitions, damage ratings, durability, value.
     - `models.ctx`: Model binding manifests and attachment sockets.
     - `partsys.ctx`: Particle system emitters, velocities, colors.
     - `messages.ctx`: Localization strings and UI dialogue.

3. **Audio & Soundtracks:**
   - Soundtracks: 730 `.mp3` files in `Music/` (standard MPEG-1 Audio Layer III, 128 kbps).
   - Sound Effects: 302 `.wav` files in `Sound/` (standard Microsoft RIFF WAVE, PCM 16-bit 22.05kHz / 44.1kHz).

4. **3D Models (`Models/*.mdl`) & Meshes (`Meshes/*.msh`):**
   - 267 `.mdl` files (e.g. `drake.mdl`, `skel1.mdl`, `ogre1.mdl`).
   - 25 `.msh` level geometry files (e.g. `Bs1a.msh`).
   - Accompanied by `.ani` keyframe animation tracks (402 files) and `.cap` collision bounding volumes (84 files).

---

## 2. Text Configuration Format Specification (`.ctx`)

Discovered directly from `script/default.ctx`:

```
# Drake attribute values
# (M)ight, (I)ntelligence, (E)ndurance, (S)peed
#       Easy    Medium  Hard
DM      25      20      20
DI      20      15      15
DE      30      25      20
DS      20      15      15

# Drake Base Resists
# 0 - Slash, 1 - Bash, 2 - Fire, etc.
# floating point value (1.0 = normal no bonus/negative effect)
DR0     0.6     0.9     1.2
DR1     0.6     0.9     1.2
DR2     1.0     1.0     1.0
...
```

### Key Gameplay Balancing Constants Revealed:
- **Base Attributes:**
  - Easy: Might 25, Intellect 20, Endurance 30, Speed 20.
  - Medium: Might 20, Intellect 15, Endurance 25, Speed 15.
  - Hard: Might 20, Intellect 15, Endurance 20, Speed 15.
- **Damage Types:**
  - Type 0: Slash (Swords, daggers)
  - Type 1: Bash (Maces, shields, clubs)
  - Type 2: Fire (Spells, enchantments)

---

## 3. 3D Model Format (`.mdl`) Binary Structure

Examination of `Aerin.mdl` (size: 58,160 bytes) and `drake.mdl`:
- Header begins with a 4-byte little-endian header length or version (e.g., `0x1C` = 28 bytes).
- Contains sequential data sections:
  1. Header (bounding box, vertex count, face count, material IDs).
  2. Vertex Array (positions `float32` x, y, z; normal vectors; UV texture coordinates `float32` u, v).
  3. Index / Face Array (`uint16` triangle indices).
  4. Bone hierarchy node offsets for skeletal attachment.

---

## 4. Pipeline Conversion Strategy

Because textures (`.tga`) and audio (`.wav`, `.mp3`) use standard industry formats:
All conversion lives in the TypeScript `converter/` package (ADR-003), runnable as a CLI (`pnpm convert`) or in a browser Web Worker:
1. `converter/src/formats/tga.ts` decodes `.tga` from `Textures/textures.zip` (read with `fflate`); hosts encode to `.webp`.
2. `converter/src/formats/ctx.ts` parses all `.ctx` script files into structured JSON consumed by the authoritative game server (`server/src/data/rules.json`).
3. `converter/src/formats/mdl.ts` + `ani.ts` parse models and animation tracks; `converter/src/emit/gltf.ts` writes skinned, animated `glTF 2.0` (`.glb`) with `@gltf-transform/core`. Python remains available for exploratory format probes only.
4. **All converted assets remain in `local/generated/` and are never committed to version control.**

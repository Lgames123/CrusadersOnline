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

## 3. 3D Model Format (`.mdl`) — Specification `[CONFIRMED]`

Derived from the data files alone (no disassembly), with `tools/re/mdl_probe.py`. The layout below reproduces the exact file size of **265 of 267** models and the header bounding box of a skinned character to within float precision. All values are little-endian.

### 3.1 Nature of the format
The files are **in-memory C++ structures written to disk**. Pointer fields contain stale heap addresses from the exporting tool (e.g. `0x00801910`), and padding contains the MSVC debug-heap fill `0xCDCDCDCD` and a `0xDEAD0000` marker. Loaders must ignore every pointer field and rebuild them from the counts.

### 3.2 Section order
```
header                       0x74 bytes
node records                 nodeCount   x 56
vertex positions             vertexCount x 12   (f32 x, y, z — in the owning node's local space)
faces                        faceCount   x 50
vertex normals               vertexCount x 12   (f32 x, y, z — node-local, unit length)
name table                   nameTableSize bytes (NUL-separated: node names, then dummy names)
collision spheres            sphereCount x 20
line dummies                 lineCount   x 44
transform dummies            xfrmCount   x 32
```

### 3.3 Header (0x74 bytes)
| Offset | Type | Meaning |
|---|---|---|
| 0x00 | u32 | node count |
| 0x08 | u32 | face (triangle) count |
| 0x10 | u32 | stale pointer — ignore |
| 0x14 | u32 | vertex count (sum of the per-node counts) |
| 0x18 | u32 | `0xDEAD0000` marker (0 in a few files) |
| 0x2C | u32 | name table size in bytes |
| 0x30 | u32 | collision sphere count |
| 0x34 | u32 | line dummy count |
| 0x38 | u32 | transform dummy count |
| 0x3C | 16 B | uninitialised (`0xCD` fill) |
| 0x4C | 3 × f32 | bounding box minimum (model space, bind pose) |
| 0x58 | 3 × f32 | bounding box maximum |
| 0x64 | 3 × f32 | bounding sphere centre |
| 0x70 | f32 | bounding sphere radius |
Other fields are zero in every file seen.

### 3.4 Node record (56 bytes)
| Offset | Type | Meaning |
|---|---|---|
| +0 | u16 | flags (values 0, 2, 3, 5, 7, 8 — bit meaning not yet confirmed; not needed to rebuild the hierarchy) |
| +2 | i16 | **subtree size** including the node itself; `-1` = "extends to the end of the parent's subtree" |
| +4 | 4 × f32 | local rotation quaternion **(x, y, z, w)** relative to the parent |
| +20 | 3 × f32 | local translation relative to the parent |
| +32 | u32 | number of vertices owned by this node (consecutive in the vertex array) |
| +36 | 2 × u32 | stale pointers (begin/end of the node's vertices) — ignore |
| +44 | 12 B | padding / `0xCD` fill |

Nodes are stored in **depth-first order**. The hierarchy is rebuilt recursively: inside a parent's range, each child occupies `subtreeSize` entries (or the rest of the range when `-1`), and its own children follow it immediately. Characters use 3ds Max Character Studio bone names (`Bip01`, `Bip01 Pelvis`, `Bip01 L Thigh`, …).

World (bind-pose) transform: `world = parentWorld × local`, i.e. `q_world = q_parent · q_local`, `t_world = t_parent + rotate(q_parent, t_local)`. Applying each node's world transform to its own vertices reproduces the header bounding box exactly. This is **rigid (segmented) skinning**: every vertex belongs to exactly one node, with no blend weights. Static props have a single node with an identity-like transform.

### 3.5 Face record (50 bytes)
| Offset | Type | Meaning |
|---|---|---|
| +0 | u32 | corner count — always 3 |
| +4 | u32 | stale pointer |
| +8 | 2 × u32 | zero |
| +16 | u32 | stale pointer |
| +20 | 3 × u16 | vertex indices (global, into the vertex array) |
| +26 | 6 × f32 | per-corner texture coordinates (u0, v0, u1, v1, u2, v2) |

UVs are per corner, not per vertex, so a converter must split vertices at UV seams. Values are mostly in 0..1 but tile up to about ±60 (repeating textures); a handful of faces carry garbage values (about −1e30) and should be clamped or treated as untextured. Textures are **not** referenced by the model: `script/models.ctx` binds a model file to a texture name (`N <id> <file>.mdl` / `T <texture>`).

### 3.6 Trailing records
- **Collision sphere** (20 B): `u32 node, f32 x, y, z, radius`, centre in the node's local space. Names `DMY SPHERE …`. Characters carry about 28 of them; this is the original hit volume set.
- **Line dummy** (44 B): `u32 node, 4 × f32 quaternion, 3 × f32 point A, 3 × f32 point B`. Names `DMY LINE …` on weapons; it appears to be the weapon's damage segment (blade/head line).
- **Transform dummy** (32 B): `u32 node` plus a local transform (rotation + translation; exact split pending). Names `DMY XFRM WPN LEFT/RIGHT` — the attachment points for held items.

### 3.7 Conversion notes
- **Handedness:** left-handed (Direct3D) — confirmed. The converter mirrors Z (positions, normals, translations; quaternion `(x, y, z, w) → (−x, −y, z, w)`) and reverses winding. Converted characters face **−Z**; with that facing the right hand is on +X.
- **Units:** Drake is 6.58 units tall and the skeleton warrior 6.82, consistent with **feet** (≈2.0 m). Not yet confirmed; the converter keeps the original units.
- **UVs:** the engine's texture origin is **bottom-left** (TGA images are stored bottom-up and uploaded as-is), glTF's is top-left, so the converter emits `v' = 1 − v` while textures are decoded top-down. Evidence: on `drake.mdl` the head faces average v = 0.85, which after the flip lands on the face region at the top of the atlas (torso and legs likewise land on armour and trousers). Only one TGA in the archive has the top-left origin flag (`ui-delete.tga`, a UI icon not used by models). An earlier conversion without the flip put the face texture on the character's back.

### 3.8 Known exceptions
`anim.mdl` and `PA06_rt.mdl` (same size) are 40 bytes shorter than the layout predicts — probably an older revision of the format; not needed for gameplay assets.

## 4. Animation Format (`.ani`) — Specification `[CONFIRMED]`

Derived from the game's own loader and evaluator (Ghidra, see executable-analysis.md §6) and verified against the data: walking the stream with the bone count of the model that uses each animation consumes **exactly** the declared data size for **1,499 of 1,501** model/animation pairs bound in `script/models.ctx` (the two exceptions are skeleton-warrior clips authored for a different rig). Probe: `tools/re/ani_probe.py`.

### 4.1 File layout
```
header            56 bytes   (copied verbatim into the runtime animation object)
keyframe stream   dataSize bytes   (dataSize = u32 at header 0x34)
event track       u32 count, u32 namesSize, f32 time[count], names (NUL-separated, namesSize bytes)
```
Known header fields: `0x04 f32 1/30` (frame duration), `0x34 u32 dataSize`. The engine overwrites most other header fields with playback state after loading.

### 4.2 Keyframe stream
A sequence of 32-bit words processed **bone by bone, in model node order**:
- A **flag word** packs 4-bit flags for consecutive bones (low nibble first, shifted right by 4 per bone). A new flag word is read whenever the remaining flag bits are zero at the start of a bone.
- Nibble bits: `2` = rotation present, `1` = rotation animated (else constant); `8` = translation present, `4` = translation animated (else constant).
- **Constant rotation:** 4 × f32 quaternion stored **(w, x, y, z)** — note the different order from `.mdl`'s (x, y, z, w). Verified by comparing frame 0 of idle clips with the model's bind pose bone by bone (e.g. Neck bind `(0, 0, 0, −1)` ↔ animation `(−1, 0, 0, 0)`); reading them as (x, y, z, w) folds characters in half. Animated rotation channels use the same component order. **Constant translation:** 3 × f32.
- **Animated channel:** `u32 n` (segments), `f32 times[n + 1]` (break times in frames), then `n` segments of coefficients. Each component is a cubic in **absolute frame time**: `v(t) = ((a·t + b)·t + c)·t + d`. Coefficients are stored per segment as `[a0..ak, b0..bk, c0..ck, d0..dk]` (k = 4 components for rotation, 16 floats per segment; 3 for translation, 12 floats). Time is clamped to `[times[0], times[n]]`; the segment is the first whose end time is ≥ t.
- Results are written straight into the 56-byte node records of the model (quaternion at +4, translation at +20 — the same layout as `.mdl` §3.4). Quaternions are not renormalised by the evaluator.

### 4.3 Root bone and root motion
- For bone 0 the evaluator holds **X and Z at their frame-0 value** (animations play in place); only Y is animated. Two engine states override Y with a constant 3.85 (flag mask `0x180`) or add 1.5 to Z (mask `0xC00`).
- Separate routines compute the root's **horizontal displacement and direction** and its **vertical displacement** between two times from the same translation track: the game moves characters by the animation's root motion.

### 4.4 Event track
`count` events with times and names. Times greater than 500 are 3ds Max ticks and are converted to frames as `ticks / 4800 × 30` (engine behaviour); smaller values are already frames.

### 4.5 Conversion
The converter samples each channel once per original frame (30 fps) into LINEAR glTF channels, applies the same Z-mirror as the models, holds the root X/Z like the engine and stores `rootMotion`, `frames`, the designer label from `models.ctx` (e.g. "run forward") and the events in each animation's `extras`. Converted characters face **−Z**, matching the client's yaw convention; left/right is confirmed (right hand on +X when facing −Z).

## 5. Pipeline Conversion Strategy

Because textures (`.tga`) and audio (`.wav`, `.mp3`) use standard industry formats:
All conversion lives in the TypeScript `converter/` package (ADR-003), runnable as a CLI (`pnpm convert`) or in a browser Web Worker:
1. `converter/src/formats/tga.ts` decodes `.tga` from `Textures/textures.zip` (read with `fflate`); hosts encode to `.webp`.
2. `converter/src/formats/ctx.ts` parses all `.ctx` script files into structured JSON consumed by the authoritative game server (`server/src/data/rules.json`).
3. `converter/src/formats/mdl.ts` + `ani.ts` parse models and animation tracks; `converter/src/emit/gltf.ts` writes skinned, animated `glTF 2.0` (`.glb`) with `@gltf-transform/core`. Python remains available for exploratory format probes only.
4. **All converted assets remain in `local/generated/` and are never committed to version control.**

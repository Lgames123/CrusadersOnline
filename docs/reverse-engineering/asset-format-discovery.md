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

**Animation states.** Besides `L <file>.ani` lines (the clips a model can play), `models.ctx` binds the engine's animation states to clips with `B <ASM_STATE> <file>.ani` lines (e.g. `B ASM_RETREAT PA06_rt.ani`, `B ASM_SIDE_STEP_L PB01_w_sideleft.ani`); a `B` line without a file leaves that state unbound. Drake binds 100 states (standing, walking, running, retreat, turns, side steps, standing/running/directional jumps, hops, landings, falls, rolls, climbing and mounting, combat stance/turns/steps, block, attacks, directional and severe impacts, nine death variants, spells, gestures). The converter keeps the map (state → lower-case clip name) in the model root's `extras.asmStates`; the client picks locomotion clips from it.

## 6. Level Files (`Meshes/*.msh`, `Caps/*.cap`) — Compression and Creature Records `[CONFIRMED]`

### 6.1 Compression
Both level file types are compressed with the **PKWARE Data Compression Library "implode"** method. The level loader allocates exactly the 12,596-byte work buffer the library's `explode` routine needs. `tools/re/pkware_dcl.py` is an independent decoder written from the published format description (the same format zlib's `contrib/blast` handles).
- **`.cap`:** 0x94-byte header (uint32 uncompressed size, magic `0xD00D0012`, level name such as `Ca_a` at 0x34, 0xCD fill), then **one** DCL stream holding all the level's object records.
- **`.msh`:** header starting `0A 00 ED FE` (uint32 sizes at 0x04 and 0x08; 0x08 equals the first stream's output size), then several sections. In `Bs1a.msh`: a DCL stream at 0x116 (1,029,016 bytes, geometry), an uncompressed block, then two more DCL streams (431,947 and 2,159,270 bytes; the last holds texture and material names). The geometry layout itself is not decoded yet.

### 6.2 `.cap` object records
`.cap` files are the level **object placements** (creatures, NPCs, containers, items, sprites, scripted sequences), not collision data.

Each creature record starts with the marker `2D 00 00 00 CD CD CD CD`. At +0x1C it holds the creature type id (113–162, see executable-analysis.md §9.1); at +0x40 the instance name (e.g. `SkeletonWarrior18`). The record also contains the creature's items by name (e.g. `Long Sword`). Fields are best located relative to the **XP block** `02 00 00 00 | xp:int32 | 0 0 0 | disposition:int32 ×2`:

| Field | Position | Notes |
|---|---|---|
| XP value | XP block + 4 | experience granted to the killer; **−10** for citizens, guards and named NPCs (killing them costs XP) |
| Disposition | XP block + 20, + 24 | 0 named NPC, 1 citizen, 2 guard, 3 hostile, 4 possessed by the Deceiver |
| Max HP | XP block − 0x1B8 (float32) | followed by a constant 200.0 |
| Resists | XP block − 0x118 (11 × float32) | damage-taken multipliers, SLASH … DARK |

`tools/re/cap_creatures.py` extracts these values from a local installation. Most common values per type (facts):

| Creature | Placements | HP | XP | Notable resists |
|---|---|---|---|---|
| Skeleton Warrior | 480 (357 typical) | 25 | 40 | slash 0.9, bash 1.1, light 1.5, dark 0.75 |
| Skeleton Ghost | 136 | 40 | 75 | bash 0.75, spirit 1.5, dark 0.5 |
| Shadow | 98 | 60 | 200 | slash 0.5, bash 0.25, light 1.5 |
| Dasher Brute / Scout | 309 / 86 | 30 / 20 | 50 / 40 | slash 0.8, bash 1.2 |
| Dark Mage / Dark Master | 63 / 19 | 45 / 80 | 60 / 125 | light 1.25–1.35, dark 0.25–0.5 |
| Dwarf Ironpick Rebel / Zealot | 48 / 23 | 40 / 60 | 60 / 100 | bash 0.8 / 0.5 |
| Ogre Outlaw | 50 | 100 | 75 | — |
| Ice Titan / Rock / Ice / Lava Elemental | 34 / 31 / 37 / 7 | 125 / 150 / 175 / 200 | 150 / 125 / 200 / 250 | elemental immunities (0.0) |
| Necros (final boss) | 1 | 1000 | 10 | 0.13–0.8 on every type |

Individual placements override these values; level designers made stronger variants. For example, 18 Skeleton Warriors have 80 HP and give 60 XP.

The creature's position (3 × float32, original units) is at XP block − 0x200. The `.cap` header names the level mesh it belongs to (`Ca1a.cap` → `Ca_a`). The 84 `.cap` files are the acts or variants of the 25 meshes.

### 6.2.1 Generic object records (all classes) `[CONFIRMED: 12,025 objects in 84 files]`

Every placed object starts with `[class u32][CD CD CD CD][3F 00 00 00][02 00 00 00]`. The instance name is at +0x40. Six **component pointers** at +0x28…+0x3C hold absolute addresses in the cap image (base `0x08000000`); each component starts with a type tag:

| Slot | Component | Fields |
|---|---|---|
| 0 | transform | +4: 3 × 3 rotation (row-major; Direct3D row-vector convention), +0x28: position |
| 4 | class component | props: HP at +8 (current) and +0xC (max), 0 = indestructible; ground items: quantity at +0x18, item name at +0x2C |
| 5 | render | +0x18: `models.ctx` model id (e.g. 9 = barrel01.mdl) |

Classes:

| Class | Count | Content |
|---|---|---|
| 0x2D | 1,980 | creatures |
| 0x34 | 10,734 | props: mushrooms, plants, rocks, barrels, crates, bottles, light volumes, furniture… Breakables carry HP, e.g. bottle 5, barrel 8–25, chair 15–25, armour suit 150, statue 400 |
| 0x35 | 266 | ground items: potions, gold (quantity), weapons, shields |
| 0x36 | 986 | sprites: the effect name is the first upper-case string in the record, e.g. `TORCHFIRE` |
| 0x38 | 25 | chests; contained items appear as item sub-records (quantity at name − 0x14) |
| 0x3A | 14 | flags in the wind |

The model id resolves for all 12,025 objects, and object names match their models (`LargeCrate` → `crate1.mdl`, `Chair` → `plnchr.mdl`, `Mushroom` → `mushrm1/2.mdl`).

**Audio.** `script/data.czx` is a ZIP archive containing `Sound.ctx`, the sound registry (1,143 entries). Its indices are the executable's sound ids: 417 = UILevel.wav (played by Stats_LevelUp) and 306 = SwStab02 (the default impact).

The creature sound table at 0x004EEA88 has 16 bytes per creature type (type − 113): impact material (0 = bone, 1 = flesh), a second value, the damage cry and the death cry. For example, Skeleton Warrior = bone, SW1_GEN_03, SW1_GEN_04. The impact table at 0x004EEDA8 picks BlntBone01 / ShrpBone01 / BlntFlesh01 / SwStab… by material and weapon edge.

`Textures/textures.zip/textures.nfo` maps texture material symbols (ST, WD, ML, …) to ricochet and footstep sounds.

### 6.2.2 Level exits (portals) `[CONFIRMED: 192 portals, all destinations exist]`

Portal records live outside the object list:

| Offset | Content |
|---|---|
| +0 | pointer to the record's own destination string at +0x20 |
| +4 | `0xFFFF0000` OR exit number |
| +0x10 | trigger position (3 × float32) |
| +0x20 | NUL-terminated destination act, e.g. `Ca1a` → `Ca1b`, `Ca1c` → `Du1a`, `Cs1b-Inn` → `Cs1b` |

Before the record: at −0x30 a pointer to its **trigger volume** and at −0x2C a flag word: 1 = walked into (151 exits), 8 = a door exit taken with the use key (42: cell doors, inn doors, town and catacomb gates), 16 = 8 Ci/Cs exits (meaning unknown, walked into). The trigger volume: two horizontal planes `[normal][d]` at +0x00 / +0x10 bounding its height, a pointer to its edge list at +0x20 and the edge count at +0x35; each edge is `[x1 z1 x2 z2][outward normal x z][length]` (0x1C bytes). They are boxes over whole corridor ends or doorways (Du1b → Es1a: 240 × 24 ft, y 944–1216 ft); the +0x10 position is only a point near one corner, often in empty space (162 of 192 exits link a volume).

Exits come in pairs: the destination has a portal back to the source, which is where an arriving player appears. The four acts of a mesh (e.g. Ca1a/Ca2a/Ca3a) link to the matching act of their neighbours.

**Crossing and arrival** (decompiled 2026-10-16). A character touches a volume when its feet are at most the top plane (+0x00) and at least the bottom plane (+0x10) minus its height (+0x68 of the actor, 3 ft when flagged or too small), and its circle (radius +0x70) is within every edge (0x4394F0); placed creatures stand exactly on the floor, so the position is the feet. The exit trigger's touch (0x462890, vtable 0x4E1AC4 slot 5) records the exit number (+0x38, the portal record's +4) and, unless its flags (+0x0E) have bit 2, the player's position minus the trigger's point (+0x44 = the portal record's +0x10); with bit 2 it asks the load for start point `exit` instead (0x44EE60 → 0x58D0CE). The level load (0x476F20, param 2 = 2) then: with a start index, puts Drake on that start point with its angles; otherwise the type-0x13 fixup adds the offset to the point of the trigger whose entry number (+0x0F) equals the exit number (bit 4 of its flags: that point exactly), and **the heading is left as it was**. Paired acts are built so this continues the walk: Ci*a and Ci*b share the tower spiral, offset by (0, −36, +16) ft (unmirrored), and the two strips sit on different sides of it, so going down crosses once into Ci*b and going up once into Ci*a. Exits without a volume (30: Ci*b → next act, Ci3b ↔ Ci4b, Co1a ↔ Co8a, Du1c ↔ Du8c, the Cs ↔ Ci gates of acts 1–3, ...) are never walked into: scripts load them (ScriptedSequenceDone).

Implemented: exits trigger on their volume with that body test; exits without a volume whose destination is on the same mesh are script-only (`scripted`); door exits wait for Tab. The arrival is the original's (`exitArrival`); when the entry point has no floor within 1.5 m (the Cs1a ↔ Ci1a gate kept walkable, not original) the player is placed on the nearest floor outside the back exit's volume. The Cs ↔ Ci gates of acts 1–3 are walkable with the volumes the same gates have in Cs4a and Ci9a (not original).

### 6.2.3 Brushes (doors, gates, bridges, wheels) `[CONFIRMED: 191 brushes]`

Moving level pieces are class `0x31` records, not part of the `.msh`: `[31 00 00 00][...][3F 00 00 00][02 00 00 00]`, name pointer at +0x14 (names start with `b`: `bDoorE_2`, `bfinaldoor`, `bOuterGates`, `bLongWheel1`, `bBridgePiece4`, `bLever1_1`...). After the name: a tag dword, a 3 × 3 rotation (identity in every sample), the pivot position, 12 zero bytes, `CDCDCDCD` and five pointers; then `[vertex count u32][face count u32][pointer][0]` and the vertices (3 × float32, world units). The first vertex is the pivot (the hinge), the rest the piece's corners (8 for a slab door); faces follow (the pointer after the counts): 0x68 bytes each like the level mesh's — plane, texture origin P (+0x10), axes U / V (+0x1C / +0x28), and the face as one render polygon at +0x3C (index list pointer +0x40, u16 into the brush vertices including the pivot; material +0x48, its texture name pointer at material +8; vertex count +0x56). Brush texture coordinates read at 8 texels per unit (a door picture spans 15 units on an 8 ft and a 14 ft door alike), not the level faces' 32. A door slab is e.g. 8 × 14 × 1 ft.

**Movers** `[CONFIRMED: live capture + decompilation]`. The runtime object starts 0x18 before the class-0x31 record (the vtable is patched in at load); +0x48 / +0x4C / +0x50 point to its components, and +0x4C is a keyframe mover (a 0x230-byte record in the act, vtable 0x4E372C, update 0x48EFC0, advance 0x48F170, end of segment 0x48FFC0 / 0x4900C0, collision 0x48E370): flags at +0x100 (low 3 bits the end-of-path mode; with mode 0, bit 8 = swing back after the delay; 0x2000 eased speed, 0x1000000 / 0x2000000 one-sided ramps; 0x200 reverse on hitting the player, 0x80 stop on hitting), key count +0x105, current key +0x106, state +0x108 (1 shut, 2 forwards, 6 backwards / waiting, 5 parked, 9 done), progress +0x10C (0..1), delay counter +0x11C and delay +0x11E (ms), and three arrays right after the record: segment types (+0x120, a byte per key; 0x10 = turn about the vertical axis, 0x08 / 0x20 / low bits other movements), keys (+0x124, three floats per key: for a turn, degrees and the centre x, z) and speeds (+0x128, 2 × count floats: progress per ms at the ends of a segment and, eased, at its middle). The current transform is the 4 × 4 at +0x130 (inverse at +0x170). Doors (`bDoorE`, `bDoor`: 67 turning movers of 191 brushes; 61 swing back after 4000 ms, the rest stay open) mostly have two turn keys, +90° and −90° about the hinge: the use key opens the door **away from the player** (logged: Drake on either side of Cs1a `bDoorE_1` → key 0 / key 1), at 1/9000 → 1/450 per ms (1.42 s), stays open 4000 ms and swings back; a closing door that meets Drake pushes him, or stops if it cannot (flags 0x80 / 0x200 change that). **Door sounds** are separate level objects: sound actions (runtime vtable 0x4E1D58; Sound.ctx id at +0x34, a pointer to a list of x y z positions at +0x40, volume at +0x44) whose position is the door's turn centre. Every use-key press on the door fires them (0x461430 → 0x461500 → `0x4B13C0(id, x, y, z, loop, volume)` → Miles `AIL_start_sample`), also while it is open; closing is silent. Logged on Cs1a `bDoorE_1`: 516 (DoorOpen06) at (2143.4, 961, 607.8). Across the acts: 514 on 25 doors, 518 on 12, 516 on 8, 520 on 4, and one door that also plays a guard's line (721, "Celestia is expecting you."). **Segment types** (decompiled 2026-10-14; dispatch `0x490210`, a byte per key): low 3 bits = a move by the key (dx, dy, dz) × progress (`0x48F350`); `0x08` = a turn about X through (y, z) (`0x48F630`); `0x10` = about Y through (x, z) (`0x48F960`, doors); `0x20` = about Z through (x, y) (`0x48FC90`); for turns the key is (degrees, centre). Matrices are column-vector (translation in the last column), so a 0x20 turn of θ is three.js `rotation.z = θ`. Under the converter's Z mirror the turns about X and Y and every z change sign; turns about Z keep theirs (Ws9a `bLever1_1`: type 0xA0, key (40°, x 2163.97, y 1040.02), its foot on the wall, tipping +40°). Gates, cell doors, platforms, crushers and wheels use these too.

**Mover state machine** (decompiled 2026-10-14). States (+0x108): 1 shut, 2 forwards, 5 parked at the end, 6 backwards (or waiting to), 9 done. The use (`0x48EC10`): shut → forwards from key 0; parked → backwards from the last key; anything else does nothing. Each frame (`0x48EFC0`) a mover moving or waiting either counts its delay (+0x11C, ms) down or advances its progress by the eased rate × ms (`0x48F170`); a finished segment (`0x48FFC0`) steps the key, and the end of the path depends on the mode (flags & 7, `0x4900C0` going forwards): 0 parks (with flag 8: waits the delay +0x11E, then comes back); 1 and 3 come straight back; 2 parks; 4 snaps back to the start, shut; 5 snaps back and goes again (loops); 6 is done; 7 snaps back, done. Back at the start: mode 0 shuts, 1 goes forwards again (ping-pong), 2 and 3 are done. Turn segments are absolute about their centre; moves add up (`0x490210` rebuilds the base from the earlier moves). As read from the acts: `bOuterGates` / `bCellDoor` rise (move 0x43 / 0x46) and come back after 2–7 s (mode 0 + flag 8), Ws9a's cell door and lever go once (mode 6), Ws1a's lever comes back after 5 s; wheels and gears loop (mode 5); platforms and crushers go once (mode 6). CrusadersOnline runs this machine for the world objects (gates, cell doors, levers; `shared/src/arena/mover.ts`), server and clients alike; relays set gates and cell doors moving (table below, type 0x2B); what starts the platforms, crushers, wheels and chandeliers is not decoded (no relay points at them), so they stay at rest.

Implemented: the converter writes `brushes` (name, vertices, faces and the mover) in each act's placements; brushes named *door* / *gate* become doors (world objects, convex-hull colliders) that open with the interact key (Tab). Doors with turning movers swing like the original (away from the player, eased, back after their delay; a closing door waits for a character in its way instead of pushing him); the others still slide up (simplified); doors, gates, bridges and platforms are solid, the rest are drawn only, with their original textures (no lightmap: dimmed). Locked doors (a guess, keys placed in the acts): train `bfinaldoor` — Fain's Key, Cs1b-Inn `bDoorE_4` / `bDoorE_5` — Room 2 / Room 3 Key; they open with the use key (Z) while the key is carried (keys are not used up: `Permanent`). Levers (`bLever1_1`) are pulled with Tab; in Ws1a/5a/9a the lever opens `bOuterGates`, which no longer opens by hand (the Ca*a lever beside the five nested `bPlat` rings, probably a lift, does nothing yet).

### 6.5 The story layer: triggers, scripted sequences, cameras `[CONFIRMED: 29 sequences in 26 acts]`

The cap DB ends with a **per-type object table**: 225 types (`NUM_CAP_OBJ_TYPES`), each a count and that many pointers; the loader (0x478xxx) patches each object's vtable by type. Header +0 is the image size and +4 the table's size, so the table starts at `size - tableBytes`. Types used by the story:

| Type | Object | Fields |
|---|---|---|
| 0x06 | start points | header +0x20 records of 7 dwords: x, y, z, pitch, heading, roll (degrees), 1. A new game puts Drake at the first (0x476F20: angles to +0x1CC / +0x1C8 / +0x1D0; heading D3D, facing (sin, cos) in x, z); a loadlevel with a start index uses that one |
| 0x13 | exit trigger | +4 volume, +8 activation (bit 0 walked into, bit 3 use key), +0x0E flags (2 = arrive at the destination's start point `exit`, 4 = arrive exactly at the entry point), +0x0F entry number, +0x34 the portal record (§6.2.2), +0x44 its point (the record's +0x10): arrivals land at the entry's point plus the crossing offset (§6.2.2). Fired by a relay (slot 5, 0x462890) it changes level as if crossed (destination `end`: the ending, state 5): Du2a 401805 → du9a #111 on OgreOutlaw7's death, train 165226 → Ws9a 1 s after the final crossing, Gl3c 72827 → gl4c |
| 0x14 | flag trigger | +4 volume, +8 activation; entering sets its flag (0x462A70), a TriggerFlag step sets it too (0x462B00) |
| 0x1A | message trigger (signs, tutorial hints) | +4 volume, +8 activation (bit 0 walked into: fires on every touch check while inside; bit 3 use key; 0x200 once, setting +0x0C bit 1; 0x100 lets a re-arm (0x464160) clear that bit), +0x34 `script/messages.ctx` index. Vtable 0x4E19D4; fire 0x4632B0 shows the table entry (0x589AB0, 64 slots, loaded by 0x464FC0, entry 0 = the file's header line) on the HUD for 2000 ms (0x4693F0). Signs: Cs*b "Ye Olde Catacombs", Du* road signs, Gl*a, Ca*c; volume-less ones are fired by relays: Du2a #18 by OgreOutlaw7's death (relay 401805), Cs4b #25 by a walk-in relay 7 s after the crossing |
| 0x1D | quest trigger | +4 volume, +8 activation, +0x0E action mask (0x80 main story), +0x34 quest index, +0x36 player bit; fired by 0x4641F0 |
| 0x2B | relay trigger | vtable 0x4E1E84 (0x4E1EC0 with fire 0x462B90 and its +0x36 / +0x38 target list is another type). Touched (slot 2 0x463A90 walk-in, slot 4 0x463C70 from a script) it arms a timer of u16 +0x38 ms (deadline at +0x34; 0 fires at once); its fire (slot 5, 0x463CC0) runs +0x3C ops of 16 bytes at +0x40: op byte +0, +4 pointer to a second argument [type byte, value +4], arg type +8, value +0x0C; then +0x0C \|= 4 (and \|= 2, disabled, with activation 0x200). **Arg type 0x14 (any trigger-like object):** op 8 fires its slot 5 directly, no touch test (a message shows its text; a quest updates; an exit changes level, 0x462890; a mover trigger 0x1E moves its brush; a sound trigger 0x0B plays); ops 0 / 1 set / clear its +0x0D bit 0 — read only by the slot-9 getter 0x460240 and save / load, no reader found (Co2a/3a/4a/8a/9a and Ws2a–4a set it on the cell door's mover and sound triggers when walked in; they do **not** open the door); ops 2 / 3 call its slots 6 / 7 (default 0x460210 / 0x460220: set / clear +0x0D bit 1; unused in the shipped acts). **Arg type 1 (a creature object, record − 0x18; op 8 becomes 0x0A):** 0x410290 skips dead or brainless creatures and queues a brain event (0x4102D0): 0x0A event 0x18 (a hostile creature takes the player as its target at once, 0x40D910), 0x0B event 0x17 + a second creature (a hostile one picks that creature), 0x0C event 0x19 + a second creature (an idle one attacks it now, state 3, 0x40C370); 0x0D sets brain +0x14 bit 0x400 (target the nearest opposing creature or player in clear sight, any range, 0x40DC90); 0x0E 0x405520(0, 1, 0) then disposition +0x1D8 = 4 (0x40CCD0, meaning not decoded). Ws5a's lever (use-key relay 354011) opens `bOuterGates`, plays its sound, pairs the 8 guards and 4 skeletons against each other (0x0C) and has them fight anyone (0x0D); relay 353547 (0x0E on all 12) is referenced by nothing. Use key: 0x460320 accepts activation bit 3 for the player only while the use key is down (player vtable +0x90); only Ws1a / 5a / 9a's lever relays have it |
| 0x0B | sound trigger | vtable 0x4E1D58; fire 0x461490: Sound.ctx id +0x34 at each of u16 +0x3E points (list at +0x40, 12 bytes each), volume +0x44 (0x4B13C0); +0x0E bit 1 repeats every u16 +0x38 ms, bit 2 plays by chance (+0x3A); slots 6 / 7 stop (0x4B18B0) or move its sample. The door and gate sounds of the relays |
| 0x1E | mover trigger | vtable 0x4E1CE0; fire 0x461B10: the brush whose runtime object is at +0x38 (record = object + 0x18, name pointer at record + 0x14) gets its mover's use (mover +0x20 with 1, +0x34); activation 0x2000 also sets the toucher's +0x4C+0x60 bit 0x400. The source of the relays' `brushes` (the old guess, the dword before the relay's record, was wrong for Co*a / Ws2–4a and missed Bs1a's `bnecrosdoor`) |
| 0x5E | creature health | inside the creature's record (about record + 0xB4): +4 the creature object (record − 0x18), +8 hit points. Damage 0x44CA00: at 0 HP the creature dies (vtable +0x90) and, if +0x1F4 has 0x8000000, the trigger at +0x1F0 fires (slot 5, the player as activator). Only Du2a OgreOutlaw7 → relay 401805 (two quest triggers, message #18, an op on exit `du9a`) |
| 0x28 | camera | +0x34 eye path (type 0x55), +0x38 look-at path (type 0x53) |
| 0x40 | action definition | +4 [resource flags, 2, id, argument count], +8 name (MoveToPos, FaceRel, PlaySound, Wait, RunAnimation, DoInteraction, Timeline, ScriptedSequenceDone, FadeOut, TriggerFlag, Appear, CameraTimeline), +0x3C argument names (0x33 bytes each) |
| 0x4D | sequence binding | +0x10/+0x14 typed reference (type 0x14) to the flag trigger that starts it, +0x18 its camera, +0x20 the sequence definition, +0x28 actor count, +0x2C actor table ([1, 1] = the stand-in for Drake, [1, creature object] = a placed creature; creature objects start 0x18 before their class-0x2D record) |

**Sequence definition:** +2 track count, +3 actor count, +4 actor bit mask, +8 state count (1 in every act), +0x0C the actor of each track (bytes; tracks 0-2 are the timeline, camera/fade and sound tracks), +0x10 the states (0x8C bytes: +4 steps per track, +8 per-track step lists, +0x24 step count, +0x28 steps, +0x2C argument count, +0x30 typed arguments), +0x14 its name.

**Step** (0x30 bytes): +0 start condition [event, track, index, timeline key]: FF FF FF = at once; event 0 = when step `index` of `track` starts (a Timeline: when it reaches the key, keys 500 ms apart), 4 = when it finishes; +8 the action definition; +0x19 argument count; +0x1A argument slots (FF = default); +0x28 / +0x2C a Timeline's key count and keys (12 bytes each, time in ms at +4). **Typed arguments** (8 bytes): 0x0A int, 0x0B float, 0x1E pointer to a point, otherwise a reference (0 = the player, 1 = the stand-in, else a creature, trigger, camera, exit object or binding). PlaySound `sound` is a Sound.ctx id (the voice line; Wait steps carry the line's length), RunAnimation `animation` an ASM state id, MoveToPos `movestate` ASM_RUNNING / ASM_WALKING, ScriptedSequenceDone `loadlevel` an exit object (the next act: Ci1b's briefing loads Ci2b).

**Camera path** (types 0x53 / 0x55): +4 control points, +8 progress per ms, +0x10 point count, +0x11 segment count, +0x13 flags; evaluated by 0x42DA10 as cubic Bezier pieces (piece i: mid(P2i, P2i+1), P2i+1, P2i+2, mid(P2i+2, P2i+3); the first starts at P0, the last ends at the last point), progress stopping at 0.9999. Type 0x55 adds timed events (+0x44 / +0x48 / +0x4C) and a piecewise-linear curve (+0x50 / +0x54 / +0x58, read by 0x42DFA0), not used yet.

Implemented: converter `formats/cap_story.ts` (`story` in each act's placements, Z mirrored); `rules/strings.json` from crusaders.exe's string table (`formats/pe_strings.ts`), where the quest book's text lives (ids 3000-3252).

### 6.3 `.msh` layout and geometry `[CONFIRMED on 25 of 25 levels]`

**Memory images.** Both `.msh` and `.cap` files are memory images ("game DBs"). The loader decompresses them into game memory at fixed addresses, so internal pointers are absolute: the mesh DBs live at `0x06000000` and the cap DB at `0x08000000`. Each DB ends with a **per-type object table**: for every object type, a count followed by that many pointers. It is the "recyclable overhead" in the loader's messages.

**File layout:**

| Part | Content |
|---|---|
| Header (0x112 bytes) | magic `0xFEED000A`, offset of the SpaceMap header, lightmap byte size, lightmap count, flags (0; `Ws_a.msh` has 2: an 8216-byte table follows the header, before the lightmaps — skipped, see UNK-010) |
| `[u32 size][DCL]` | lightmap texels: 16-bit RGB555, tiles up to 16 × 16 |
| Lightmap directory | 12 bytes per tile: `[?, ?, width, height][u32 byte offset][pad]` |
| SpaceMap DB | 0x20-byte header (size, table bytes, version `0xA1A10001`, 11 types, …), then `[u32 size][DCL]`: 2D cell graph (cells with edges and neighbour links, for navigation and visibility) |
| Mesh DB | 0x28-byte header (size, table bytes, version `0xBABE0002`, **8 types**, …), then `[u32 size][DCL]`. In game memory it follows the SpaceMap DB directly. |

**Mesh object types:** type 0 = cells, type 1 = materials (texture name pointer at +8).

**Cell** (convex vertical prism; many cells have no geometry):

| Offset | Field |
|---|---|
| +0x3C | vertex pool, float32 xyz |
| +0x40 | u16 vertex count |
| +0x42 | u16 face count |
| +0x44 | faces, 0x68 bytes each |

**Face:**

| Offset | Field |
|---|---|
| +0x00 | plane normal, then d (n·v + d = 0) |
| +0x10 | texture origin P |
| +0x1C | texture axis U |
| +0x28 | texture axis V |
| +0x34 | axis lengths |
| +0x3C | the whole face as one render polygon |
| +0x5C | fragment pointer |
| +0x60 | u8 fragment count |

Texture coordinates are u = U·(X − P), v = V·(X − P) in texture units: **one picture every 15 units**, as on the brushes. Across all 25 levels 23–53 % of face texture coordinates fall on multiples of 15 (chance would be ~0.3 %), against ~5 % on multiples of 4; pieces made to fit a face (Ws_a's cobwebs, the cells' four-square grates `Cor_ML_001x4`, the path pieces `Cor_ER_049_*`) span exactly 0–15 or 15–30. Every level texture is 128 px. **v = 0 is the picture's bottom row**: the TGAs are stored bottom-up (2043 of 2044) and the engine samples the rows as stored; only so do Ws_a's path pieces join up (the T opens towards its corridor, the bend turns into its own), and walls stand upright. (Corrected 2026-10-14: an earlier reading, tuned by eye on a brick floor, took 32 texels a unit, which drew every level texture about 3.75 times too small.)

**Fragment** (0x20 bytes; the engine's render polygon, queued through `+0x10` and flag byte `+0x1B` by the DrawPolys queue at 0x004994B0):

| Offset | Field |
|---|---|
| +0x04 | u16 indices into the cell's vertex pool |
| +0x08 | lightmap UVs, 16 bytes a vertex: float32 u, v (0..1 inside the tile, half a texel in from its edges) and 8 bytes of 0xCD padding — read at 8 bytes a vertex, every other vertex got the padding (−4.3e8) and the lighting came out as hard bright triangles on a dark level |
| +0x0C | material pointer |
| +0x18 | u16 lightmap index |
| +0x1A | u8 vertex count |

**Totals for Bs1a:** 88 geometry cells, 6,040 faces, 9,002 fragments, 8,929 distinct lightmaps (the directory has 8,928). All fragments lie on their face plane.

**Units.** Floor-to-ceiling heights are 14–16 units, and characters are 6.8 units tall: level units are feet, like the models.

**Converter output.** `converter/src/formats/{dcl,msh,cap}.ts` and `converter/src/emit/gltf_level.ts` write:
- `levels/<mesh>.glb`: one primitive per material; TEXCOORD_0 is the texture and TEXCOORD_1 the lightmap atlas;
- `levels/<mesh>_lightmap.webp`;
- `levels/<mesh>.collision.bin` ("COL1": float32 xyz + u32 triangles; sky materials excluded);
- `levels/<act>.placements.json`.

The sky box is a small cube modelled away from the map using the `wld_sy_sky*` materials; the client draws it around the camera.

---

## 5. Pipeline Conversion Strategy

Because textures (`.tga`) and audio (`.wav`, `.mp3`) use standard industry formats:
All conversion lives in the TypeScript `converter/` package (ADR-003), runnable as a CLI (`pnpm convert`) or in a browser Web Worker:
1. `converter/src/formats/tga.ts` decodes `.tga` from `Textures/textures.zip` (read with `fflate`); hosts encode to `.webp`.
2. `converter/src/formats/ctx.ts` parses all `.ctx` script files into structured JSON consumed by the authoritative game server (`server/src/data/rules.json`).
3. `converter/src/formats/mdl.ts` + `ani.ts` parse models and animation tracks; `converter/src/emit/gltf.ts` writes skinned, animated `glTF 2.0` (`.glb`) with `@gltf-transform/core`. Python remains available for exploratory format probes only.
4. **All converted assets remain in `local/generated/` and are never committed to version control.**

# Executable Analysis: crusaders.exe

## 1. Overview & Forensic Facts

- **Target Binary:** `Crusaders of Might and Magic/crusaders.exe`
- **File Size:** 1,085,440 bytes (1.03 MB)
- **Format:** Portable Executable 32-bit (PE32)
- **Target Architecture:** Intel 80386+ (x86 32-bit)
- **Linker:** Microsoft Visual C++ 6.0 (Linker Version 6.0)
- **Subsystem:** Windows GUI (Subsystem ID 2)
- **Entry Point:** `0x000D0B9E` (RVA `0x000D0B9E` + Image Base `0x00400000` = `0x004D0B9E`)
- **Image Base:** `0x00400000`
- **Verification Confidence:** `[CONFIRMED]`

---

## 2. PE Section Headers

| Section | Virtual Address | Virtual Size | Raw Data Offset | Raw Data Size | Characteristics / Flags |
|---|---|---|---|---|---|
| **`.text`** | `0x00001000` | 904,229 bytes | `0x00001000` | 905,216 bytes | Executable Code, Read (`0x60000020`) |
| **`.rdata`** | `0x000DE000` | 48,765 bytes | `0x000DE000` | 49,152 bytes | Initialized Read-Only Data (`0x40000040`) |
| **`.data`** | `0x000EA000` | 1,379,480 bytes | `0x000EA000` | 61,440 bytes | Read/Write Initialized/BSS (`0xC0000040`) |
| **`.rsrc`** | `0x0023B000` | 65,536 bytes | `0x000F9000` | 65,536 bytes | Win32 Resource Data (Icons, Menus) |

---

## 3. Dynamic Link Library (DLL) Dependencies

Inspection of the Import Directory Table (`RVA 0x00249000`) reveals the runtime dependencies:

```
crusaders.exe
├── KERNEL32.dll     # Process management, file I/O (CreateFileA, ReadFile), heap memory
├── USER32.dll       # Win32 window message pump (PeekMessageA, DispatchMessageA)
├── GDI32.dll        # DC creation, bitmap blitting for launch screens
├── DINPUT.dll       # DirectInput 7.0 COM interfaces (keyboard, mouse look, gamepad)
├── WINMM.dll        # timeGetTime / timeBeginPeriod (High precision tick scheduling)
├── audio.dll        # 3DO audio engine wrapper (communicates with Miles mss32.dll)
├── COMCTL32.dll     # Common controls for dialog boxes
├── ole32.dll        # COM initialization (CoInitialize)
└── VERSION.dll      # Product version string queries
```

### 3.1 Graphics HAL Dynamic Loading
Notably, neither `d3d.dll` nor `opengl32.dll` appears in the static import table.
Instead, string analysis and configuration examination (`gfxdll.cfg`) show:
1. `crusaders.exe` opens and reads `gfxdll.cfg` at startup.
2. It parses the target driver string (`gfx_d3d.dll` or `gfx_sw.dll`).
3. It calls `LoadLibraryA("gfx_d3d.dll")` and queries function pointers via `GetProcAddress`.
4. This confirms a classic 1999 3DO **Hardware Abstraction Layer (HAL)** design, separating core game logic and physics from the rendering API.

---

## 4. Main Game Loop Architecture

Based on imports from `WINMM.dll` (`timeGetTime`) and `USER32.dll` (`PeekMessageA`), the native loop follows a standard late-90s continuous polling structure:

```cpp
// Architectural reconstruction of the native game loop
timeBeginPeriod(1);
DWORD lastTick = timeGetTime();

while (!bQuit) {
    MSG msg;
    while (PeekMessageA(&msg, NULL, 0, 0, PM_REMOVE)) {
        if (msg.message == WM_QUIT) { bQuit = TRUE; break; }
        TranslateMessage(&msg);
        DispatchMessageA(&msg);
    }
    
    DWORD currentTick = timeGetTime();
    float deltaSeconds = (currentTick - lastTick) * 0.001f;
    lastTick = currentTick;
    
    // DirectInput Poll
    PollInput();
    
    // World Physics & Entity Update
    UpdateSimulation(deltaSeconds);
    
    // Render Frame via GFX HAL
    pGfxDriver->RenderScene();
}
timeEndPeriod(1);
```

---

## 5. Architectural Implications for CrusadersOnline

1. **Clean-Room Feasibility:** The decoupling of graphics (`gfx_d3d.dll`), audio (`audio.dll`), and logic (`crusaders.exe`) proves that the original developers cleanly isolated their rendering pipeline from game state.
2. **Timing Model:** The original engine relied on delta time derived from millisecond system timers. In our browser MMORPG, we will separate rendering (which interpolates at browser `requestAnimationFrame` 60–144 Hz) from simulation (which ticks at a fixed 20 Hz on the authoritative server).
3. **No DRM Protection:** The GOG executable contains no SafeDisc, SecuROM, or StarForce DRM wrappers, allowing clean inspection of headers and standard file formats.


---

## 6. Animation System (Ghidra, 2026-10-09)

Functions identified and renamed in the Ghidra project:

| Address | Name | Role |
|---|---|---|
| `0x004250C0` | `Model_BindAnimationSet` | Swaps a model's animation set; reference-counted cache of 12-byte entries (`DAT_0053bd6c`) |
| `0x00425260` | `AnimCache_LoadEntry` | Opens `models\%s`, builds the animation object, resets playback fields, converts event times |
| `0x004243C0` | `Anim_ReadFile` | Reads the 56-byte header, the keyframe stream (size at header 0x34) and the event track |
| `0x00482DB0` | `AnimEvents_Read` | Event track reader: count, names size, times, names |
| `0x00482F20` | `AnimEvents_TicksToFrames` | Times > 500 × (1/4800) × 30 |
| `0x00422F30` | `Anim_EvaluateBones` | Per-bone evaluator (flag nibbles, constant/cubic channels, root X/Z lock) |
| `0x00422CF0` | `Anim_RootMotionHorizontal` | Root XZ displacement and direction between two times |
| `0x00422B80` | `Anim_RootMotionVertical` | Root Y displacement between two times |

Constants used: `0x004DE468 = 0.0` (minimum time), `0x004DE65C = 1.0`, `0x004EC2B8 = 3.85` (root height override), `0x004EC2BC = 1.5` (root Z offset).
Only behaviour is documented here; no decompiled code is copied into the source tree.


---

## 7. Movement and Character Stats (Ghidra + Capstone, 2026-10-09)

Many routines in this region are not yet functions in the Ghidra database (auto-analysis left gaps); they were located through vtable references and disassembled with Capstone (`tools/re` workflow, scratch script). Only behaviour is recorded here.

### 7.1 Locomotion is animation-driven
| Address | Name | Behaviour |
|---|---|---|
| `0x00429810` | `Char_RootMotionVelocity` | Advances the current clip by `dt × 1000 × clip.frameTime(header +0x04) × rate(+0x28) × (speedModifier() + bonus(+0x2C))` and returns the root's horizontal displacement over that interval divided by `dt` — i.e. a velocity. Handles wrap-around at the clip end. |
| `0x00427510` | `Char_HorizontalSpeed` | Speed magnitude and sign (forward/backward) for the current state. |
| `0x004274D0` | `Char_ClipRootDistance` | Total root displacement of a state's clip. |
| `0x0042AD30` | (vtable method, not a Ghidra function) | Horizontal speed query: returns a constant **15.0 units/s** when the creature is not animation-driven (flag mask `0x41`), 0 when frozen (`0x40`), otherwise the root-motion velocity. |
| `0x0042AE60` | (vtable method) | Vertical velocity from the root's **Y** motion with the same time formula — **jumps and drops are animation-driven**; no ballistic jump constant was found for the player. |

Open point: `dt × 1000 × 1/30` advances 33.3 frames per second of `dt` if `dt` is in seconds (vs. 30 fps authoring). The unit of `dt` still has to be confirmed at the caller.

### 7.2 Attributes and derived stats
| Address | Name | Behaviour |
|---|---|---|
| `0x00442000` | `Rules_LoadDefaultCtx` | Parses `script\default.ctx`. Attribute rows `DM/DI/DE/DS` go to the player at `+0x254/+0x258/+0x25C/+0x260` (column chosen by the difficulty byte at `[0x0058C268]+0x85`); `DR`/`DD` fill resist and unarmed-damage tables; `L` stores four ratios at `+0x238..+0x244`; `S` rows define spells. |
| `0x0044E000` | `Stats_ComputeEffectiveAttributes` | Effective attribute = base + bonus (`+0xD4..+0xE0`, equipment/potions), **capped at 50**, stored as bytes at `+0x264..+0x267`. |
| `0x0044E090` | `Stats_ComputeDerived` | With `level = [+0x230]`: damage multiplier `+0x248 = trunc(10 × (0.9 + 0.005 × Might × level)) / 10`; max mana `+0x22C = trunc(Intellect × level / 3) + 20`; max HP `+0x0C = 50 + 0.6 × Endurance × level`; speed multiplier `+0x24C = 0.999 + 0.01 × level + (Speed − 15) × 1.2 / 35 × 0.5`; current HP/mana clamped. |
| `0x0044E260` | (method, not a function) | Weapon hit: takes the stronger of the weapon's SLASH and BASH components and scales it by the damage multiplier `+0x248`. |

Implemented as pure functions in `shared/src/game/original_stats.ts` (tested); not yet wired into the vertical-slice balance.


---

## 8. Combat Damage Pipeline (2026-10-09)

Recovered after creating 827 missing functions with `tools/re/ghidra/CreateFunctionsFromVtables.java` (vtable runs of 16-byte-aligned code pointers + unresolved call targets). Names below are set in the Ghidra project.

### 8.1 Damage vector
A small class (vtable `0x004E0814`) holding **11 floats**, one per damage type in the order `SLASH, BASH, FIRE, AIR, EARTH, WATER, MIND, SPIRIT, BODY, LIGHT, DARK` (string table at `0x004EE694`). Element-wise helpers: copy `0x00441CD0`, `DamageVec_Add` `0x00441CF0`, `DamageVec_SubtractClampZero` `0x00441D10` (`max(0, a − b)`), `DamageVec_Multiply` `0x00441D50`; `0x00441D70` maps a type name to its index.

### 8.2 Outgoing damage — `Stats_GetOutgoingDamage` (`0x0044CCF0`)
1. unarmed damage (`DD` row, `+0x18`) + equipped weapon damage (inventory at `+0x1B0`);
2. stats vtable slot 45 (`0x0044E260`): keep the stronger of SLASH/BASH × damage multiplier (§7.2);
3. × attack-mode scale (`+0x44`; `0x0044CDD0` sets 1.0 or **1.25**);
4. + bonus damage (`+0xEC`, e.g. spell effects);
5. × multipliers (`+0x11C`).

### 8.3 Incoming damage — `Stats_TakeDamage` (`0x0044CBA0`)
Per type: `max(0, incoming − absorb) × resist × protection`, then the positive components are summed into one number:
- `resist` = the defender's resist table (`+0x74`; for the player the `DR` row of the current difficulty: e.g. SLASH/BASH 0.6 easy, 0.9 medium, 1.2 hard), combined with equipped items' `SetProtection` multipliers (armour: Scale 0.9, Banded 0.8, Light Plate 0.7, Heavy Plate 0.6) and other multipliers (`+0x14C`);
- `absorb` = flat absorption (`+0xA4` and inventory, × `+0x17C`); its data source is not yet identified (zero for ordinary equipment).

### 8.4 HP loss, flinch and death — `0x0044CA00` (stats vtable slot 19)
- Ignored while the invulnerability flag (`+0x1F4 & 2`) is set.
- `hp −= damage`. If `hp ≤ 0`: hp = 0, death handler (slot `0x90`).
- If the player survives: `v = 0.5 × random + damage / hpBefore` (random from a 4096-entry table × 50 × 0.01); `v ≥ 0.8` → physics flag `0x80000`, else `v ≥ 0.7` → controller flag `0x4000000` (vtable `+0x2C`). Creatures skip the roll (the owner is compared with the player global `0x00542FB0`). A damage source whose `+0x34` is 150 also sets `0x4000000` (not identified yet).
- The impact state picker (`0x0042B7A0`, and its copies at `0x0042AFE0` / `0x0042C000`): controller flag `0x4000000` → **ASM_IMPACT_SEVERE** (the knock-down, PI02 "knockdown impact" in models.ctx, 48 frames, thrown ~9 ft back and up again 5.36 ft from the start); else physics flag `0x80000` → **ASM_IMPACT_MEDIUM** (a stun: models.ctx binds no clip to it); else a directional ASM_IMPACT_FRONT/LEFT/RIGHT/BACK (17-frame clips) chosen from the hit vector. Skipped while physics flags `0x21940` are set (airborne and similar). So 0.7 ≤ v < 0.8 knocks the player down and v ≥ 0.8 only stuns — consistent with the Frida log (§15.2): 10.1 damage at 25.1 HP → IMPACT_SEVERE, 14.4 at 15 HP → IMPACT_MEDIUM.

### 8.5 Shield block — `Stats_TryBlockWithShield` (`0x0044D5E0`)
Only while the shield-raised states (5 or `0x1D`) are active: block if the dot product between the defender's facing and the direction to the attacker is greater than `cos(30.0)` — evaluated with **30 radians**, i.e. ≈ 0.154, a frontal cone of about **±81°** (very likely meant as 30°; reproduced as-is for parity). A successful block calls the shield's Use action.

Implemented as pure functions in `shared/src/game/original_stats.ts` (`originalDamageTaken`, `originalFlinch`, `ORIGINAL_BLOCK_COS`) with tests. Item data: `converter/src/formats/items_ctx.ts` parses `script/items.ctx` (156 items, inheritance resolved) into `rules/items.json`.

---

### 8.6 Hit effects (Frida, 2026-10-12)

`script/effects.stg` defines the special effects: SHAPE (a sprite: texture, OUTER / CENTER / INNER colours), FLASH (one animated shape: start size, size speed and acceleration, rotation speed, attack / sustain / decay seconds, MOVE, GRAVITY, RANDOMIZE_SIZE / _MOVE, POSITION, SPAWN_MULTI trails) and MULTI (a named effect: `ADD FLASH <flash> <delay>`, one list per variant = spell level). The engine's effect names are a 91-entry table at `0x004F35F8` (0 SWORD_DAMAGE, 1 SWORD_METAL, 2 SWORD_STONE, 3 BLOOD, 4 LIGHT_CAST, 5 SPELL_WINDUP, ... 86 UNDEAD_BLOOD, 87 BUGJUICE, 88 BONE, 89 MANA_RECHARGE, 90 HEALTH_RECHARGE); `0x00481FC0(type, variant, pos*, dir*)` spawns one.

Logged with Frida while fighting skeletons, blocking, breaking a barrel and striking a wall:
- **Landed hit** (`0x0044D0xx`): the effect type comes from the victim (virtual call): skeletons BONE ×3–7, Drake (living) BLOOD ×2–3, plus the victim's particle emitter (`0x0043E310`, kind 5, speed 40); then one effect per elemental damage type present (fire → DAMAGE_FIRE, frost → DAMAGE_FROST, holy → DAMAGE_HOLY, dark → FIREBALL_PROJ_EVIL_SPAWN — the skeletons' blows carry it).
- **Blocked blow** (Drake's or a skeleton's shield): SWORD_DAMAGE + SWORD_METAL ×3 (×1 at low detail) spaced along a line at the shield.
- **Blade on a wall or the floor** (`0x0048CCC2`): SWORD_DAMAGE + SWORD_METAL ×3 along the surface normal.
- **Breakable prop** (a barrel): SWORD_STONE ×6 upwards, plus a debris emitter (kind 12).

Implemented: the converter writes rules/effects.json; the client renders the flashes as sprites (alpha from the textures, glows additive) and spawns these effects from combat events, prop hits and its own swings meeting a wall.

**Units (from the code, 2026-10-13).** The parser (`0x004C45C0`, property setter `0x004C5170`) stores MOVE, RANDOMIZE_MOVE and the size speeds × 0.001 and GRAVITY and the size accelerations × 10⁻⁶, against the engine's integer-millisecond clock: feet per second and per second². ROTATIONSPEED is × 2π (turns per second). The flash update (`0x004C5820`) grows the size by its speed and acceleration; the mover (`0x004C5B50`) adds GRAVITY, turned by the flash's heading about the vertical, to the velocity and moves by it; POSITION is an offset in feet. The sprite (`0x004A9990`) projects a half-width of size × 0.05 × 27.3 against a view depth the camera matrix stores × 54.6 (both from the camera at `[0x0053C218]`), i.e. a quad **0.05 ft per size unit**. (The earlier reading — tenths of a foot, per-tick speeds — made sprites 1.7 times too large and speeds 3 times too high.)

**Chips of a landed blow.** Besides the victim's effect, the hit routine calls the debris spawner `0x0043E310(texture, 5, ±1.2 ft, hit point, speed 40)`: five physical chips in the victim's own texture (blood-type victims: ±0.2 ft and a blood texture; creatures with flag 4: ±1.9 ft, speed 20, no effect). The spawner's first argument selects the model table — 0 → 0x4EE178 (metal), 1/2 → 0x4EE138 (stone), 3 → 0x4EE158 (wood), a texture id → 0x4EE1B8 wearing that texture. Each piece (`0x004108B0`) is shrunk to (0.4 / count)^⅓ × the half extents per axis, spins 60–150 / 50–150 / 40–150 °/s and lives 5–10 s, or 1.5 s when its box is under 2 ft³ (so a blow's chips vanish quickly). Implemented for bone creatures; blood chips not yet (texture `[0x00585400]` unidentified). Undead blows add FIREBALL_PROJ_EVIL_SPAWN (the green dark flame) on the victim. The per-object particle emitters are not reproduced yet. (The earlier guessed rush sounds are replaced by the decompiled ones, §8.6b.)

### 8.6b Stopped blows and the shield rush, decompiled (2026-10-17)

**Stopped blow** (`0x0044D290`, branch where the victim's stats slot `+0x54` = `Stats_TryBlockWithShield` succeeds; `param_2` = victim, `param_1[1]` = attacker):
- **Sound** (`0x4B0FC0`, at the *attacker's* position): victim type outside 0x71–0xCA → 343 HitStone02. **Drake is type 142 (0x8E)** — captured live (Frida, `local/frida/blocksnd.js`), sound row 142 = flesh impact, metal block, cries 0 / 103 — so his shield takes the creature path too: 16 blocks of skeletons' long swords played 339 ×10, 340 ×5, 341 ×1. A creature (Drake included) → table `0x4EEDA8[((edge + 2·m)·5 + r)]`, m = the creature sound table's second dword (`0x4EEA8C`, 2 for every shielded type), edge = 1 when the attacker's outgoing SLASH > BASH, r = round(rand·4) (0 and 4 half as likely). Rows of five: bone 302 / 308, flesh 300 303 303 337 353 / 304 305 306 307 336, **metal 338 338 346 346 355 (blunt) / 339 339 340 341 357 (sharp)**, ice 354 / 356. The landed-blow routine `0x0044CEF0` uses the same table with the first dword (impact material; Drake flesh); non-creatures (props) → 306.
- **No shield material.** Shields in items.ctx differ only by model/texture/protection; the BLOCK use behaviour (vtable `0x4DE484`, slot 1 `0x401F20`) only decides which attacks a shield stops (melee bit; FIREBALL / LIGHTNING; GIANTS for types 0x87–0x8A and weapons with `+0x20` ≥ a threshold). Wooden and Metal shields sound the same.
- **Sparks**: `[0x58C878]` (detail) ? 3 : 1 times SWORD_DAMAGE + SWORD_METAL, the i-th at the victim's contact point + i · 0.8 ft along the attacker's blade sweep (physics `+0xAC`). **Light** `0x44BEA0(150, pos, …, 300 ms)`: grey (150,150,150), fading out over 0.3 s (list consumer `0x44BF90`).
- Then the ×−4 shove (§15.4) and events 0x13 / 0x14.

**Shield rush.** `0x48CF00` / `0x4920A0` set physics flag `0x40000` on every step while the main state is 0x1E (RAM_SHOULDER). The body sweep `0x493F20`: a mover with physics flag 1 meeting a character (types 0x71–0xCA, Drake's 142 among them, or 2) pushes it by 0.3 × the remaining move (and keeps ~0.3 of its own), re-sweeps, and when still blocked stops against it; with `0x40000` it then rolls round(rand·10) == 0 (**5 % per step**) for: victim controller flag 0x8000 + physics 0x80000 (player victims: ASM_IMPACT_MEDIUM; creatures: the impact from their push, `0x4273F0`, so IMPACT_BACK when met from the front), a rushing *player* `Stats_LoseHp(1.0)` (flinch roll, can kill), a Necros rusher also a 30-unit push and the knock-down flag, and sounds **0 (DDam01) + 338 (HitMetal01)** at the rusher. No shield check: the creature's bash (its special against a raised shield) stuns through it. The roll is per rendered step, so frame-rate dependent; the live log (impact at once, 2–5 HP per rush) fits ~120 steps/s. Creatures' knock-down ~0.5 s after the reel is from the log only (not found in code).

### 8.6c Decals: weapon marks, scorches, frost (decompiled, 2026-10-18)

**Blade on the level** (`0x0048CAB0`, the blade physics' world contact; `param_1` = blade physics, the two points = its segment): if the segment meets the cell's faces (`0x004395F0` → `0x00438810`), it plays 338 + ftol(rand × 4) (HitMetal01-04 / HitStone01) at the owner's position, SWORD_DAMAGE + SWORD_METAL × 3 (0.8 ft apart along the normalised sweep), the grey 150 light for 300 ms, then the decal `0x00442E30(cell, kind, point, dir)` with kind = the held weapon's item `+0xAC` (`0x0046B880` → equipped slot; none → −1, no decal) and dir = the blade's motion (physics `+0x11C` − `+0x128`).

**Kinds** (items.ctx `Decal`, parsed by `0x00444060` through names `0x004EE974` → ids `0x004EE9A0`): NONE −1, SCORCH 0, SCRATCH 1, LIGHTNING 2, CHOP 3, SLAM 4, FROST 5, CLAW 6, L_FOOTPRINT 7, R_FOOTPRINT 8, BLOODSTAIN 9. Textures (`0x004EE834`, 0x20 bytes each, loaded by the decal manager init `0x00442B05`): SCORCH1, SLASH-25, LIGHTNINGHIT, AXE-15, BLUNT, FROST2, CLAW-40, FOOTPRINT ×2, BLOODHIT. Size per kind at manager `+0xC630 + 4 × kind`, 4.0 ft unless set: SCRATCH 2, CHOP 2, SLAM 2.5, footprints 0.8, BLOODSTAIN 3. Weapons: axes / picks / halberd CHOP, maces / hammers / clubs SLAM, swords SCRATCH (Hammer of Bolga and Cursed Axe too, as data), Flamestinger SCORCH. textures.nfo's per-material `Decal` (hole / scorch / slash) is never read: only the items parser calls `0x00444060`.

**Placement** (`0x00442E30` → `0x00443580` per face of the point's cell, faces with `+0x64 & 1` clear and `+0x60` set): the point must lie in front of the face plane and size² − distance² ≥ 0.2; footprints only on floors (normal y ≥ 0.7). A square of half side `size` about the point's projection, lifted to 0.07 ft off the face, U along the projected dir (a default axis without one), clipped to the face polygon (`0x004432D0`); fewer than 3 corners → dropped. Then decals of the cell within 2 × size of the new one have their end clamped to now, and the new one ends at now + 5000 ms. Pool of 50 records (`0x004CEBE4(+0x4C0, 0x50, 0x32)`). Only when the driver query `[0x0058C878]` allows.

**Drawing** (`0x00443B30` / `0x00443D70`): colour = the cell's lights summed (capped 250 per channel); alpha 255 until the end time, then falls to 0 over 1500 ms (`0x5DC`).

**Callers:** fire ball impact `0x004BE790` SCORCH at the contact point, no dir (on a character or the level); lightning bolt `0x004BEE90` LIGHTNING at its end when its segment meets the level; snap freeze on a character `0x004C1130` and every character the ice storm catches `0x004C1490` FROST at its position; snap freeze meeting the level `0x004C12E0` SNAPFREEZE_FIZZLE + FROST at the contact; `0x004C0BD0` (the Boomer Axe's magic axe meeting the level, §23.1: SWORD_METAL, SCORCH, sound 328 / 206); BLOODSTAIN under bleeding / dying characters (`0x0044C6A0`, `0x0044DD50`, `0x004577F0`); footprints on the FOOTSTEP clip events 0x0E / 0x0F (`0x00457890`).

### 8.7 Level music (2026-10-12)

Music goes through Miles' redbook (CD audio) API (`AIL_redbook_play` etc., imported); the GOG release's mss32.dll plays `Music/<track>.mp3` instead of the CD. The player object's set-track routine (`0x004336E0`) plays CD track `value + 1` (track 1 is data) and loops it (`0x00433820` restarts it when its end time passes); it is called on level entry with the byte at `[[0x0058CA04] + 0x1C]` — `0x0058CA04` points to the current act's in-memory `.cap` header, so the track is the `.cap` header byte +0x1C (0 = silence; 0 is also pushed to stop the music). Tracks used: towns 2, inns 3, castle acts 8 / 10 / 11, the rest 4–16. Implemented: the converter copies the tracks and writes `music` in each act's placements; the client loops the act's track, with a volume setting.

## 9. Creatures, Experience and Blocking Follow-up (2026-10-09)

### 9.1 Creature template table (`.data` 0x004ED058–0x004ED9B8)
50 records of 0x30 bytes, ids 113–162 (the engine's creature type id range 0x71–0xCA is used to index per-type hit and death sound tables). Fields per record, in order: type id; appearance (low byte = model index, next byte = texture variant); five item-name pointers (weapon, shield, three extra); four dwords, of which the third is a **disposition** (1 = citizen, 2 = guard / friendly fighter, 3 = hostile, 255 = unused slot) and the fourth a **spell bit mask** (non-zero only for casters: elementals, Deceiver, Dark Mage/Master, Necros, Skeleton Ghost); the creature's display name. `Stats_EquipLoadout` (0x0044D9D0) equips the item fields when a creature is created.

Examples (facts only):

| Creature | Weapon | Shield | Disposition |
|---|---|---|---|
| Skeleton Warrior | Long Sword | Wooden Shield | hostile |
| Skeleton Ghost | Long Sword | Wooden Shield | hostile (spell mask 2) |
| Shadow | Heavy Mace | Wooden Shield | hostile |
| Dark Mage / Dark Master | Mace / Heavy Mace | Metal Shield | hostile (casters) |
| Ogre Outlaw | Battle Axe | — | hostile |
| High Guard / Old Guard | Long Sword | Metal Shield | guard |
| Greater Black Knight | Broad Sword | Metal Shield | hostile |
| Dwarf Ironpick Rebel / Zealot | War Hammer / Battle Axe | Metal Shield | hostile |
| Dasher Brute / Dasher Scout | Dasher Weapon / Dasher Hand Bow | — | hostile / guard |
| Ice Titan | Club | — | hostile |
| Deceiver | Mace | — | hostile (caster) |
| Ice / Rock / Lava Elemental, Necros | — | — | hostile (casters, unarmed) |

The appearance word indexes models.ctx: low byte = model id (`N` line), next byte = which `T` texture of that model, e.g. 0x0223 = model 0x23 `Male02.mdl`, texture 2 `Male02Ogre`; 0x0129 = `M37Tamris.mdl` texture 1 `DasherBrute256`. The sound table at 0x004EEA88 (16 bytes per type, same order) holds an impact material (0 bone, 1 flesh, 2–4 other: metal / ice / rock by the types using them), a constant 2, the damage cry and the death cry (Sound.ctx ids).

Implemented: every armed hostile type is a level archetype (Dasher Brute, Ogre Outlaw, both Ironpick dwarves, Ice Titan, Dark Master, Greater Black Knight, Deceiver beside the skeletons and the Dark Mage) with its template loadout, model, texture, held equipment and cries; their AI and swing timings are the skeleton's (not measured per creature). Since §22 also the Ice / Rock / Lava Elementals, Necros and the Ghost Father.

### 9.2 Creature stats
- Creature stats share the player's damage pipeline (§8) except vtable slot 45, which is empty for creatures: **creatures do not apply the Might multiplier or the stronger-of-slash/bash rule** — they deal the weapon's whole damage vector (unarmed `DD` row + weapon), × attack mode, + bonus, × multipliers. Skeleton Warrior with a Long Sword therefore hits for 10 slash (9 after the medium resist).
- The creature constructor (`CreatureStats_Ctor` 0x0044C130) defaults HP/max HP to 20. Saved creature state (`CreatureStats_Save/Load`) contains HP, max HP and the disposition pair (`+0x1D4/+0x1D8`, default 3 = hostile; the Spectral Ally spell sets 6). HP, XP value and resists of placed creatures come from the `.cap` object records (asset-format-discovery.md §6.2).
- `Stats_LoseHp` (0x0044CA00): the flinch/stagger roll (§8.4) only runs when the victim is the player; a hit from creature type 150 (Necros) always forces the light flinch.
- On death (`CreatureStats_OnDeath` 0x0044C6A0) the creature's XP value (`+0x1C4`) is passed to the player via `Stats_AddExperience`, the death sound for its type is played and spell effects are released.
- A dead creature keeps its inventory on the corpse: the ground window (`0x00471940`, inventory screen mode 1) lists, for every dead creature within reach (+0x14 flag 0x40, not type 155, not the player), each inventory slot except items named `Large Club` / `Large Iron Club` (strings 0x4EFE88 / 0x4EFE78) and slots already taken (slot +0x14 flag 0x10000000, set when an item leaves the corpse, 0x47096D). So a corpse gives its gold, potions, books and the weapon and shield it held.

### 9.3 Experience curve — `Stats_AddExperience` (0x0044DE40) / `Stats_LevelUp` (0x0044DEE0)
- New player: level 1, XP 0, next threshold **500** (`PlayerStats_InitDefaults` 0x0044DC60, which also sets base HP 50).
- On reaching the threshold: level + 1; threshold += table[new level] with table = `0, 500, 1000, 2000, 3000, 4000` for levels below 6, **+4000** from level 6 on. Thresholds: L2 500, L3 1500, L4 3500, L5 6500, L6 10500, then every 4000.
- Level-up recomputes derived stats and **adds the max-HP gain to current HP** (not a full heal).
- XP loss (negative amounts) cannot drop below the current level's start.

### 9.4 Shield block result
`Stats_TryBlockWithShield` (§8.5) returns a boolean; on success it calls the shield's Use behaviour (item behaviour vtable slot 1). No partial-damage path was found: the slice treats a block as stopping the whole hit (still an assumption, see UNK-008).


---

## 10. Third-Person Camera and Controls (2026-10-11)

The chase camera class (vtable `0x004DF124`; most methods are not Ghidra functions and were read with Capstone) keeps its parameters in feet. Behaviour only:

### 10.1 Rig geometry
| Field | Value | Meaning |
|---|---|---|
| `+0x3BC/+0x3C0/+0x3C4` | 0, **4.0**, 0 | Rig anchor offset from the character position (feet) |
| `+0x3CC` (`0x004ECC58`) | **2.2** | Height of eye and aim point above the anchor, in the rotated frame (debug key "Cam Height", step 0.1 at `0x004DF89C`) |
| `0x004ECC5C` | **−7.0** | Eye distance along the view axis (debug key "Cam Distance"); −6 and no pitch when the character's state flag `0x20000` is set (state not identified) |
| `+0x3D0` | **8.0** | Aim point distance ahead of the anchor |

- The rig rotates with the character's heading and look pitch (Euler builder `0x0042D580`, degrees: yaw about Y, then pitch about X, then roll; plus a pitch offset argument). The eye is anchor + R·(0, 2.2, −7), the aim point anchor + R·(0, 2.2, 8): at pitch 0 the camera looks level from head height.
- Line of sight is tested from 2 ft above the character position. When the eye is hidden, its distance shrinks in 1 ft steps until the line is clear; the aim distance shrinks the same way from 8.

### 10.2 Per-frame smoothing (`0x00430C30`)
Frame time `ms` comes from `0x004FDFA4` (integer milliseconds). With `gap` = distance from the current point to its target (feet):
- eye: `t = min(1, gap × ms × k × 0.002)`, `k = (2 − gap) × 5 + 1` when the character is not moving horizontally and `gap < 2`, else 1;
- aim point: `t = min(1, gap × ms × k × 0.0008)`, `k = (5 − gap) × 2 + 1` under the same conditions with `gap < 5`;
- both snap on the first frame (flag byte `0x004ECC60`); a smoothed eye that falls outside the level's cells jumps to its target.
The camera orientation is then derived from eye → aim point (atan2 for yaw and pitch).

### 10.3 Projection
View window ±100 × ±75 at distance 120 (`+0x244..+0x250`, `+0x220`, set by `0x430470`; the projection `0x431710` scales x and y by 2·120 / window size). `0x0042E5D0` refits the vertical extent to the 3D viewport's aspect (±100 × h / w), and that viewport is always the whole screen (§10.4), which the original only ran at 4:3: the view is **79.6° × 64°**. Near 0.5 ft, far 1600 ft (`+0x16C/+0x170`, far clamped to 15–2000).

CrusadersOnline keeps that whole 4:3 window in view on any screen (wider windows add to the sides, narrower ones above and below), and during sequences fits it between its cinema bars (not the original's).

### 10.4 HUD screen size
`0x00468960` lays out the 3D viewport from a screen-size step (HUD byte `+0x90`): at a step ≤ 0 it is the whole screen; a step n ≥ 1 would use the top three quarters inset by 16n × 9n pixels. The keys only move the step between −1 (HUD hidden, `0x468B20`) and 0 (HUD shown, `0x468AB0`), so the 3D view always fills the screen and the HUD overlays it. (Corrected 2026-10-14: an earlier reading took the three-quarter layout for the default.)

### 10.5 Controls (game Readme)
ESDF movement (E forward, D back, S/F strafe), arrows / numpad 4-6 rotate, numpad 9/7/5 look up / down / centre, mouse free look, Space jump (with a direction: directional jumps and flips), C crouch (with a direction: rolls), Shift + direction walk carefully. LMB attack (combos by repeated taps; C/Space/E/S/F + LMB select crouch, jump, overhand, left and right attacks), RMB block, Space + RMB shield rush, Tab interact, R cast, Z use item, W/T/Q cycle weapon/spell/item, A quick select, I inventory, M map, H health potion.
CrusadersOnline moves the scheme to WASD (`client/src/input/keybindings.ts`); keys displaced by the shift go to the nearest free key (next weapon → E, quick select → X).

Implemented (superseded by the measurements of §14): forward or jump + click plays `ASM_JUMP_ATTACK`, left / right + click Drake's side swings (`PN09`/`PN10`), plain clicks the five-swing ASM combo; directional swings are single hits outside the combo chain. The attack-mode scale `0x0044CDD0` (1.0 / 1.25) is chosen per difficulty, not per attack, so the swing kind changes only the animation. The feet stay planted during the player's swing, and on diagonals the body turned 45° into the motion (a playtest reading, superseded by the decompiled selector in §11.1: a diagonal is a sidestep; kept as feature `diagonalMoves`).
The mouse wheel blends the camera from the classic rig (closest) to the optional modern one (farthest).

---

## 11. Player Locomotion Speeds from Root Motion (2026-10-11)

`Char_RootMotionVelocity` (§7.1) advances the state's clip and turns the root's horizontal displacement into a velocity; the clip wraps at header field `+0x14` − 1 frames (`+0x14` is the loop length for the locomotion clips; one-shot clips store 34 there). The `.ani` header `+0x04` is 1/30 (frame time). Measured per loop on Drake's clips (root displacement between frame 0 and the wrap frame, 30 fps; feet):

| Clip (models.ctx label) | Loop | Distance | Speed |
|---|---|---|---|
| `PA01_ru_f` run forward | 25 frames | 13.0 ft | **15.6 ft/s** (4.75 m/s) |
| `PB01_w_fw` walk forward (careful) | 33 | 5.7 | **5.2 ft/s** |
| `PA06_rt` retreat | 39 | 5.0 | **3.9 ft/s** |
| `PB01_w_sideleft` / `sideright` sidestep, running | 22 | 7.3 / 7.8 | **9.9 / 10.6 ft/s** |
| `PB02_sdstp_l` / `PB03_sdstp_r` sidestep, careful | 20 | 2.3 / 2.8 | **3.5 / 4.1 ft/s** |
| `PB04/PB05_cm_stp` combat sidestep | 20 | 4.9 / 4.5 | 7.0 / 6.8 ft/s |
| `PE03/PE06` roll forward / back | 25 | 10.7 / 11.0 | 13.4 / 13.2 ft/s |
| `PC07/PC08` hop forward / back | 20 | 5.7 / 5.8 | 8.5 / 8.7 ft/s |

The run speed agrees with the 15 units/s constant used for creatures that are not animation-driven (§7.1). The jump clips (`PC01`–`PC06`) move the root only ~0.9 ft up and hardly at all horizontally, so jump height and distance come from somewhere else (UNK-012). These speeds are used as `DEFAULT_MOVEMENT_STATS` (`shared/src/constants.ts`); the per-character speed multiplier (`+0x24C`, §7.2) is not applied yet.

### 11.1 How the player's movement is chosen (decompiled, 2026-10-13)

- **States from keys (`0x0042AFC0`, called each frame from `0x0042C500`).** Keys are read as two axes (`0x00492B70`): back wins over forward, left over right. Forward → RUNNING (1), or WALKING (2) with Shift or the shield; back → RETREAT (19). A sideways key **overrides** both: running sidestep (unnamed states 87 / 88), with Shift ASM_SIDE_STEP_L / R (5 / 6), with the shield ASM_HOP_L / R (45 / 46). A diagonal key pair is therefore a sidestep, not a diagonal run, and the body keeps the view heading. C + a direction rolls, checking forward, back, left, right in that order.
- **Clips (controller `0x00429BF0` → `0x00429590` over the pair table `0x004EC820`, 85 entries; `0x004EC578` is the same with the relaxed stand and turns).** The player's states index models.ctx's L list of `drake.mdl` (the B lines of model 29 belong to the Drake NPC and differ): RUNNING PA01, WALKING PB01_w_fw, RETREAT PA06, 87 / 88 PB01_w_sideleft / sideright, 5 / 6 PB02 / PB03, HOP_L / R **PB04_cm_stp_l / PB05_cm_stp_r**, STANDING PA21, upper-body layer 2 (side and air swings) PN02.
- **Motion.** The state's clip root motion (bone 0 X / Z, `0x00429810` → `0x00422CF0`) in the character's frame, looping at header `+0x14` − 1 frames. The running sidesteps drift forward: left 7.20 ft + 1.11 ft forward and right 7.71 ft + 0.85 ft per 22-frame loop (10.9 / 11.7 ft/s sideways, 1.7 / 1.3 ft/s forward). Per-loop speeds: run 17.33 ft/s (13.0 ft / 25 frames), retreat 4.10 (5.04 ft / 41), walk 5.73 (5.68 ft / 33), careful sidesteps 2.35 / 2.78 (one 20-frame step per 33-frame loop).

- **Speed × key axes (`0x00427600`, confirmed in play).** The root path the state's clip covers this frame, as a speed, is added to the velocity *per held key axis*: sideways key ±1 and forward / back ±1, each times that speed. A sidestep alone therefore moves straight sideways (its clip's forward drift does not show), and a diagonal is the sidestep's state and clip moving at 45° at √2 × its speed. Logged with Frida at 16 ms (yaw fixed, ESDF keys): run 17.6 ft/s, left / right sidesteps 11.1 / 11.9, forward-right 16.9–17.1 at exactly 45°, forward-left 15.2–15.8, back-left 15.7, back-right 17.1. A state change restarts the new clip at frame 0 (`0x004295D0`), so switching sides restarts the step. With the shield, sideways or diagonal keys stay in ASM_HOP_L / R and its clip loops every 33 frames: the step (frames 0–21), then still until frame 33 (logged: speed peaking ~28 ft/s on a diagonal, then 0, period 0.96 s); alternating sides restarts the step and skips the still part, so it is faster.

Second capture (forward / back and Shift diagonals): the clip time advanced at **34.0 frames/s**, i.e. 1000/30 × the character's speed multiplier (stats `+0x24C`, 1.019 at level 2); per loop the run covered 13.06 ft in 0.74 s (the clip's 13.0 ft), the careful sidesteps 2.77 / 3.08 ft per 33-frame loop (the clips' 2.76 / 3.07) and Shift diagonals 3.9 ft per loop at 45° (√2 × 2.76) — the model holds; only the rate was missing.

Implemented so: `LOCO_CLIPS` (each clip's cumulative root path per frame and its loop), `advanceLoco` at the clip rate × the speed multiplier (`MovementStats.clipRate`, sent in SC_PLAYER_STATS `speed`) and the clip locomotion in `stepCharacter`; the same rate times every player clip — swings (× the weapon's Speed; the upper-body layer's side and air swings by the rate only, then the layer's 1/12 s fade), rolls, attack root motion, hit reactions, the shield rush and the conjure (both clocks, `0x00429810` and `0x00428DD0`, multiply by the stats' speed multiplier); creatures stay at 1 (their multiplier is not read yet); with the state and clip frame replicated for prediction (snapshot header bytes 32–33); the client restarts the hop and careful-sidestep clips every 33 frames. The earlier diagonal run with the body turned 45° (a playtest reading, see §10.5's note) is kept as the non-original feature `diagonalMoves`.

Rolls (C + direction; `ASM_ROLL_F/B/L/R`): forward 10.73 ft in 25 frames, back 10.96 ft / 25, left 10.80 ft / 27, right 9.99 ft / 25 (`ORIGINAL_ROLLS`). A roll runs its full length once started. C alone ducks in place (`ASM_CROUCHING`, `PE02_dk_cvr`).
*Corrected 2026-10-17 (decompiled):* the ground selector (`0x0042AFC0`) returns ROLL_F / B / L / R (13 / 16 / 14 / 15) **every frame** C (key byte `0x0058B9DD`) and a direction are held (bit 2 of each key byte is "held", bit 4 "held last frame"), whichever was pressed first; the controller (`0x00429BF0`) keeps the roll until its clip ends and plays the roll clips *looped* (`0x004295D0` last argument 1). So C + W held rolls back to back, and W pressed while already ducking rolls too. A state ends once its clip time passes header `+0x14` − 1 frames (controller flag 4, set at `0x00429257`): PE03 24 frames, PE04 / PE05 / PE06 26 (`ORIGINAL_ROLLS` now holds those lengths).
The jump search (UNK-012) found the AI maneuver tables (`0x004EA268`: RANGED / RUNNING_JUMP / JUMP / MELEE and NONE … THROW_WEAPON, MANEUVER_LR/BACK) but no player jump impulse; the only `GRAVITY` string belongs to the particle system.

Hit reactions: creature and player models bind `ASM_IMPACT_FRONT/LEFT/RIGHT/BACK` (`PI15`–`PI18`), `ASM_IMPACT_SEVERE` and alternates, and up to nine death clips (`ASM_HIT_POINTS_DEPLETED` + `_ALT_01..08`). The client plays the impact for the attacker's side and a death variant seeded by the entity id.

---

## 12. Command-Line Options and Debug Console (2026-10-11)

**Command-line switches** (parsed by `0x0047AA30`, case-insensitive): `window`, `clipmouse`, `nosound`, `nocd`, `noNetworx`, `lobby`, `fullbright`, `no3dnow`, `cheatkeys` (sets `0x00542F70`), `software`, plus `-weapons` / `-damage` (set `0x004EE740` / `0x004EE741`, both also forced to 1 at start-up).

**Debug console.** A typed-text line (object `0x0053C810`; key handler `0x0043B510` → `0x0043B790`, opened by `0x0043B710` from the input loop `0x00411300`; the opening key is not identified yet). On Enter, a line starting with `-` goes to the command parser `0x0043BE90`, and a line starting with `CS` goes to `0x0043C840` when `0x004ECD14` is set. Commands:

| Command | Effect |
|---|---|
| `-DEBUG` | Toggles a debug flag (`0x006313F4`) |
| `-BOUNDINGBOX` | Bounding-box display (`0x00422AC0`) |
| `-EMBIGGENME` | God mode on/off |
| `-CRAZYGUY` | Sets a mode on the player object (`0x004BD720(…, 3)`) |
| `-WHOAH` | Toggles flag `0x00589AAD` bit 0x20 and resets something on the camera manager (case 4 of `0x0043B9B0`) |
| `-SHOWFPS` / `-CALCFPS` | Frame-rate display / measurement |
| `-DRAW_MODELS` | Model drawing toggle |
| `-GOTTAGO <cap>` | Loads level `caps\<cap>.cap` |
| `-JAHLOC x y z` / `-JAHLOC <n>` | Teleports the player to coordinates (feet) or to locator n |
| `-UBERLOAD` | Cycles through the levels in `caps\CAPOrder.txt` with god mode |
| `-RES +/-/<n>` | Screen-resolution step |
| `-MOUSE` / `-INTENSITY` / `-SOUND` / `-DIALOG` / `-MUSIC <0-100>` | Mouse sensitivity (default 0.5), brightness (0.25), sound / dialogue (0.85) and music volumes |

The camera-adjustment cases of `0x0043B9B0` (§10.1) are reached through `0x0043C840`.

---

## 13. Character Physics and the Jump (x32dbg + Ghidra, 2026-10-11)

Recovered by debugging the running game (x32dbg with the MCP plugin): hardware write breakpoints on the player's physics component, conditional on an upward vertical velocity, while the user jumped. Behaviour only.

**Objects.** The player character (global `0x00542FB0`) has a transform at `+0x40` (position at `+0x28/+0x2C/+0x30`, feet) and a physics component at `+0x4C` (vtable `0x004E26DC`): flags `+0x60` (bit 0 grounded, `0x10000` airborne, `0x8000` jump requested, `0x40`/`0x2000` other contact states), local velocity `+0x78/+0x7C/+0x80`, world velocity `+0x84/+0x88/+0x8C`, acceleration `+0x90/+0x94/+0x98`, gravity scale `+0x9C` (1.0), in-air travel accumulators `+0x170..+0x17C` and travel limits `+0x164..+0x16C`.

**Update** (`0x004920A0`, physics vtable `+0x34`, called by the character update `0x00458500` with the frame time in milliseconds × 0.001):
1. Acceleration (`0x00492B70`): grounded → vertical velocity held at **−5 ft/s**, no vertical acceleration; airborne → vertical acceleration = **−78.4 ft/s²** × gravity scale × global `0x004ECBB8` (1.0), halved while staggered (`0x80000`).
2. **Jump** (flag `0x8000`, cleared on use; sets airborne): vertical acceleration += 78.4 / dt × 0.033 × 15 × 1.3 for that frame, i.e. a take-off impulse of **Δv = 50.45 ft/s** independent of the frame rate (`0x004ECD6C` = 1.3 is a global jump/physics scale). It also sets the in-air travel limits to 1.3 × 4 = 5.2 ft per axis, scaled by the jump kind (argument: 10 → ×2.5 horizontal, 9 → ×1.5 horizontal, 8 → ×2.3 vertical; the standing jump observed was kind 8).
3. While jump is held in the air: vertical acceleration += 78.4 / dt × 0.033 × 1.3 × 0.06, a lift of ~0.2 ft/s per frame (frame-rate dependent in the original; 6.05 ft/s² at 30 fps).
4. Velocity integration and drag (`0x004923E0`): v += a·dt, then per world axis v −= k·v·|v|·dt with k = 0.02 horizontally in the air and 0.01 vertically while rising (0 while falling). Once the in-air travel on an axis exceeds its limit, k becomes 0.05 horizontally / 0.1 vertically. On the ground k is a friction term (0.9 / 2, ×2.5 or ×3.5 per state). Speeds under 2.5 ft/s with no acceleration snap to 0.
5. Position += world velocity × dt; collision against the level follows.

Measured: the first frame after take-off reads 45.45 ft/s (50.45 minus that frame's gravity), and the sampled trajectory matches a simulation of these rules within frame-rate noise. Standing jump: **peak ≈ 13.2 ft (4.0 m), ≈ 1.17 s in the air** at 30 fps (≈ 14 ft holding jump).

**Developer fly mode.** Flag `0x00589AAD` bit `0x20` (console command `-WHOAH`, §12) switches the player to free flight at 30 ft/s, adjustable in steps of 15 / 5.

**Horizontal motion in a jump** (`0x00492F48`–`0x00493354`). Running is root motion, so at take-off the physics velocity is ~0 horizontally (measured for every jump kind). In the air, a held direction key adds 156.8 × 0.033 / dt per frame to that local axis, rescaled by dt × 30.303 × 1.3 × 0.16 (the 0.033 and 30.303 cancel): **32.6 ft/s²** per axis. Jump kinds 9 and 10 add the same push forward without a key, so a running jump holding forward accelerates at 65.2 ft/s². Once the horizontal travel since take-off passes the kind's limit (5.2 ft; ×1.5 for kind 9, ×2.5 = 13 ft for kind 10) the push stops and the drag rises to 0.05. Measured peak horizontal speeds (~32 ft/s running, ~17 ft/s sideways) match. Observed kinds: 8 standing, 10 / 11 / 12 for the moving jumps (11 sideways).

**Body turn rate** (`0x004918E0`, end of the physics update): the transform yaw (`+0x34`, degrees) turns towards the view heading by at most **270°/s** when the physics velocity is zero and **80°/s** otherwise (airborne). The head may look up to ±110° off the body, the pitch is clamped to ±90°. The classic camera hangs off this body yaw (§10.1), so fast mouse turns are rate-limited on screen.

**Keyboard view rates** (measured by sampling the transform while only the keys were used): arrows turn the heading at a constant **200°/s**; Numpad 9/7 change the pitch (transform `+0x38`, degrees) at **150°/s**, clamped to **±80°**; Numpad 5 sets it to 0 at once. The code that applies them was not located (the 200 / 150 constants found are used elsewhere, e.g. 150 is a projectile speed).

Implemented in `shared/src/constants.ts` / `movement/character.ts`: gravity, impulse, rising drag, hold lift, in-air horizontal physics (running jump = forward held at take-off, limit 13 ft; other jumps 5.2 ft). The jump state (kind, horizontal velocity, distance travelled) is part of the reconciled snapshot header. Not modelled: the vertical travel limit of kind 8 (changes the standing jump by < 0.15 ft). The body turn rate drives the local avatar and the classic camera (`client/src/entities/local_player.ts`).

### 13.1 Take-off, jump kinds and drag (decompiled, 2026-10-17; corrects §13)

- **Jump selector** (`0x0042BD40`, from `0x0042C500` when grounded, jump held and C not held): shield held → RAM_SHOULDER; else, unless the controller is locked (flag `0x2000`, `0x0042A8D0`), the state from the keys: right → STANDING_JUMP_R (12), else left → STANDING_JUMP_L (11), else forward → RUNNING_JUMP_F (10) or with Shift STANDING_JUMP_F (9), back → STANDING_JUMP_B (20), none → STANDING_JUMP_V (8). The "jump kind" of §13 is this state.
- **Take-off on a clip event.** The physics flag `0x8000` is set only by the clip event handler `0x00457CA0` (event table `0x004E0F50`: SWING, RECOVERY, JUMP, SPELL, SWAP, THROW…), on each jump clip's `JUMP LEAVEGROUND` event: PC01 / PC02 frame 10, PC03 frame 6, PC04 / PC05 / PC06 frame 12 (the state → clip table `0x004EC820` maps 8–12 / 20 to PC01–PC05 / PC06). Until then the jump state stands (`0x00491E20` bounds the ground velocity by the clip's root speed, ~0). The jump states hold until their clip ends (34-frame header); a click on the ground in one of them gives JUMP_ATTACK.
- **Impulse** Δv = 50.45 ft/s on top of the grounded −5 ft/s (45.45 ft/s, frame-rate independent).
- **Push per kind** (`0x00492B70`): held keys 32.6 ft/s² each on the body axes (back wins over forward, left over right); kinds 9 / 10 add one forward push without a key, kind 20 (and 38, climbing) one backward.
- **Limits**: horizontal 5.2 ft (×1.5 kind 9, ×2.5 kind 10) on hypot(Σ|dx|, Σ|dz|); vertical 5.2 ft on Σ|dy| (×2.3 kind 8 only). Past the vertical one the acceleration is reset to gravity (no hold lift) and the rising drag becomes 0.1.
- **Drag** (`0x004923E0`): per axis v −= k · v · |v₃| · dt, where |v₃| is the **whole 3-D speed** of the previous frame (not the axis' own). Vertical k 0.01 while rising (0 falling, 0.1 past the limit), horizontal 0.02 (0.05 past the limit). Velocities live in the body frame (`+0x84 / +0x8C`), rotated by the body yaw each frame.
- **Landing**: grounded with jump still held in a finished V / F / RUNNING jump → LAND_SOFT (17), PD03 played to 30 % of its 34-frame header (`0x00429BF0`), standing; then the next jump's stand.

Simulated at 30 fps these rules give the standing jump 13.1 ft / 1.17 s (the measured §13 values) and: running jump 9.5 ft high, 0.93 s, **19.7 ft** (16.2 Shift + forward, 9.9 sideways, 14.6 back, 12.0 a running jump with the keys released). With the 6-frame stand a running jump covers ~17.7 ft/s, about the run's 17.3 ft/s: jumping is not a faster way to travel. The 2026-10-11 implementation (no stand, per-axis drag, no vertical limit) jumped 13.9 ft high and 27 ft (21.6 ft/s).

Implemented (`jumpKind`, `jumpTakeoffTicks`, `jumpLimits`, `jumpAutoPush`, `landSoftTicks`, the stand as timed action 24 and the landing as 25, the vertical travel in the snapshot header bytes 34–35; at 20 Hz within 4 % of the 30 fps figures). Not modelled: the body-frame velocity (ours stays in world axes, so turning in the air does not swing the jump round), and the jump state outlasting an early landing.

### 13.2 Ledge grab and mounts (decompiled, 2026-10-18)

ASM ids (name table `0x4EA6F0`): CLIMB_UP 0x22 … HANG_TO_CLIMB 0x29, HANG 0x3B, CLIMB_TO_HANG 0x3C, HANG_MOUNT 0x3D, LOW_MOUNT 0x3E, HIGH_MOUNT 0x3F. Drake binds PM04_cl (hang), PF03_mt_hng, PF01_mt_lo, PF02_mt_hi. Key byte `0x0058B9DC` is jump (with C `0x0058B9DD` it drives the debug fly up / down in `0x004923E0`).

- **Per frame** the physics update (`0x004920A0`) calls `0x004916A0`. Outside the mount states and not attached (physics flag `0x40`), it first tries a climbable wall (`0x00490E80`, flags `0x140`, not done here), then the **ledge test** `0x004912F0`; if it passes, the state is not JUMP_ATTACK (0x5A) and `0x00491540` (room above, used by the climb code too) is clear, it sets flags `0x140` and enters LOW_MOUNT (flag `0x800`, which the test always sets) else HIGH_MOUNT, through SetNextState directly.
- **Ledge test** `0x004912F0`: fails while jump is held; when grounded needs `+0x144 − y ≤ 2` (`+0x144` not decoded); needs a wall contact this frame (flag `0x80`) with normal `+0xB0..+0xB8`, |n.y| ≤ 0.1, and n·facing ≤ −0.8 (facing = transform `+0x18 / +0x20`). P = feet + (height − 1.5) up (height `+0x68`, 6.0 ft by default; 3 when crouched, flag `0x20000`) + 2.21 ft along the facing; P must lie in an open BSP leaf (`0x004395F0` cell, `0x004387C0` point in solid). Q = feet + 1.5 ft up; the BSP line trace `0x00437EB0` from P to Q, applied by `0x00438760` (moves Q onto the plane hit, 0.01 off it), repeated while it hits (≤ 6 times), must lift Q more than 1.5 ft (Q.y > feet + 3 ft). Target `+0x14C / +0x150 / +0x154` = (P.x, Q.y − 1.5 − 0.001, P.z).
- **During the mount** (`0x004920A0`): x, z = the target at once; y rises by the clip's vertical root speed (`0x00491E20`, controller vtable `+0x50`) clamped to the target's; when within 0.1 ft of it, or when the clip ends, the position is set to the target and the state becomes STANDING (7).
- **Clips** (controller `0x00429BF0`, `0x004295D0(clip, start, end fraction of header +0x14, rate, blend, loop)`): HANG 0–20 % of PM04 (20), HANG_MOUNT 0–50 % of PF03 (170-frame header), LOW_MOUNT the whole PF01 (27), HIGH_MOUNT 0–45 % of PF02 (170). PF01's root starts 2.15 ft back and 4.5 ft below where it ends: the clip is authored about the target.
- **Hanging** (`0x0042C310`, the selector while attached): with flag `0x100` (at a top), forward gives HANG then HANG_MOUNT (once `0x00491540` is clear), `0x800 / 0x1000` give LOW_MOUNT; otherwise forward / back climb (0x22 / 0x23 / 0x29), left / right 0x24 / 0x25.

Implemented: the jump-time ledge grab (`ledgeAhead` in `shared/src/movement/character.ts`, timed action 26, ANIM.MOUNT_LOW). Not done: climbable walls, hanging and the hang / high mounts, the grounded case.

---

## 14. Animation State Machine, Clip Rate and Melee Timing (x32dbg, 2026-10-11)

**Animation controller.** The character's `+0x48` object (vtable `0x004DEDC8`) holds the current ASM state id (`+0x14`), the next state (`+0x18`), the clip (`+0x1C`), the clip time in frames (`+0x24`), the clip start / end (`+0x30` / `+0x34`) and a rate (`+0x28`, 1.0 with the starting axe).

**State ids.** The table at `0x004EA6F0` is (id, name) pairs: 113 named states, e.g. 1 RUNNING, 2 WALKING, 7 STANDING, 8 STANDING_JUMP_V, 9 STANDING_JUMP_F, 10 RUNNING_JUMP_F, 11/12 STANDING_JUMP_L/R, 20 STANDING_JUMP_B, 23 CHOP_LOW, 24 SWING_LEVEL, 25 SWING_OVERHEAD, 29 BLOCK, 68 COMBAT_STANDING, 89 THRUST, 90 JUMP_ATTACK, 91 IMPACT_MEDIUM. Ids 0, 18, 31–33, 87, 88 and 102–110 have no name (engine-internal states: 87/88 appear with side attacks, 103/104 are combo steps). The physics "jump kind" of §13 is this state id.

**Clip playback rate.** Measured over 49 clip segments of the running game: **33.6 frames/s** = 1000/30 × the level-1 speed multiplier (1.009, §7.2). Clips therefore play 10/9 faster than their 30 fps authoring rate (this settles UNK-012's playback question), and every root-motion speed of §11 is × 10/9 (run 17.3 ft/s).

**Melee timing.** Attack clips carry `SWING`, `IMPACT` and `RECOVERY` events (e.g. PN02 swing level 7 / 8 / 13 of 23 frames; PN01 chop low 14 / 16 / 19; PN03 overhead 10 / 12 / 16; PN16 5 / 10 / 17; PN17 11 / 12 / 23; PN09 / PN10 side swings 5 / 8 / 14 and 8 / 9 / 14; PN05 jump attack 17 / 20 / 24). In play, the next combo swing starts about 3 frames after RECOVERY.

**Combo chain** (`0x0042CA20`): a click after 10 % of the current swing queues the next one: SWING_LEVEL (24) → CHOP_LOW (23) → SWING_OVERHEAD (25) → 103 → 104, then the chain ends (a second chain 105 → 106 → … exists). By clip length, 103 and 104 play PN16_1_chn_atk_b and PN17_1_pwr_atk (models.ctx "COMBO 4" / "COMBO 5"). The 1.25 attack-mode scale of §8.2 is set per difficulty (`0x0044CDD0`), not per combo step.

Implemented: `attackTiming()` in `shared/src/game/combat.ts` (hit window ends on the IMPACT frame at 1000/30 fps, scaled by weapon Speed), a five-step combo with equal attack mode, the ×10/9 speeds and roll timings, and original avatars playing every clip at 1000/30 frames per second. **Attack keys** (measured, one key per capture): a plain click starts the five-swing combo; W + click while running and Space + click give ASM_JUMP_ATTACK (PN05, the leaping attack); A / D + click give the side swings (states 87 / 88, which use the two adjacent clip objects PN09 "Swing Left" / PN10 "Swing right"); C + click leaves the crouch and starts the normal combo (no separate crouch attack). The Readme's "E + LMB overhand" does not match the engine's behaviour; THRUST (89) was not reproduced on purpose and is left unbound.


### 14.0 Swing length and the combo queue (decompiled, 2026-10-17; corrects §14)

- **Swings hold to their clip's end.** The controller (`0x00429BF0`) keeps every swing state (23–25, 103–107, THRUST, JUMP_ATTACK) until flag 4, i.e. until the clip time passes header `+0x14` − 1: PN25 17, PN02 24, PN15 22, PN16 27, PN17 30 frames (PN05 42, PP02 24) — 0 to 11 frames past RECOVERY, not the "3 frames after RECOVERY" read from the first capture. The RECOVERY handler (`0x00457A60`) only sets flag `0x1000` (no jump attack from then on) and plays the swing sound.
- **Queue.** The combo routine (`0x0042CA20`) runs every frame the attack button is held (key byte `0x0058B9E4` bit 2), from the selectors; once (time − start) / (end − start) ≥ 0.1 (`0x004DEDB4`) it queues the next step (24 → 23 → 25 → 103 → 104, none after 104) in `0x0053BF78`, which the controller starts when the swing ends. A wall within 5 ft turns the request into THRUST and clears the queue; the shield held clears it. There is no time window after a swing: a request after it ended starts the combo again at step 1. Holding the button therefore chains the five swings and starts over, and while moving repeats the leap / side swings.
- **Weapon rate.** For the swing states the controller rate is the stats' speed multiplier × (1 + 1.5 × (item `+0x94` − 1)) — the weapon's Speed, taken ×1.5 off 1 (`0x004DE418` = 1.5); IMPACT_MEDIUM plays at 1.8; RAM_SHOULDER at the multiplier alone.

Implemented: `attackTiming()` ends each player swing at its clip's `+0x14` − 1, `weaponClipRate`, `COMBO_QUEUE_FRACTION` (server queue from 10 % of a combo swing; the client queues a tick later so it never runs ahead of the server), the 0.3 s chain window dropped, and the client repeating the request every tick while the attack button is held.

### 14.1 Hits, reach and arc (2026-10-12)

Captured with a software breakpoint on `Stats_TakeDamage` (`0x0044CBA0`, fires only on damage; the stats component holds its owner at `+0x04` and HP / max HP at `+0x08` / `+0x0C`), reading attacker and victim poses at each hit. The transform yaw (`+0x34`, degrees) equals `atan2(dx, dz)` of the facing direction.

- **Damage frame.** Hits land on the clip's IMPACT event: frame ≈ 13.6 in SWING_LEVEL, ≈ 8.0 in CHOP_LOW, ≈ 8.5 in SWING_OVERHEAD, ≈ 21 in JUMP_ATTACK. With the starting one-handed weapon the combo states therefore play models.ctx's "COMBO" clips in file order (PN25 IMPACT 13, PN02 IMPACT 8, PN15 IMPACT 9, then PN16, PN17), not the clips bound to those state names.
- **Player reach / arc.** 18 hits: centre-to-centre distance 3.9–4.7 ft (one at 5.95 ft), angle to the target up to ~40° off the heading (most within 10°). Lower bounds only.
- **Skeleton reach.** 7 hits on the player: 4.0–5.25 ft centre to centre.
- **Crouching.** Clicks are ignored while C is held.

Implemented: `PLAYER_REACH` 6 ft and `PLAYER_ARC_DEG` 90 (±45°), skeleton reach 5.25 ft (both centre to centre, `inMeleeArc` adds the 0.4 m target radius), the combo clip order above, and no attacks while ducking. Second capture (73 swings recorded at their IMPACT frame from the player's ASM state, 16 damage events): a head-on miss at 7.6 ft (0.8° off) and a miss at 44.5° (5.3 ft), against hits up to 5.95 ft and ~40°, bracket the player's reach at **6–7.6 ft** and the arc at **±40–45°**; the implemented 6 ft / ±45° lie inside. Misses at 4–4.3 ft head-on are shield blocks (a blocked hit never reaches `Stats_TakeDamage`). Breakable props do not take damage through `Stats_TakeDamage` either (no event when they were struck).

---

## 15. Creature Behaviour in Combat (memory sampling, 2026-10-12)

Two skeletons sampled at ~3 Hz for 150 s while the player fought them (creature found through the `Stats_TakeDamage` breakpoint, then only memory reads: transform pose and animation-controller state).

- **Approach:** RUNNING beyond ~14 ft; inside it WALKING or COMBAT_STANDING (guard), facing the player within ~±30°.
- **Lunge:** almost every attack starts with **ASM_HOP_F** (forward hop, PC07, 5.65 ft) from 2–17 ft (typically 4–10 ft), followed at once by a swing.
- **Swings:** SWING_OVERHEAD most often, then SWING_LEVEL, CHOP_LOW, occasionally THRUST and JUMP_ATTACK.
- **Not seen:** BLOCK, RETREAT or side steps by the creature in this sample (short block states may fall between samples).
- **Pursuit:** a skeleton kept chasing past 75 m; creatures went idle after the player died.
- **Reactions:** IMPACT_SEVERE, IMPACT_LEFT_ALT_01; deaths HIT_POINTS_DEPLETED_ALT_01 / _ALT_03.

The AI's own maneuver tables (`0x004EA268`: RANGED / RUNNING_JUMP / JUMP / MELEE and NONE … THROW_WEAPON, MANEUVER_LR / BACK) are not decoded yet.

Implemented in the server AI: root-motion run/walk speeds, guard walk inside 14 ft, forward-hop lunge from ≤ 9 ft (PC07 timing) leading straight into a swing chosen 50 / 30 / 20 % among SWING_OVERHEAD / SWING_LEVEL / CHOP_LOW with each clip's event timing, leash 80 m.


### 15.1 Attack rhythm, guard and jab (second capture, 2026-10-12)

One skeleton sampled at ~9 Hz (only its animation-controller state, plus the distance every sixth sample) for ~50 s of fighting, re-acquired through `Stats_TakeDamage` after each death:

- **Chains then guard.** 1 swing (most often), sometimes 2, rarely 3 back to back, then **COMBAT_STANDING for 0.4–1.9 s** (~1.2 s on average) before the next action. Player hits that landed during that guard came from the side or behind (IMPACT_RIGHT / IMPACT_BACK), consistent with the shield covering the front.
- **Close jab.** At ~4 ft with the player standing still: short THRUST jabs alternating with ~1.4 s of guard; occasionally RAM_SHOULDER (shield bash) followed by a jab.
- **From range.** HOP_F then one or two swings, as in §15.
- **Step back.** The user also sees skeletons step back about two steps with the shield up and come in again (not caught in this sample).

Implemented: chains of 1/2/3 swings (55/35/10 %); guard of 0.4–1.9 s with the shield up that stops 50 % of frontal hits (within the original ±81° block cone); a 25 % chance to step back ~0.8 s in guard after a chain; the jab (THRUST, PP02 timing) preferred within 5 ft. Not yet: RAM_SHOULDER (needs knock-back).

### 15.2 Skeleton AI decisions logged with Frida (2026-10-12)

Frida (non-pausing `Interceptor` hooks in a standalone Python runner) logged every change of a creature's **requested** ASM state through `SetNextState` (`0x004C8900`: `ctl+0x18 = arg`, anim-controller vtable `+0x44`; the AI calls it every frame, so only changes were kept) with the call stack, the distance and bearing to the player and the player's state; also each creature's upper-body layer (`ctl+0x60/+0x64`) and every `Stats_TakeDamage` call. Creature controllers are updated by `0x00429810` (called from `0x00427575`); the player's by `0x00429BF0` (input → state). Hardware watchpoints set from Frida (`Thread.setHardwareWatchpoint` + an exception handler that returns `true`) catch writers without pausing the game. Two runs, ~12 minutes of fighting 6+ skeletons:

| Decision | Logged condition |
|---|---|
| Run / walk | RUNNING beyond ~12 ft; COMBAT_STANDING ↔ WALKING within 8–12 ft |
| Lunge | WALKING/RUNNING → HOP_F at 7.5–8.0 ft; the next request comes 0.9–1.06 s later: a swing (75 %) or the stance (25 %) |
| Leaping strike | WALKING → JUMP_ATTACK at 7.2–7.9 ft instead of the hop (~15 % of approaches) |
| Jab | COMBAT_STANDING → THRUST at 4.0–4.7 ft, repeated once per stance (~1.1 s or ~1.3 s apart) |
| Step back | COMBAT_STANDING → RETREAT at 4.6–8 ft; every retreat ended at **8.0–8.2 ft** (distance-driven, not timed) |
| Chains | 1 swing (74 %) or 2 (26 %), never 3; the second is always the next in the cycle CHOP_LOW → SWING_LEVEL → SWING_OVERHEAD → CHOP_LOW. Openers after a hop: SWING_LEVEL 14, CHOP_LOW 12, SWING_OVERHEAD 6 |
| Stance | after any action COMBAT_STANDING for 0.50 s; then either the next action, or (55 %) the shield layer goes to state 5 for **0.82 s** and the next action starts as it drops (stance 1.32 s) |
| Shield | 26 raises, all in that stance, none while the player swung: the skeleton's block is not a reaction |
| Shield bash | COMBAT_STANDING → RAM_SHOULDER at 5.7 ft (once): the player went to IMPACT_MEDIUM without damage; the next hit 0.2 s later put him in IMPACT_SEVERE |

Player hits on creatures always produced an IMPACT_* request unless they killed (25 → 10 HP: IMPACT_LEFT). Creature hits on the player (~10 HP of ~70) always produced a directional IMPACT_* on the player; IMPACT_SEVERE (knock-down) appeared twice: after the shield bash, and once on a 10/25 HP hit; IMPACT_MEDIUM once on a 14/15 HP hit while already in IMPACT_SEVERE.

**Third capture (knock-down confirmed live).** Hooking the HP-loss routine and the controller flag setter: 10.1 damage at 25.1 HP with random 0.736 → v = 0.771 → flag `0x4000000` → IMPACT_SEVERE (Drake knocked down); v = 0.845 and 1.145 → physics flag `0x80000` → IMPACT_MEDIUM; v ≤ 0.57 → directional impacts. The damage source's `+0x34` was 145 on every skeleton hit (150 still unseen). Stance decisions within 8 ft over the three logs: THRUST 34 (4.0–4.7 ft), direct swings 29 (SWING_OVERHEAD 12, SWING_LEVEL 9, CHOP_LOW 8 at 5.0–7.0 ft, no hop), RETREAT 11, HOP_F 12 (7.1+ ft), JUMP_ATTACK 4, RAM_SHOULDER 2; median 2.0 s between a skeleton's attacks. Implemented: direct swings at 4.8–7 ft, retreat 12 %, bash 2 %, leap 12 %; a simulated skeleton facing a still player now attacks every 1.9 s (median). The earlier "hit during a bash stun knocks down" rule was dropped (the rule above explains that sample).

**Bursts (fourth capture, with Drake's shield layer and Stats_TryBlockWithShield hooked).** Over the four logs a skeleton's attacks fall in bursts (starts ≤ 1.3 s apart) of 1 (73 %), 2 (23 %), 3 (3 %) and rarely 4; direct chains are SWING_LEVEL → SWING_OVERHEAD 24, CHOP_LOW → SWING_LEVEL 9, SWING_OVERHEAD → CHOP_LOW 9 / → SWING_LEVEL 8, and RAM_SHOULDER → THRUST 4 of 4. The second chained swing used to start only within ~4.7 ft, so after the direct swings from 5–7 ft chains almost never happened; they now go on within 7 ft (a simulated skeleton against a blocking player: 61 / 27 / 6 / 6 %). Skeletons hit from the front sometimes play IMPACT_FRONT_TWO_STEPS_BACK (PI31) — not reproduced yet.

**Hit reactions (implemented 2026-10-12).** Every landed, non-lethal hit on a grounded character interrupts it: creatures play the directional impact (their swing, hop or retreat is cancelled — logged CHOP_LOW → IMPACT_LEFT, SWING_OVERHEAD → IMPACT_BACK), the player rolls the rule of §8.4 (impact / stun / knock-down). The reactions are timed movement actions in the shared step (16 impact 0.55 s, 17 stun 0.9 s, 18 knock-down 1.44 s following PI02's root motion), so prediction reconciles them. The skeleton's shield bash (RAM_SHOULDER, PL01: charges ~6 ft) is taken from the stance at ≤ 6 ft in 4 % of the decisions and stuns without damage; a hit landing during that stun knocks down (as logged once).

Implemented in the server AI (`world_zone.ts`, constants in `combat.ts`): the distance bands, the 1.0 s hop with 25 % no-swing, the leaping strike, the jab at ≤ 4.8 ft, retreat until 8 ft (30 %), chains 1/2 with the cycle order, the 0.5 s stance with a 55 % 0.82 s shield that blocks frontal hits, and no reactive block (kept as an optional, non-original feature: `WorldZoneOptions.reactiveBlock`, off by default, using the archetype's `blockChance` / `blockTicks` / `blockCooldown`).


### 14.1b Side swings, air swing, wall jab and the combo table (Frida, 2026-10-12)

Logged Drake's ASM states with pose and the controller's second channel:

- **Side swings** play on the upper-body layer (layer state 2) while the legs keep the held movement (main states 87 / 88 are the legs, not the swing). *Corrected 2026-10-13:* the first reading (side swings re-trigger 0.3 s in and alternate) misread main-state changes as swings. The player controller (`0x00429BF0`) starts a layer swing only when the layer is free, and layer state 2 always plays the clip of ASM state 23, SWING_LEVEL (PN02), at speed 1 (not scaled by the weapon). The layer update (`0x00428DD0`) raises the layer weight at 12/s while the clip plays and lowers it at 12/s after it ends; at 0 the layer clears. Logged with Frida (10 ms sampling, clicks every ~90 ms): each layer swing active 742–748 ms, layer free ~80 ms later, the next swing starts on the next click after that — one side swing every ~0.91 s, the same clip for either side; clicks during a swing are dropped.
- **Click in the air**: the main state stays the jump / fall while SWING_LEVEL plays on the upper-body layer; the jump's physics is untouched.
- **Combo routine `0x0042CA20`** (decoded): per current state, a click queues the next step — none → 24, 24 → 23, 23 → 25, 25 → 103, 103 → 104, 104 → end; a separate chain 105 → 106 → 107 (models.ctx COMBO 6–8: PN21_1_vt, PN17, PN16) is never requested with the sword (another weapon class). The queued step needs the current clip ≥ 10 % played. Then `0x00437BE0(position + 5.5 ft up, 5 ft, owner)` tests level geometry ahead: if hit, the request becomes **ASM_THRUST (89)** and the queue is cleared — the jab a plain click plays against a wall.

Implemented: side and air swings as layered swings (no rooting; replicated as the locomotion anim plus entity flags bits 1–3) holding the layer for the whole PN02 clip plus the fade (0.83 s) and dropping clicks meanwhile, the air swing, and the wall jab (shared `wallAhead` ray, 5 ft at 5.5 ft height). The earlier re-trigger-and-alternate behaviour is kept as the non-original feature `sideSwingRetrigger`.

The second chain (105–107, COMBO 6–8) uses melee clips (PN21 "vertical", PN17, PN16), so it presumably belongs to another melee weapon class. The community item list (Might and Magic wiki, "List of Crusaders items") gives the PC weapon classes: axes, clubs, dasher weapons (Chl'tk, Dasher Hand Bow — ranged, Dasher Weapon), halberds, hammers, maces, morning stars, pick axes and swords; the Boomer Axe is ranged too. Captured with a War Hammer and then a Halberd equipped (combo routine hooked): both played the same five-step chain 24 → 23 → 25 → 103 → 104 with the sword's clip lengths and timing, and 105 was never requested — the second chain is not tied to these classes (possibly a dasher weapon, or unused content).

**Shield rush.** The game's Readme binds Space + RMB to a shield rush; models.ctx binds ASM_RAM_SHOULDER to PL01 (24 frames, the root charges 6.5 ft by frame 11 and settles at 5.18 ft). Implemented as a timed action of the shared step (shield + jump instead of a jump). Logged live (Frida, a dozen rushes into a skeleton): the creature requests IMPACT_BACK at once and IMPACT_SEVERE ~0.5 s later (knocked down, 1.3–1.9 s) and loses no HP, while Drake loses 1 HP per tick of contact (2–5 per rush, HP-loss routine with damage 1.0); implemented so (Drake's loss stops at 1 HP).

**Spells (first capture).** Casting Torch Light: ASM_SPELL_CONJURE for 1.54 s, then ASM_SPELL_TORCH_LIGHT; mana (stats `+0x228` current / `+0x22C` max, ints; level at `+0x230`, attributes M/I/E/S at `+0x254..+0x260`, XP `+0x268`) went 30 → 29 (S0 level 1 costs 1) and back to 30 ~3.9 s later; recasting while the light was active did not spend mana. Implemented: spell books teach their spell (another book of a known spell raises it a level — confirmed by the user), R conjures the selected spell for 1.54 s with the caster rooted, the mana is spent when it takes effect, mana regenerates one point per 3.9 s (provisional), Torch Light lights a radius of 15 / 30 / 50 ft for 80 / 120 / 180 s and is replicated in the entity flags.

### 14.2 Moving with the shield up (2026-10-12)

Sampled the player's ASM state and pose while holding the shield (right mouse button) and moving: forward → ASM_WALKING at 5.65 ft/s (the careful-walk speed), backward → ASM_RETREAT at 4.34 ft/s, sideways and diagonals → repeated ASM_HOP_L / ASM_HOP_R side hops with short stands in between, ~6–8 ft/s on average (for the player those states play PB04 / PB05, not PC09 / PC10: see §11.1). Standing still with the shield up plays ASM_BLOCK (PE07).

Implemented in the shared movement step and `movementAnim()`: shield + forward / back use the careful walk / retreat speeds and clips; shield + a sideways key (a diagonal too: the sideways key wins, §11.1) performs discrete side hops following PB04 / PB05's root motion (4.91 ft left in 21 frames, 4.50 ft right in 20, with a small counter-step first and a forward bob), then a 0.2 s stand with the shield up — repeated while the key is held. The hop and stand are timed movement actions (ids 5–7 next to the rolls), carried in the reconciled snapshot like a roll.


### 14.3 Root-motion profiles for timed actions (2026-10-12)

Side hops and rolls move by their clip's root motion, which is far from uniform (e.g. PC09: ~0.13 ft per frame for 4 frames, ~1 ft per frame over frames 4–10, settling by frame 15, still to frame 20; PE05 roll right covers 6 ft in its first 6 frames). The shared movement step now samples each clip's per-frame root displacement (`SHIELD_HOP_*_CURVE`, `ROLL_CURVES`, extracted from Drake's clips) at 1000/30 frames per second, tick by tick, instead of moving at the average speed.

Creatures too (2026-10-12): the skeleton's forward hop follows PC07 (still for 4 frames, 5.74 ft by frame 12, then standing until the 1.0 s lunge ends), the leaping strike PN05 and the shield bash PL01 (6.54 ft by frame 11, settling to 5.18 ft) — they slid at a constant speed before. Death clips (models.ctx `ASM_HIT_POINTS_DEPLETED*`) keep their root motion in the converted clips (PI03 ends 7.5 ft to the side), so the body falls where the clip takes it; a death also ends any timed action.


### 14.4 Standing idle and shield stance (2026-10-12)

Standing still — with or without the shield held — the player's ASM_STANDING state plays one and the same clip whose header length is 170 frames (`+0x14`). Drake's relaxed idle PA16 has 90; the 170-frame idle matching the stance is PA21_id_br ("idle combat", ASM_COMBAT_STANDING), the shield-forward combat stance. The client uses PA21 for Drake's idle.

**Shield layer.** The animation controller has a second channel (`+0x48` clip, `+0x4C` time, `+0x58` end, `+0x60`/`+0x64` layer state, `+0x6C` weight). Holding the shield sets it to state 5 (one of the shield-raised states `Stats_TryBlockWithShield` checks, §8.5) with weight 1.0, playing PE07_blk ("Shield Block", 27-frame header) once and holding its last frame, while the main channel keeps its clip (the idle continues, uninterrupted). Releasing the shield clears the channel. Implemented: original avatars play PE07 on the upper body only (Bip01 Spine and below) and switch the main clip to a legs-only version while the shield is up, without restarting it; the shield state is replicated in the entity flags (bit 0) for players blocking and creatures guarding.

**Attacks move the character (2026-10-12).** The root bone of Drake's attack clips ends away from its start in four of them: combo step 1 PN25 (+3.85 ft forward), step 3 PN15 (the spin, +3.43 ft), step 5 PN17 (1.6 ft back during the wind-up, then +2.16 ft) and the jump attack PN05 (run / jump + click, +6.26 ft); the other swings sway and return to the start (net zero). Implemented as timed movement actions (ids 8–11) in the shared movement step that follow each clip's forward root curve tick by tick; the client sends the attack motion in the input bits of the swing's first step, so prediction and server agree.

Also observed: the third combo step (SWING_OVERHEAD) plays backwards after its impact (clip time 10.8 → ~8 within the same state) — a weapon recoil, not reproduced yet.

### 15.3 The melee brain, decompiled (2026-10-13; supersedes the capture-based rules of §15–15.2)

**Behaviour templates.** Creature actions are small scripts built in code at start-up (`0x0047EC50` calls 19 builders, `0x0047ED70`…`0x0047FD20`; table at `0x0058DB20`, 0x24 bytes each: id, argument count, track count, three per-difficulty times — all equal —, argument kinds, tracks of 0x48-byte steps, exit conditions). `0x0047FED0(brain, template, n, states…)` instantiates one with ASM states as arguments; `0x00480790` requests each step's state (flag 4 = upper-body layer, 0x10 = aim at the target), `0x004800C0` advances it and **aborts it when the current state carries flag 0x800** (the impacts and deaths), `0x00480D50` returns the template's time. Ones used in melee: 4 RETREAT, 5 HOP_B, 6/7/8 one/two/three attacks (500 / 700 / 900 ms), 14/15/16 the same opened by ASM_HOP_F — track 0 the hop then the remaining attacks, track 1 the first attack **on the upper body from 20 % of the hop** (exit condition 3, 0.2) —, 17 COMBAT_STANDING + ASM_BLOCK on the upper body.

**Brain** (`0x00408C40` → `0x00409520`, sub-state at `+0xB`). Distance bands (`0x0040E6B0`, 3-D, feet): ≤ 8, ≤ 12, ≤ 20, beyond. Engage distance (`0x0040EA30`): 8 ft; types 124–130 and 161 (dwarves) 4.2 ft; 132–134 and 148 5 ft.
- **Decide** (`0x004096A0`): beyond 12 ft → run in (`0x0040A290`); else beyond the engage distance and the target not attacking → walk in (band 0/1: walking, upper layer ASM_BLOCK if a shield is equipped; running if the target faces more than 90° away, `0x0040E2D0`) until inside it; else attack — or, if the previous pick was an attack, the post-attack state. "Attacking" = the target's main or upper state has flag 0x20 (`0x0040E350`: swings, THRUST, JUMP_ATTACK, RAM_SHOULDER, casting; the combo states 103 / 104 have no flags). Spell choices (casters) precede these.
- **Attack** (`0x00409920` → `0x004083F0`): beyond 7 ft with a HOP_F clip → templates 14–16; under 5 ft → THRUST; otherwise 6–8 standing. `floor(rand × 12)` picks (in the order of the call): O, L, V / V-O, L-O, V-V, O-V, O-L / L-V-O, V-V-O, O-L-L, O-L-V (O overhead, V level, L low); creatures scaled above 1.5 add 3 to the standing roll and never hop. Against a target holding its shield (state flag 0x80, `0x0040E3C0`) `floor(rand × 1000) > 800` takes a special (`0x004087A0`): with a shield RAM_SHOULDER + THRUST (2 in 3) or JUMP_ATTACK, without one JUMP_ATTACK (Necros: RAM_SHOULDER). Then the template's time standing (state 10, `0x00409FF0`).
- **After an attack, shielded** (`0x00409C30`): target within 8 ft and neither attacking nor blocking → decide at once (attack again); else template 17, held until the block clip ends or a blow is stopped (event 0x14 → flag 0x20), then decide.
- **After an attack, no shield** (`0x0040A500`, ≤ 1.5 s): HOP_B if the target attacks within 8 ft and there is room, RETREAT while within 8 ft, combat stance at 8–12 ft; decide early beyond 12 ft or when the target turns away.
- **Noticing** (`0x0040D910`, hostile): the player within 100 ft and less than 60° off the creature's heading, or within 20 ft, and a clear ray (`0x00406AF0`). Creature headings come from each `.cap` record's transform (third row of the 3×3 rotation, just before the position).

**Impacts.** Every unblocked blow sets controller flag 0x8000 on the victim (`0x0044D290`) and pushes it (`+0xA4` impulse, the swing direction × −10, × −4 when blocked; `0x00440A90`, applied by the physics update `0x00492B70`). A creature's controller (`0x00426C70`) answers flag 0x8000 at once with `0x004273F0`, from the hit vector: from the front `floor(rand × 5)` → IMPACT_FRONT (17 frames), FRONT_ALT_01 (pi32, 60, 1.7 ft back and in again), RIGHT_FRONT (pi30, 52), LOW_FRONT (pi34, 48, 4.5 ft back), FRONT_TWO_STEPS_BACK (pi31, 52, 5.1 ft back); from the left IMPACT_LEFT or (1 in 2) LEFT_ALT_01 (pi33, 42, thrown 3.8 ft aside); from the right or behind the 17-frame impact. Only Necros (type 150) ignores the flag. The impact aborts the behaviour template, so the brain decides again as soon as the impact ends (no pause).

**Attack reach.** `.data 0x004EA200` lists per attack state an angle range and a reach in feet: SWING_OVERHEAD −25…25° 7.5, SWING_LEVEL −35…30° 7.5, CHOP_LOW −15…40° 6.0, THRUST −45…70° 6.0. The aim lookup that would read it (`0x004619E0`) is a stub returning 0 (hits come from the blade's sweep), but it is the only reach data in the executable and matches the captured bracket (player 6–7.6 ft).

Implemented (`shared/src/game/combat.ts` MOB_* and `chooseMobSequence` / `chooseMobSpecial`, the brain in `world_zone.ts`): the bands, engage distances, run / shielded walk-in, the attack choice and sequences with the hop's upper-body swing (replicated in entity flags bits 1–3 for creatures), the pauses, both post-attack variants (HOP_B played as the retreat), the special against a raised shield, noticing with the cone and a level ray, placement headings, a 270°/s body turn, the long impacts with their root motion (`IMPACT_VARIANTS`, timed actions 19–23, the variant sent in the combat event), and reach 7.5 / 6 ft per attack (Drake 7.5 ft). Not implemented: creature scale, spells. The capture-based rules they replace (stance 0.5 s, 55 % shield, 12 % retreat for shielded creatures, chains 74 / 26 %, 25 % hops without a swing, 2 % bash, 12 % leap) are dropped; the retreats logged from skeletons are not explained by the shielded post-attack code.

### 15.4 The shove of a blow (decompiled, 2026-10-14)

`0x0044D290` gives the victim an impulse (`0x00440A90`: physics `+0xA4..+0xAC`, flag `0x2000`) of the attacker's **blade-tip sweep** × −10 (× −4 when the shield stops the blow): physics vtable slot `+0xAC` (`0x0048CDA0`) returns the normalised previous minus current tip position — the same `+0x104…+0x130` blade points that feed the sword trail (`0x0048C7B0`). The physics update spends it in one frame: `0x00492B70` (skipped while the controller has flag `0x80000`, or physics flags `0x1940`) sets the local velocity to 156.8 × 0.033 × impulse and an acceleration that adds as much again; `0x004923E0` applies the quadratic drag with k = 0.5 (flags `0x6000`) against the local speed (its vertical part the grounded −5 ft/s); the position moves by that velocity × dt; flag `0x2000` and the impulse are cleared, and on the next frame `0x00491E20` bounds the velocity by the clip's root speed again. The 0.033 constants are 1/30: at 30 frames a second a landed blow moves the victim 0.6–1.0 ft and a stopped one 0.6–0.9 ft (frame-rate dependent in the original; nothing below ~19 fps, where the drag zeroes it). Caveat: `0x00492B70` reads the world-space impulse as if it were local to the victim (it is rotated by the victim's heading); the reimplementation pushes along the sweep in world space.

Sweep at the damage frame, measured by forward kinematics on the clips with the Long Sword (`local/re/tools/blade.ts`, not in the repository), horizontal part of the unit vector (x right, z forward): combo PN25 (0.18, 0.88), PN02 (−0.04, 0.88), PN15 (0.70, 0.10), PN16 (0.45, 0.89), PN17 (−0.94, 0.14); SWING_OVERHEAD PN03 (−0.18, 0.56), CHOP_LOW PN01 (−0.19, 0.62), JUMP_ATTACK PN05 (−0.24, 0.61), THRUST PP02 (−0.56, 0.17); the skeleton's rig gives the same within 0.02. The tip lies 6.8–7.5 ft ahead at these frames (11.7 ft in the leap), which supports the 7.5 ft reach of §15.3.

Implemented: `attackSweep` / `hitShove` (`shared/src/game/combat.ts`) and `WorldZone.shove`, for landed and stopped blows (not the shield bash), moved against the level; a player's shove reaches the client as a reconciliation correction.

## 16. Breaking Props, Sword Trails and Citizens Under Attack (Frida, 2026-10-12)

**Debris.** `0x43E310(table or texture, count, half extents*, centre*, speed)` spawns physical chunks (world objects of class 10, `0x483230(10)`): each is placed at random in the box about the centre (retried up to 10 times when the spot is not in a free sector) and sent off at (place − centre) × speed. A first argument of 0–3 picks a fixed table of 8 models (`0x4EE138` stone, `0x4EE158` wood, `0x4EE178` metal); anything else is a texture, and the chunk is one of the 16 models at `0x4EE1B8` (models.ctx 58 59 188 222 189 222 226 223 188 58 176 113 188 189 176 113: debriswood01/02, wddbs1/2, wd1lrg/sml, wdpcs1, stndbs, debrisstone01) wearing it. Logged on barrels: every hit (`0x44D0FD`) throws 5 chips (±1.2 ft about the blade, speed 40) wearing the barrel's texture and 5 SWORD_STONE effects down the blade (`0x44D1F5`); breaking (`0x451604`) adds 3 + rand·10 pieces through the barrel's volume (half extents 3.77 × 4.67 × 3.77 ft about its base, speed 1). They bounce slightly and vanish after ten-odd seconds (playtest). **Sounds:** each hit plays the target material's impact through `0x4B0FC0(id, x, y, z, 0, 1.0)` (`0x44D013`; the id from the material table `0x4EEA88` → `0x4EEDA8`; 306 SwStab02 on a barrel); there is no break sound — about 0.3 s later a chunk landing plays 339 (HitMetal02, `0x48CBD9`: 0x152 + material).

**Where the debris starts** (decompiled, 2026-10-17). A landed blow (`0x44CEF0`) centres the five chips on the contact point the victim's physics reports (vfunc `+0x44` → record `+0x20`, normal at `+0x2C`) and spawns its material effects (victim vfunc `+0x6C`) from that point stepping 0.7 ft (`0x4E0904`) along the attacker's blade sweep (physics vfunc `+0xAC`). Breaking (`0x4514E0`, when the HP at stats `+8` reaches 0) passes the object's transform position as the centre and its physics extents (`+0x64/+0x68/+0x6C`) as the half extents. **Placed objects** are drawn in their model's own node frame: the .cap 3×3 places the raw .mdl vertices, without the node transform (data check over all acts: crate stacks fit, baskets stand on their base; 2026-10-17 context note). Cell lookup for a point: `0x4395F0` walks the vertical cell stack (top `+0x18`, bottom `+0x1C`, up `+0x10`, down `+0x14`), then `0x465660` walks the 2D edges (`+0x58` count, `+0x5C` list: two points, the two cells, the line) to the containing cell or 0; cells flagged `+0x28 & 4` count as none. `0x4379F0` links an object into a cell's list (`+0x50`).

**Sword trail** (decompiled, 2026-10-13; supersedes the capture-based reading). The swing component (`0x48C4D0` at the start of a swing, `0x48C670` every frame) reads the weapon model's line (MDL `DMY LINE …`: blade start and end; for dwarves, types 123–130, the end is stretched ×1.75) and feeds a trail from a pool of ten (`0x4C2F00`, all three textures `torchfire` = metatex `BASE=Fire`). A swing takes a fresh trail (`0x4C3070`, init `0x4C2DE0` with the swing length; the previous one is released, state 2, `0x4C2EF0`). `0x4C2E00` adds a node of the two points at most every 0.03 s (in between the newest node is moved), new nodes at alpha 255 and v = 0.7 + elapsed / (3 × swing length) capped at 1. Every frame `0x4C30A0` advances t (seconds since the swing began) and sets the alphas from the oldest node: 100 − 333.3 t, +3.333 per newer node, capped at 100 (out of 255); a released trail goes when t > nodes × 0.01 + 0.3 s, any trail after 5 s. The strip (`0x4C8A80` add, `0x4C8AD0` drop oldest, `0x4C8450` project, `0x4C8990` / `0x4C84F0` draw) puts a quad between consecutive nodes: u 0 at the line's end, 1 at its start, the nodes' v, white vertices with their alpha over the texture, drawn on both sides. Several of these routines were never made functions by the headless decompilation (only reached through vtables); they were disassembled from the running game.

**Citizens under attack** (states from the id / name table `0x4EA6F0`). The citizen struck plays `ASM_IMPACT_LEFT` / `_BACK` (~0.5 s), then `ASM_COMBAT_STANDING` (~0.4 s) and `ASM_RUNNING`. Citizens that see it — one 55 ft away did, one 65 ft away did not — go `COMBAT_STANDING` for ~0.25 s, then run ~7 s; afterwards, a player coming within ~30 ft sets them off again at once (alert 10–100 ms, run). A citizen with Drake standing ~4 ft away plays `ASM_GESTURE_ANGRY` (84).

**Talking to citizens** (Frida, same day). The use key on a citizen plays its line (Sound.ctx MP3, e.g. RO_CM_03) and switches it to `ASM_GESTURE_POLITE_CONVERSATION` (81) for exactly the line's length (7.39 s, 4.81 s and so on), standing still and turning to face Drake at ~90° a second, following him while the line lasts. One citizen's rousing line ("Our Crusaders shall smite the Legion!") used `ASM_GESTURE_ANGRY` (84) instead; how the gesture is chosen per line is not known (implemented: always the polite one).


## 17. Scripted Sequences and the Quest Manager (decompiled, 2026-10-14)

### 17.0 Where a new game begins
The main menu's New Game (0x4A3280) copies `caps\WS9A.cap` into the current-act name (0x58CA0C; Training copies `caps\train.cap`) with load mode 0. Ws9a is the prison: Drake has just beaten the two skeletons (Skeleton01/02 beside him), Captain Ursan's sequence ends in Ws1a. The level load (0x476F20) places Drake, when not arriving through an exit, at the act's first start point (type 0x06, asset-format-discovery.md §6.5): Ws9a (2186.6, 1024.0, 1560.0), heading 0. Arriving through an exit it uses `0x58C9A8` (the crossing offset plus the matching entry's +0x44 point, heading unchanged; asset-format-discovery.md §6.2.2) or the start point the loadlevel names (`0x58D0CE`, exits with flag 2), with its angles. The heading's sense (D3D, facing (sin h, cos h)) was checked against the level geometry, not live: from most start points of Ca, Du and Gl that way is the open side.

### 17.1 Sequences
A sequence starts when the player enters its flag trigger (each fires once: the flag stays set). At the start (0x41F830) the player is frozen and hidden and a stand-in (`PlayerActor`, global 0x52FFC4, actor 1) takes his transform; at the end (0x419600 -> 0x41FB80) the player is put where the stand-in stands. Each track runs in order; the start conditions are in asset-format-discovery.md §6.5. PlaySound does not wait for the line (a Wait of its Sound.ctx length follows); Wait / Timeline / FadeOut last their argument; CameraTimeline's camera flies its path at its rate. Cs1a's Aerin scene: Drake's line, 3317 ms, Aerin's line, the fade from key 11 (5.5 s) for 3 s, then ScriptedSequenceDone loads Ci1a: 8.5 s, as played.

A loadlevel exit to another act of the same mesh (Ci1b -> Ci2b) matches no entry object, so Drake keeps his position (the fixup's type-0x13 case moves the start only for the matching entry: entry = the exit number + 1 of the act's portal back). MoveToPos targets' heights are not kept by the scripts (Ci1a's are Cs1a's): the actors walk on the floor.

### 17.2 Quest manager
`0x497670` builds 10 main-quest records (0x3C bytes: +4 objective, +6 title, +8 giver (string ids), +0x0A XP, +0x0C gold, +0x12 item name, +0x32 state, +0x34 / +0x36 journal entries at start / end, +0x38..+0x3B player bits set / cleared on assign / complete) and 26 side-quest records (0x44 bytes from +0x258, with voice lines for offer / reminder / completion and required items). Quest triggers (type 0x1D) fire 0x4641F0: bit 0x01 journal start (0x496C00), 0x20 journal end, 0x08 assign (main 0x496990: active list), 0x10 complete (main 0x496B40: an active quest finishes with Stats_AddExperience(XP) and its gold (0x496A40); one never assigned is only marked done), 0x04 talk (side 0x497170), 0x02 a side quest's item check (0x4974A0), 0x40 a player bit. The main story's triggers are fired by the sequences' TriggerFlag steps (Celestia's briefing completes "Meet Celestia" and assigns "Horn of Shattering").

### 17.3 Quest book
F2 (Readme). Drawn by 0x455EE0: the frame of textures questbook1-3 and 5-14 at fixed points of a 640 x 480 screen over the glass256 pane (32,70)-(532,460); tabs Next / Previous / Assigned / Completed / Notes clicked at x 520-632, y 100 / 155 / 211 / 269 / 325 (0x455BF0); the selected tab (questbookb3-5) at x 531 and the hover outline (questbookbh) at x 545. Text (0x456240, LoadStringA): Assigned "<giver> said\n<objective>", Completed "Completed: <title> Quest", Notes the journal; with more than one entry, one per page.

### 17.4 Character statistics screen
F1 (Readme). Draw routine 0x454CA0 (textures loaded by 0x454C10, freed by 0x454C70; screen vtable 0x4E0E94, its four mouse slots the no-op 0x4569F0: nothing on it is clickable). On a 640 x 480 screen: glass256 stretched over (8,12)-(629,472); statsC (16 x 16) tiled along the top at y 7 for x = 24 + 16i < 520, and 22 times down the right from (614,120), turned a quarter (UV corners at (630,y), (630,y+16), (614,y+16), (614,y)); statsA (128²) at (512,0), statsB (64²) at (0,4).

Text boxes (0x4414F0: font 0x53C320, x, y, width, line count, colour 0xFFCFCFCF, text), strings by LoadStringA id:
- (128,48) w 384, 22 lines: "Drake the Crusader  " + "%s %d

" Level 2959 / level (+0x230); " %s %d  %s %d

" Experience 2957 / XP (+0x1C4), Next Level at 2958 / threshold (+0x234); " %d Might
" (+0x264; string 2960 is passed but the literal is used), " %d %s
" Intelligence 2961 (+0x265), Endurance 2962 (+0x266), " %d %s

" Speed 2963 (+0x267).
- (338,122) w 300, 8 lines: "%s %.1f" Damage Multiplier 2964 (+0x248); "%s %d/%d" Mana 2965; Health 2966 (current rounded, max truncated).
- Table at y 210, columns x 160 / 260 / 360, 15 lines: headers Type 2967, Resist 2968, Damage 2969; one row per damage type 2970 + i (Slash ... Dark) except Mind, Spirit, Body; Resist " %d%%" = trunc((1 − r) × 100) with r = 1 × stats +0xA4 × equipped protection (0x46C120) × +0x17C (0x44CB60); Damage "  %d" = trunc of the weapon slot's item damage vector (0x46C0D0, zeros unarmed); last row Total 2981, blank, "  %.0f x %.1f = %.0f" (sum of all 11 damage values, damage multiplier, product).

Not implemented yet (side quests: unshipped in the original, §18): relay targets other than triggers, the eye path's events and curve, the two .bik movies, DoInteraction.

## 18. Peaceful Creatures: Loadout, Talk, Idle Walk and the Guards' Alarm (decompiled, 2026-10-16)

A `.cap` creature record is the creature as the level editor left it, so its stats object (base = XP block − 0x1C0; asset-format-discovery.md §6.2) carries the placement's own loadout and behaviour. Stats vtable 0x4E09EC: slot 14 (+0x38) the disposition (+0x1D8), slot 15 (+0x3C) the idle behaviour (+0x1DC). Constructor 0x44C130: +0x1E4 = −1, +0x1D4 = 3.

**Loadout.** The inventory header sits at stats +0x1B0 (XP block − 0x10): +4 slots pointer, +8 capacity, +9 count, +0x0A weapon slot, +0x0C shield slot (0x0B / 0x0D–0x0F other equip slots; 0x46D8F0 / 0x46B940); slots are 0x44 bytes (count +0x10, item name +0x24). `Stats_EquipLoadout` (0x44D9D0, the template table) runs only when the engine builds a creature (Spectral Ally 0x43FEF0), not for placed ones: those hold what their header names. Captain Ursan (Ws9a, Gl1b, Gl2a) and Ws9a / Ws1a's Old Guard prisoner hold nothing; Celestia's throne guards an Axe; skeletons their own sword with or without a shield.

**Talk** (brain mode 2, 0x408980). A peaceful creature (disposition 0–2) whose idle brain (0x40C520) finds the player within 12 ft (distance band ≤ 1, 0x40E6B0; bands 8 / 12 / 20 ft at 0x4DE688 / 0x4DE680 / 0x4DE68C) switches to mode 2: it stops and turns to face him; it leaves after at least 3 s once he is beyond 20 ft (0x40C190 case 2). The use key picks the mode-2 creature within 12 ft most in front of the player (0x40DEB0). Then: if stats +0x1F0 holds a trigger and +0x1F4 has 0x2000000, the trigger fires (0x40E7B0; no shipped placement has one); else the creature's one line, Sound.ctx id stats +0x1E4 (−1 = none: nothing happens), plays with its text, and for the line's length it plays the ASM state at idle behaviour +0x3C (0x40E8C0; 81–95, absent on most). 1,712 of 2,037 placements have no line, merchants included. A hostile entering combat (0x40C830) plays its +0x1E4 instead (Gl3c / Gl4c Black Knights: SwSwing04).

**Idle behaviour** (stats +0x1DC: kind, step count, steps of 8-byte typed arguments). Kind 0 stands (0x4059F0) — 1,931 placements, Ws9a's prisoners included. Kinds 1 / 3 walk a path (0x405AC0; 106 placements, 26 of them hostile, all kind 1): steps [int pause ms (1000), int mode, 0x10 → a path object (+8 point count, +0x0C points)]. It walks to point i, waits the pause (state 2, +0x90), then 0x405FF0 moves i one way: below 0 → 1 going forward; past the last → the first when the mode int is under 1, else back the other way (every shipped path: back and forth).

**The guards' alarm.** The brain's event pass (0x40F890) handles a hit event (0x10) from the player on a creature of disposition 0–2 by setting 0x52FDC8; the frame loop copies it into 0x52FDC4 and clears it (0x4193D0), so the alarm lasts one frame. Noticing (0x40D910), for dispositions 0–2: with the alarm up, the player is taken as the target if the creature was hit by him (0x40D790) or can see him (eye-to-eye ray 0x406AF0, no range). So one blow on a citizen or guard turns every guard in sight on the player at once; unarmed ones run.

**Sound triggers walked into** (type 0x0B, activation bit 0, a volume; 0x200 once): the sound plays at its points (0x461490). Fourteen carry dialogue: Ci1b's guard line CG2_03_01 "Celestia is expecting you." by the throne-room doors, Drake's remarks (Ci4a, Gl2a) and train's prisoners. CG1_03_01 "Ursan sent word of your arrival" is referenced by nothing.

**Side quests.** The quest manager's 26 side quests (§17.2: offer, reminder and completion lines, items) are never offered: no shipped placement has a talk trigger, no quest trigger names a side quest, and the givers (Nai, Sir Marik, Raven, …) are not placed in any act. Record layout, talk / item-check handlers (0x497170 / 0x4974A0) and the full list: `docs/game-design/side-quests.md`. Shops are not NPCs but level triggers (§19).

## 19. Shops (decompiled, 2026-10-16)

A shop is a cap object of **type 0x1C** (loader case 0x4786B4, vtable 0x4E1D94), placed at a merchant's counter: +4 volume, +8 activation (8 = the use key in every shipped one), +0x35 item count, +0x36 the merchant's greeting (Sound.ctx: mm_ci_01 "Please, please check out my fine wares.", mm_ci_02, mm_co_02, HL_13_02), +0x38 the items (inventory slots of 0x44 bytes: count +0x10, name +0x24). The merchant NPC standing there (eMerchant1, DwarfMerchant*, DasherMerchant1) has no part in it.

Fire (slot 5, 0x464170): if the inventory screen is already in trade mode it closes (0x4573E0); else, at most every 500 ms (0x58C31C), it plays the greeting, fills the screen's other container with a **copy** of the shop's items (0x46D3D0 → 0x46A8A0 copies each slot, 0x46C360 tags them) and opens the inventory screen in mode 5 (0x4572E0(2, 5) → 0x46D4A0; modes: 1 ground and corpses within 96 ft² (0x471940), 2 a chest (0x4717E0), 3 / 4 a quest giving or taking an item (0x497170), 5 trade). Closing (0x46CD80) writes nothing back: every opening starts from the shop's own list.

Trade (0x46E290, mode 5): dropping a shop item into the bag or a worn slot costs its items.ctx **Price** (item definition +0x24, `Price` keyword handler 0x474860) × its count, compared with the gold stack (gold is an inventory item of type 8: 0x46B800(8), added by 0x46A940); too little and it springs back (0x46FC50). Dropping a bag item into the shop pays the same Price × count (the cost × −1.0 at 0x4DE87C). Sound 0x198 (408) on a paid trade, 0x199 (409) when the price is 0 (the item still changes hands).

The stock differs per act, so it changes as the story goes on: Citadel (Ci1b / 2b / 9b) Longsword of Quality, Metal Shield, Scale Armor, potions; Ci3b / 4b Longsword of the Crusader, Dragon Scale Armor, Light Plate Mail; Cador Sul (Cs1b / 2b) Mace, Scale Armor, Long Sword, Cs2b also a Torch Light Spell Book, Cs3b Holy Avenger, Heavy Plate Mail, Shield of Swiftness in Action; Corantha two shops per act (Co1a/2a/8a weapons and armour, Co3a/9a, Co4a the finest: Divine Justice, Boomer Axe, Enoch's Plate of Might); Duskwood (Du1c–Du9c) potions and the Dasher Hand Bow, Du3c Chl'Tk. 25 shops in all.


## 20. Spells (decompiled, 2026-10-17)

**Spell book.** 0x004BC720 builds eleven spell objects (slot -> object by 0x004BD270: +0x54 torch, +0x94 fire ball, +0xD8 slow, +0x118 freeze, +0x15C stone skin, +0x19C lightning, +0x1E4 heroism, +0x228 ally, +0x26C revelation, +0x2AC holy wrath, +0x300 soul drinker). Each keeps per level (index 0-2 at +6) mana (+8), duration (+0x10), value1 (+0x1C) and value2 (+0x28), filled from default.ctx `S` rows (0x00442000 -> 0x004BAC80). Vtable slots: +0x1C name string (0x5E1 + 3 x slot + level), +0x20 has-mana, +0x24 wind-up (effect and cast sound), +0x28 release, +0x30 per-frame update while active, +0x58 spend mana, +0x5C load the level's sound (table 0x004F654C: 313-315, 316-318, 322, 325, 324, 335/522/522, 319/319/351, 323, 327, 326, 321). Known mask at +2 of 0x00630C38; a book of a known spell raises the level index by one, capped at 2 (0x004BCD10). Mana: +1 every 5000 ms (0x004BCFC0).

**Casting.** Input (0x0042B7A0 standing; 0x0042AFC0 / 0x0042BFE0 moving): self spells enter state 0x39 (ASM_SPELL_CONJURE) with the spell's state queued in +0xAC (0x2F torch, 0x32 freeze, 0x33 stone skin, 0x35 heroism, 0x36 ally and revelation, 0x37 holy wrath); fire ball 0x30, slow 0x31, lightning 0x34 and soul drinker 0x38 go straight to their state, as an upper-body layer while moving. The clip's SPELL event (0x00457D20 -> 0x004BCF70) checks the mana again and releases. Drake's SPELL frames: PK01 9 of 28, PK02 12 of 29, PK04 27 of 48, PK05 19 of 33. A hit reaction aborts the cast.

**Releases** (objects from per-class pools, factories at 0x004E2384):
- Torch (0x004BADE0): LIGHT_CAST, a light for the duration; recast while lit does nothing.
- Fire ball (0x004BAF80 / 0x004BB130, class 0): 100 ft/s, life 50 s; level 3 throws three at 60 ft/s, ±0.2 sideways; levels 2-3 home (cone cos 80°, 180°/s; 0x004BE010 / 0x004BE220). Impact: FIREBALL_TARGET or FIREBALL_EXPLODE, sound 0x210, explosion (class 1, 0x004BE900): radius grows 30 / 50 / 80 ft/s for 0.25 s, FIRE = value1, knock-back 15.
- Slow (0x004BB3F0): projectile (class 5); level 1 puts SLOW on the creature hit (status kind 1, x value1 for the duration), level 2 bursts (class 6) slowing all in it, level 3 puts SLTI on the caster (kind 8: the world slowed, the caster x4 in 0x0044C3F0).
- Freeze (0x004BB5A0 -> 0x0043EEC0, class 4): a target in a 20° cone within 300 ft (0x00439A60); ice storm (class 13, 0x004C1370), 5 ft for 5 s: FRZE (kind 2) for duration x WATER resist, immune at 0.25 or less (0x004C1FF0). Thaw (0x0047E9B0): SNAPFREEZE_THAW, sound 0x20B, shards, kind 1 at 0 for 800 ms.
- Stone skin (0x004BB6E0): STON kind 6 = resist multipliers (+0x17C) x value1 on SLASH..WATER; STO2 kind 13 = model texture variant 6 / 8 / 10.
- Lightning (0x004BB910 / 0x004BB9F0): the nearest creature within cos 0.8 of the aim and 64 ft (0x004BD320), else 50 ft ahead; AIR value1; further strikes 250 ms apart at the next creature within 64 ft (0x004BD470).
- Heroism (0x004BBC70): SPED kind 0 (+0xE4 x value2), HERO kind 4 (damage multipliers +0x11C: SLASH and BASH x value1).
- Spectral ally (0x004BBF10, 0x00440230): type 155 10 ft ahead (6 ft clear needed), HP 80 / 100 / 120, weapon SLASH / BASH 15/15, 20/20, 20/20 + LIGHT 50, resist 1 / 0.8 / 0.6, disposition 6; replaced on recast, ALLY_APPEAR on arrival and at its end.
- Revelation (0x00440D70, class 14): a pulse to value2 (50 ft) over 0.1 s that shows class 0xCB objects (not identified).
- Holy wrath (0x0043FD30, class 8): a ring growing to value2 ft over 0.5 s, LIGHT value1 (DARK when a creature casts it: UNHOLY_WRATH_CAST), knock-back 10, only on the types of 0x004586D0 (0x74, 0x86, 0x8D, 0x8F-0x93, 0x96, 0x9B).
- Soul drinker (0x0043F950, class 7, 0x004C17D0-0x004C19B0): a target in a 12° cone within 100 ft; value1 HP over 5 s to the caster; against the 0x004586D0 types the flow reverses.

**Status objects** (pool 0x0058DB08, 0x54 bytes, vtable 0x004E2128): kind +4, value +8, descriptor +0x10, tag +0x40, owner +0x44; one per tag per character. Recompute by kind (0x004F326C): 0 speed x (+0xE4), 1 and 2 rate x (+0xE8), 3 bonus damage +, 4 damage x, 5 absorb +, 6 resist x, 8 SLTI, 9-12 attributes +, 13 model texture. On add 0x004F3234, on removal 0x004F32DC.

**Boost potions** (items.ctx `Use`, made by the use factory 0x004022B0-0x00402760, which compares the name against the strings at 0x004EA174-0x004EA1D0; the object's vtable +4 is the use, +0xC parses `UseParameters`, +0x14 clones). Both play sound 0x19E (414), set flag 0x8000000 on the controller (+0x48 vtable +0x2C, not decoded) and take a pooled status with duration = args[0] × 1000 ms (+0x54); a duration of 0 or less (the `Equip` form, e.g. Fist of Necros `EquipParameters(-1, LIGHT, 0.5)`) applies the change to the stats directly instead.
- BOOST_PROTECTION (class vtable 0x004DE46C, 0x3C bytes, use 0x00401D10, parse 0x00401DE0): a damage vector of 1.0 with the named type (0x00441D70) set to args[2]; status kind 6 (the vector multiplied into the resist multipliers +0x17C, 0x0047E7D0, like stone skin) under tag −2 (0xFFFFFFFE). The add (0x0047E550) never replaces a −2 tag, so resistances add up. 0.25 is a **multiplier**: a quarter of that type is taken. +0x17C is part of the resist getter 0x0044CB60 (base +0xA4 × worn protection 0x0046C120 × +0x17C), which freeze reads (0x004C1FF0): Water Resistance makes the drinker freeze-immune.
- BOOST_ATTRIBUTE (class vtable 0x004DE44C, 0x14 bytes, use 0x00401AB0, parse 0x00401BF0): attribute names 0x0044E2D0 (MIGHT 0, INTELLIGENCE 1, ENDURANCE 2, SPEED 3); status kind 0x004DE360[index] = 9-12, value (float) args[2], tag `ITM\0` | index (0x49544D00 | i: a second one of the same attribute replaces the first). Recompute 0x0047E800-0x0047E890 adds ftol(value) to the bonus +0xD4 / +0xD8 / +0xDC / +0xE0; kinds 9-12 have no add / step / remove hooks.
- The bonus reaches the stats through Stats_ComputeDerived 0x0044E090: reset (stats vtable +4, 0x0044C490: bonuses 0, speed / rate 1, bonus damage 0, damage x 1, absorb 0, resist x 1, worn items re-applied 0x0046C230), every status's recompute (0x0047E530), then Stats_ComputeEffectiveAttributes 0x0044E000 (base + bonus, capped at 50) and the derived stats. The player's per-frame status tick (player stats vtable 0x004E0AB8 slot 26, 0x0044DC30: 0x0047E480 then 0x0044E090) runs it every frame, so +25 Speed changes the speed multiplier +0x24C (0.999 + 0.01 × level + (Speed − 15) × 1.2 × 0.5 / 35) at once and until the status ends. Creatures' slot (0x0044C680) only ticks the statuses.
- Implemented: `ItemDef.boost` (`shared/src/game/items.ts`), `WorldZone.drinkBoost` / `refreshDerived`; tags RFIR / RAIR / REAR / RWAT and BMIG / BINT / BEND / BSPD (`shared/src/game/spells.ts`).

### 20.1 Creature casters (decompiled, 2026-10-17)

**Spell masks** (fourth dword of the template records, §9.1): Deceiver 0x40, Ice / Rock Elemental 0x20, Lava Elemental 0x80, Necros (and Necros Before) 0x34C, Dark Mage 0x25, Dark Master 0x38, Skeleton Ghost 0x02. Bit -> state (table 0x004EC258): 0 STONE_SKIN, 1 LIGHTNING, 2 SOUL_DRINKER, 3 HOLY_WRATH, 4-7 FIRE_BALL, 8 TORCH_LIGHT, 9 LIGHTNING. A bit is castable (0x004281D0) when the state resolves to a clip through 0x00428220, which falls back to a state of the same group (table 0x004EBD18: FIRE_BALL and THROW_ITEM share 0x200000) or to STANDING, so in effect always.

**Instances.** A second set of spell objects at 0x00630A50 (built by 0x004BA9C0; 0x004BD760 maps slot -> object: fire ball 0x630A90, stone skin 0x630AD4, lightning 0x630B14, holy wrath 0x630B5C, soul drinker 0x630BB0, revelation 0x630BF4). 0x004BDE80 sets the fire ball's +0x40 = 1 (projectile effect FIREBALL_PROJ_EVIL from table 0x004E2D38: PROJ, PROJ_EVIL, PROJ_FROST, PROJ_EARTH; frost / earth are never selected) and holy wrath's +0x50 = 1 (cast effect UNHOLY_WRATH_CAST from 0x004E2D4C; the hit 0x004C1BE0 then strikes the types *not* in 0x004586D0, and the damage is DARK). Sounds are loaded with the instances like the player's (0x004BCAB3, table 0x004F654C): lightning at index 2 (522).

**Release** (0x004BD7C0, from the controller's SPELL event flags 0x10000 / 0x100000 with the template's spell argument, 0x00425CC2): values set before every cast, mana 0, level index as noted. Other creatures: bit 0 stone skin 0.75 for 2 s; 1 lightning, AIR 3, one strike at the controller's target (+0x40); 2 soul drinker 3, value2 100; 3 unholy wrath 30, radius 20 ft; 5 / 6 / 7 fire ball levels 1 / 2 / 3, FIRE 3 / 3 / 2; 8 Force Globe (0x00441110: class 15 "ForceGlobe" attached to the caster, 10000); 9 only records the time (0x630F84); 10 revelation. Necros (type 0x96) instead: difficulty factor (0x58C268 +0x85: 0.5 / 1.0 / 1.2) x 10 for lightning, soul drinker (value2 20) and every fire ball bit, which all throw the triple ball; unholy wrath 20 x factor for 4 s. Creatures aim at their target (0x00406620 from the hand) instead of the camera.

**Brain.** Decide (0x004096A0) tries, before the melee choices: (7) mask 0x100 castable and the globe not up (stats +0x1FC bit 2) and the previous pick not 7; (6) a 0x0C spell (soul drinker / holy wrath), the target in band 1-2 (8-20 ft) and floor(rand x 1000) > 700; (5) a 0x2E2 spell (lightning, fire balls, bit 9), beyond 8 ft, and a clear line from 0.9 of the caster's height (0x004070E0). Phase 0x0040AA20 (masks 0x100 / 0x0C / 0x2E2): within 8 ft it is dropped (not for the globe); while now <= +0xE0 or the target is 45° or more off the heading (0x0040E240) it stands facing the target; then 0x00408840 keeps the castable bits (soul drinker not against a 0x004586D0 type), takes floor(rand x count), plays template 9 (one step: the spell's state, whole body, to the clip's end) and sets +0xE0 = now + 0x0040EBE0 (lightning / soul drinker / wrath 6000 ms, fire balls 3000; Necros: soul drinker 1000, else 1); after the clip it stands 2000 ms (Necros 200, 0x0040EC70) and decides again. With nothing castable it swings once (template 6, state 0x18). The 0x101 branch (stone skin / torch, 0x0040AE40) is never entered; brain kind 5 (0x0040B540: Necros-like timed wrath / fire balls / class 15, 10 s cycle) is not reached from 0x00408C40.

**Clips.** All humanoid casters bind PK02 (fire ball, SPELL frame 12), PK04 (holy wrath, soul drinker, 27), PK05 (lightning, 19), PK01 (torch, 9). The Deceiver and IceElemental.mdl have no spell clips: fire ball falls back to ASM_THROW_ITEM (M37P02_thw_at.ani, 29 frames; icewalk.ani, 33), whose clips carry no SPELL event, so their casts never take effect.

Implemented: `CREATURE_SPELLS` / `CREATURE_SPELL_MASKS` / `CREATURE_CAST` (`shared/src/game/spells.ts`), the brain in `world_zone.ts` (`spellChoice`, `mobSpell`), the effects through `SpellRuntime.release` with a target; Necros's values and the Force Globe since §22. Not implemented: the swing fallback of template 6.

### 20.2 What the spells look and sound like (decompiled, 2026-10-18)

**Wind-ups** (vtable +0x24: torch 0x004BAD30, fire ball 0x004BAF20, slow 0x004BB340, freeze 0x004BB4F0, stone skin 0x004BB630, lightning 0x004BB8B0, heroism 0x004BBB90, ally 0x004BBE30, revelation 0x004BC140, holy wrath 0x004BC210, soul drinker 0x004BC3C0). Each takes the caster's attachment dummy `controller(+0x44)->vtable+0x2C(i)` (0x00422030: the model's DMY XFRM in file order; Drake 0 = WPN LEFT, 1 = WPN RIGHT) and hangs its effect there with 0x00482150 (effect, level, node, offset 0): torch, slow, freeze, stone skin, lightning, revelation node 1; fire ball node 0; heroism, ally, holy wrath, soul drinker both nodes. All but fire ball and lightning play the +0x3C sound at the caster's position. Effect ids index the name table 0x004F35F8; 0x00482150 adds level × 0x5B and steps down a level while that variant is missing.

**Conjure sound.** The player's state → clip routine (jump table 0x0042A7D4 via byte map 0x0042A814, state − 8) plays, on entering state 0x39 ASM_SPELL_CONJURE (case 0x0042A2C4), the conjure clip blended 0.6 and Sound.ctx 327 (0x147, SplSRCast01) at the character's position, rate 1. Every self spell (torch, freeze, stone skin, heroism, ally, revelation, holy wrath) starts with it, together with its own +0x24 sound; fire ball, slow, lightning and soul drinker never enter 0x39.

**Sounds.** 0x004B0FC0(id, x, y, z, flags, rate): the table 0x004F654C is right (Sound.ctx ids). A positional sound is dropped beyond its priority's distance (table 0x004F61D8, stride 0x1C, squared feet: A 40000, B 22500, C 12544, D 3600); the last argument scales the AIL playback rate (0x004B12B0). The bolt (0x004BF480, 0x20A) and the explosion (0x004BE980, 0x210) pass 0.8 + 0.4 × rand; the rest 1.0.

**Lightning bolt** (object vtable 0x004E32B0, render component vtable 0x004E3340). Textures by 0x004BF680: `lightningcap` / `lightning` (the `s…` set when the driver query 0x0058C878 returns 0). 0x004BFBB0 lays the strip through seven control points (side, height, along, ± ranges): (0,0,0), (0,0,1/6), (0.08±0.08, ±0.05, 1/3), (±0.08, ±0.1, 1/2), (−0.06±0.08, ±0.05, 2/3), (0, ±0.05, 5/6), (0, ±0.05, 1); 0x004C9040 places them: along × (to − from), side × (−dz, dx) of the full delta, height × 20 ft. The chained form 0x004BFA90 uses 0x004F6660 / 0x004F66F0 (six points, 15 nodes) plus two branches of 4 points (0x004F6780 / 0x004F6840, 5 nodes). Node width 40 (0x004C8FC0); alpha 255 falls 0.34 per ms (0x004BF700). While alive the bolt object spawns LIGHTNING_TARGET (0x1C) and a 200 light at its end every frame (0x004BF0F0 / 0x004BF1E0).

**Spell objects with a model** (factories 0x004E2384, model component `+0x54(model, texture)`): HolyWrath class 8 (0x0043FA90) and class 14 (revelation, 0x00440AE0) use models.ctx model 4 `ring.mdl` (T ringfire4, unholyfire, revelation; 0x0043FD30 picks texture `holy == 0`, 0x00440D70 picks 2); ForceGlobe class 15 model 5 `model5.mdl` texture 1 (eglobe). Fire ball and slow projectiles set model 5 texture 0 too (collision sphere, not seen). Explosion, Snapfreeze, IceStorm, SlowExplosion and Souldrinker carry no model. The ring (update 0x004C1B60 after 0x004BEA70) is scaled (r, min(r, 10), r) by the current radius r (+0x54, ft) and turned `+0x28(r × 30, 0, 0)`.

**Status looks** (hook tables by kind: add 0x004F3234, recompute 0x004F326C, step 0x004F32A4, remove 0x004F32DC; per-descriptor step 0x004F3314). No status draws a shell round the body:
- Freeze (kind 2): add 0x0047E6F0 sets flag 4 on the character's controller (`char+0x44 → +0x44`, `+0xC`), which stops its animation; step 0x0047E8C0; remove 0x0047E9B0 clears it, spawns SNAPFREEZE_THAW (0x20), plays 0x20B at rate 0.8–1.2 and throws ice shards. The ice storm (0x004C1370) spawns no effect of its own; the snap freeze's SNAPFREEZE_TARGET (0x1F, 0x004C10FC / 0x004C121C) is the strike.
- Heroism: HERO is created with descriptor `+0x10(1)` (0x004BBC70). Descriptor 1's step 0x0047E8E0 accumulates dt and every 200 ms (0x004E2120) spawns HEROISM_EFFECT (0x0C) at the character's position + (0, 6, 0) ft, variant ftol(value) = the level index.
- Stone skin: STO2 (kind 13, value 6 / 8 / 10 by level) recompute 0x0047E710 sets the body metatex's mode `+0x4C` (0x0047C5F0); removal 0x0047EB40 sets mode + 1. The metatex step (0x0047BDBB) moves its blend `+0x54` (0–100) toward INPUT1: mode 6 +2 up to 50, 8 +3 up to 75, 10 +4 up to 100; 7 / 9 / 11 back down by 2 / 3 / 4 to 0. Only Drake's metatex entries have an INPUT1 (`drake` → `Stone`, `drake02armor2..5` / `drake05armor5` → their `…st` images), so stone skin changes no other model.
- Effects.stg `SPHERE` shapes (`numpolys 18`; heroism's HERO_EFCT*_3, soul drinker's SOULTARGET*; class 0x004E2CE0 built by 0x004AE480 + 0x004AE7F0): a unit dome facing the camera, a cap of n/3 triangles from the pole to a ring at 45° (0.707) and a band to the rim, UVs (x + 1) / 2 like a sprite (0x004AE1D0). Same outline as a sprite; it bulges its radius toward the camera, so it lies over what it surrounds.
- Shape colours (OUTER / CENTER / INNER) are 0-255 values packed as ARGB vertex colours (0x004AE120).

**Blending** (gfx_d3d.dll, the renderer gfxdll.cfg names). Its only SRCBLEND / DESTBLEND states are SRCALPHA / INVSRCALPHA, plus DESTCOLOR / ZERO for the lightmap pass. Texture stage 0 modulates colour and alpha (texture × vertex); vertex-alpha-only (ALPHAOP SELECTARG2) is used only with no texture bound. So effects, glows, the ring and the bolt are alpha blended, never additive.

**Torch Light's light** (update 0x004BAE60): every frame a light at the position + 4 × `+0xC4` vector, through 0x0044BEA0 with one value, value1 × 25 (0x004E24A0), passed as all three colour components: white.

## 21. Ground Items Stay Where Placed (decompiled, 2026-10-18)

The level load (0x00476F20) relocates the cap image through per-type fixup lists (count + pointers; switch at 0x0047852B, byte table 0x00479958, jump table 0x0047984C). Item objects are list 0x35; their components: slot 0 transform 0x5A, slot 1 0x66, slot 2 0x67, slot 3 0x63, slot 4 item 0x57, slot 5 render 0x60. Props carry the same 0x66 / 0x67 / 0x63 components; creatures carry 0x5B / 0x5C / 0x5D. Types get their vtables from prototypes built at 0x004CA740 and copied by 0x004CB450.

- 0x63 (prototype 0x00639504, 0x78 bytes, vtable 0x004DFCD8): the static physics component. Its step (+0x34) is an empty stub (0x00402840), its velocity getters (+0x70…+0x84) return zero, and +0x3C / +0x40 return 0. The creature component (0x5D, vtable 0x004E24FC) puts its integrator at +0x34 (0x0048DD50: velocity, then moving the transform).
- 0x66 (vtable 0x004E1174, 0x14 bytes) draws the model (0x00466BF0). 0x67 (vtable 0x004DEAC4, 0x10 bytes) holds only a sound/animation holder, and every other method is a stub.
- After loading, each item gets 0x00458350 (component init) and 0x00483800 (links it into its SpaceMap cell at its stored position), then the difficulty filter. Nothing snaps it to the floor or lets it fall.

So a ground item stays exactly where the .cap put it. Floating or off-mesh items (Ca1c/Ca2c/Ca3c Broad Sword, Cs3b potion, Cs3a's five, the gold outside Ca1b/Ca1c/Ca2a/Ca3d) are like that in the original.

## 22. Elementals, Necros, Creature Scale and Unarmed Damage (decompiled, 2026-10-19)

**Placement record.** Relative to the XP block (asset-format-discovery §6.2): −0x1A8 the 11 unarmed damage values (the stats' +0x18 vector, after its vtable at −0x1AC; resist is the third vector after it, −0x118, as stats +0xA4 is 0x90 past +0x14), −0x1D4 the model scale (render component +0x20). Unarmed damage is added to the weapon's for every creature (`Stats_GetOutgoingDamage` 0x0044CCF0 copies +0x18, then adds the weapon's): skeletons DARK 2, Shadows DARK 15, Dark Masters DARK 10, Ice Titans BASH 5 + WATER 10, Rock Elementals BASH 10 + EARTH 10, Ice BASH 10 + WATER 20, Lava BASH 10 + FIRE 30, Necros DARK 40. Scales: Ice Titans 1.5–2, Ogres 1.2, Rock Elementals and Zealots 0.8, Lava Elementals 1.2, Necros 1.5.

**How a creature's blow is swept.** Clip events dispatch by keyword prefix (0x004575A0 over the table at 0x004E0F50: SOUND, SWING 0x00457A60, RECOVERY 0x00457C50, JUMP, SPELL, SWAP, THROW, LAND); the handler gets the rest of the name. The SWING handler starts the swing component (`Swing_Component_Start` 0x0048C4D0) with a line index: 2 for " DOUBL", else 0, and its length up to the next event named exactly `RECOVERY` (0x00482E90, full-name compare; 60 frames when none). The line comes from the character's model (0x00421D50: its DMY LINE segments, +0x1C, 0x18 bytes each; index 2 = the segment between the midpoints of lines 0 and 1), swept frame by frame (0x0048C670) against characters (0x0048C9F0) and walls (0x0048CAB0, physics flag 0x40000); a hit ends that sweep. So "SWING RECOVERY" starts another sweep. Lines: IceElemental.mdl `DMY LINE LEFT HAND` / `RIGHT HAND` on the fingers; NecrosAftercollision.mdl `DMY LINE NECRARM` on the right forearm; weapons their own (longsword `DMY LINE SWARD`).

**Elemental attacks** (forward kinematics of the lines over each sweep, ft ahead of the clip's start, × scale): SWING_LEVEL / SWING_OVERHEAD = M18C01ice_a_h, SWING DOUBL 25 → RECOVERY 32, 11.5 ft; CHOP_LOW = M18C02ice_a_m, SWING START 10, "SWING RECOVERY" 19 and 28, SWING START 28, no RECOVERY: three sweeps to the clip end (43), 8.1 / 11.8 / 12.8 ft. No ASM_THRUST clip: 0x00428220 falls back to the first state of group 0x20 (table 0x004EBD18 order: 23 CHOP_LOW, 24, 25) with a clip, CHOP_LOW. ASM_JUMP_ATTACK (M18A07ice_jmp_f) and ASM_RAM_SHOULDER carry no events (no hit). Necros's arm reaches 6.2 / 7.2 / 7.2 / 6.7 ft in PN02 / PN01 / PN03 / PP02, the table's values.

**Placed spell masks.** A placed creature's stats are copied from its record (0x00432D50, +0x1F8 included), so the brain reads the placement's mask (XP block +0x38), not the template's; the template mask only reaches creatures made in code (the spectral ally, 0x0043FEF0 sets +0x1F8 from 0x004ED860). Placed masks: Ice Elemental 0, Rock Elemental 1 (stone skin, whose branch is never entered), Lava Elemental 0x80, Shadow 4 (soul drinker; 3 with 0), Greater Black Knight 2 on the 5 hostile ones, Skeleton Ghost 2, one Skeleton 2, Dark Mage 0x25 (53) / 0x41 / 0x45 / 0x0A / 8 / 0x40, Dark Master 0x58 (12) / 8 / 0x38 / 0x48 / 0x0A, Deceiver 0x40, Necros 0x34E (adds lightning). So Ice and Rock Elementals cast nothing: they run in (ice_run, 18 ft in 20 frames) and fight. Converter 1.31 emits `spells`.

**The elementals' throw walks** (only the Lava Elemental's 0x80 now reaches it). Their fire-ball bit (masks 0x20 / 0x80) is always castable (0x004281D0 calls 0x00428220 non-strict, which ends at STANDING), and ASM_THROW_ITEM is `icewalk`, a walk with 8.26 ft of root motion in 33 frames (the same as m18a01ice_w_fw). Beyond 8 ft with a clear line an elemental therefore "throws" (nothing leaves: no SPELL event), walking 8 ft nearer, stands 2 s, and again, until the melee brain takes over within 8 ft. The Deceiver's throw (M37P02_thw_at) has no root motion: it stands.

**Big creatures.** 0x004083F0: scale above 1.5 never hops in and adds 3 to the standing sequence roll. Root motion is not scaled in the speed path (0x00429810 / 0x00422CF0).

**Necros** (type 0x96): no flinch (controller 0x00426C70 ignores flag 0x8000 for him); a blow whose source is type 0x96 sets the knock-down flag 0x4000000 on the player whatever the roll (0x0044CA00; his spell objects are other sources); shieldless special RAM_SHOULDER. Spell values (0x004BD7C0 Necros branch, factor 0.5 / 1.0 / 1.2 by settings +0x85): lightning AIR 10 f; soul drinker 10 f, value2 20; unholy wrath DARK 20 f, duration 4000 ms, 20 ft; bits 5 / 6 / 7 / 9 the triple fire ball, FIRE 10 f; bit 8 the Force Globe. His mask 0x34C: soul drinker, unholy wrath, bits 6 and 9 (triple balls), the globe.

**Force Globe** (0x00441110 → factory 0x00440E70, class 15 "ForceGlobe"; component vtable 0x004E0784): render component model 5 texture 1 (`model5.mdl`, a unit sphere, `eglobe`); +0x64 = 10000 ms. Init (0x004C1D70) sets the owner's stats +0x1F4 bit 8; update (0x004C1E20) turns it, follows the owner, blinks at the end, clears bit 8 when the time is out or the owner is dead. Bit 8 makes explosions (0x004BEA10), fire balls (0x004BEE90), the lightning chain (0x004BF380), the ice storm (0x004C1370) and soul drinker (0x004C17D0) pass the owner by; holy wrath and blows still reach him. The brain (0x004096A0 choice 7) raises it whenever it is down and was not the previous pick, at any range; bit 8's state is ASM_SPELL_TORCH_LIGHT (PK01, SPELL frame 9).

**Necros's arrival.** bs1a's seqNecros: Necros Before (139) speaks and vanishes (Appear 0), Necros (150) is hidden at the start of his track (Appear 0) and shown at its end (Appear 1).

Implemented: converter 1.30 (`damage`, `scale`); archetypes `ice_elemental` / `rock_elemental` / `lava_elemental` / `necros` / `ghost_father` (`shared/src/game/combat.ts`, `ELEMENTAL_ATTACKS`, `HUMANOID_ATTACKS`, `scaledAttack`, `MOB_BIG_SCALE`), `necrosSpell`, `creatureCastWalks`, status `GLOB` (`spells.ts`, `spell_runtime.ts` `globed`), `hidden` spawns revealed by a finished sequence (`world_zone.ts`); client models, scale and the globe (`spell_visuals.ts`).


## 23. Item Use Behaviours: Shields, Soul Drinking, Throw and Shoot (decompiled, 2026-10-19)

**Factory.** `0x00402170`–`0x00402760` compares items.ctx `Use` against the strings at `0x004EA174`–`0x004EA1F0` and builds: BOOMER vtable `0x4DE370`, SHOOT `0x4DE3A0`, HEAL `0x4DE3B8`, DRINK_SOUL `0x4DE400` (+8 amount 10.0, +0xC mask), REFLECT `0x4DE41C` (+8 mask), INVISIBILITY `0x4DE434`, BLOCK `0x4DE484` (+8 mask). Slot 1 is the use, slot 3 parses `UseParameters`. BLOCK / REFLECT / DRINK_SOUL start with mask MELEE | PROJECTILE (3); a parameter `CLEAR` empties it, a name from `0x4EA0F0` (MELEE, PROJECTILE, FIREBALL, LIGHTNING, GIANTS) ORs its bit from `0x4EA104` (1, 2, 4, 8, 16), a number (DRINK_SOUL) sets the amount.

**Mask test** (`0x00401F20`, same in `0x00401810` / `0x004014C0`): against an object named `Lightning` → bit 8; `Explosion` → bit 4; a creature of type 0x87–0x8A (Ice Titan, the three elementals) or whose render scale (animation controller `+0x48` vtable `+0x58` → `+0xC` → `+0x20`) is ≥ 1.5 (`0x4DE418`) → bit 16; type 0x56 → never; otherwise bit 1. So plain shields do not stop the big creatures' blows, explosions or bolts.

**Who asks.** `Stats_TryBlockWithShield` (`0x0044D5E0`) calls the shield's use through `0x00474550` after the cone test. The lightning bolt (`0x004BEE90`) and the explosion (`0x004BEA10`) call the target's `+0x50` vtable `+0x54` too: a stopped bolt is bent to the bearer's hand dummy (`0x00422030`) and does no damage; a stopped explosion leaves the target out. REFLECT then calls the incoming object's `+0x54` vtable `+0x60` (for projectiles: set owner, `0x00440790`); what that does to a bolt or a melee attacker was not traced.

**Weapons.** A landed blow runs the attacker's weapon use (`0x0044D584` → `0x0046B880` → `0x00474550`, args item, attacker, victim). DRINK_SOUL: if either has no stats, only the mask answers; else (giants need bit 16) effect 0x12 SOULDRINKER_ENERGY and 0x0D SOULDRINKER_CAST, amount = min(amount, victim HP), victim loses it (`+0x4C`, kind 9), bearer gains it (`+0x44`). BOOMER (`0x00401000`) calls `0x0043EAE0(attacker)`: a pooled type-3 object (pool `0x58DE10`, 8 of them, `0x00483230`) launched at 60 ft/s (`0x4DFB74`) along the wielder's facing (the player: the camera's), effect 0x28 MAGIC_AXE_PROJ — so each landed Boomer Axe blow also throws a magic axe; the projectile's own behaviour was not traced. SHOOT (`0x004010C0` → `0x00440790`) fires a type-0xB object only with the ammunition (`UseParameters ARROW`, `0x00474E50`) in the inventory. Creatures throw / shoot on their ASM_THROW_ITEM clip's event (`0x0042C77F` "Arrow", `0x0042C7BE` "Boomer Axe"); Drake has no ASM_THROW_ITEM clip, and no level holds an Arrow.

**Calls inherit by name.** items.json keeps only the child's calls when it has any; the engine runs the parent's first, so Enoch's Plate of Might keeps Heavy Plate Mail's `SetArmorSkin(124, 0)`.

### 23.1 The Boomer Axe's magic axe (decompiled, 2026-10-19)

**The pool.** `0x00482F60` fills the object pool (`[0x58DE10]`): 16 types, counts at `0x4E2344` (32, 32, 32, **8**, 8, 8, 8, 8, 8, 2, 32, 8, 32, 4, 3, 2), factories at `0x4E2384`; `0x00483230(type)` returns the first whose `+0x14` lacks bit 2 (in use). Type 3 is `0x0043E850`: an object named **"Axe"** (`0x4EE614`), model 0x47 (71, standardaxe.mdl), physics `0x4E00D0` with `+0x48` = 1.5 (radius), and the behaviour `0x004C0420` (0xDC bytes, vtable `0x4E3468` derived from the arrow's `0x4E3400`, `0x004BFE50`, class type 11). Slots: 0 reset `0x004C0550`, 1 start `0x004C0670` (spin loop sound 0x14E = 334 attached), 6 update `0x004C06B0`, 20 hit object `0x004C0A20` → `0x004C0A50`, 21 hit level `0x004C0BD0`, 24 set owner `0x004BFEE0` (+0x38), 25 kind 6 (`0x004C0540`; the arrow 3). Fields: +8 damage vector **SLASH 5, AIR 5**; +0x3C returning; +0x40 t; +0x44 pace; +0x48 out time 1000 ms; +0x4C the carried item record; three splines at +0x90 / +0xA8 / +0xC0 (4 keys, `0x004C2800`).

**The throw** (`0x0043EAE0(wielder)`, from BOOMER `0x00401000` on each landed blow): needs the wielder's controller (+0x48) and a free axe; sets the owner, **takes the held weapon out of the inventory** (`0x0046B150` on stats +0x1B0: the held index +0xA = −1, the 0x44-byte item copied out) into the axe (+0x68 → +0x4C), redraws the hands (`0x0046B390`), puts the axe at the hand node (controller `+0xC8(0x14)`), velocity 60 ft/s × the facing (`+0xC4`; the player: the camera's `[0x53C218]+0x1BC`, pitch included), adds it to the wielder's cell (`0x00483740`) and hangs effect 0x28 MAGIC_AXE_PROJ on it (`0x00482150`).

**Out** (`0x004C06B0`, dt in ms): a light (100, 20, 100) at it every frame (`0x0044BEE0`, colour then position, one frame); its yaw turns dt × 0.001 × **2160°/s**, its heading kept to its velocity (`0x004904F0`); +0x48 −= dt: at or below 0 it turns back (`0x004C0CC0`). A character (`0x004C0A20`: not itself, not the wielder, not flag 0x40) → `0x004C0A50`: the victim's shield test (stats +0x54 with the axe; the mask test sees an "Axe" — no bolt, no explosion, not a creature — so MELEE) or the victim's `+0x38(8)` (its physics flags & 8, `0x004580B0`; who sets 8 not found) → SWORD_METAL sparks (effect 1) at the contact; else the contact copied to the victim's physics, stats `+0xC` (the attacker notice), sound 306 + round(rand) (`0x004CED64` rounds) at the victim and `0x004C02C0`: a push of 3 along the axe's velocity (physics +0x60), damage through stats `+0x48` (Stats_TakeDamage, kind 6: resists apply) and controller flag 0x8000. Then it turns back unless already returning. The level (`0x004C0BD0`): SWORD_METAL at the contact, a **SCORCH** decal (`0x00442E30` kind 0), sound 328, or 206 when round(rand) ≠ 0, and it turns back.

**Back** (`0x004C0CC0`): d = wielder − axe, pace = 80 / |d| (ft); per axis a spline with key 0 (t 0) = here, keys 1 and 2 (t 1, 2) = here + d × 0.25 i + q (d.z, 0, −d.x), q = rand × 0.3 × s, s = ±1 at random then flipped; key 3 (t 3) is set every frame (`0x004C07D2`) to the hand point in the wielder's frame: (3, 6, 0) ft when the hand is empty (`0x0046B880` → none), else (0, 5, 0). Natural cubic spline (`0x004C2BF0`, end curvatures 0), evaluated `a + bx + cx² + dx³` (`0x004C28F0`). t += dt × pace; velocity = (S(t) − pos) / dt, so it keeps hitting characters on the way (`0x004C0A20` does not look at +0x3C). Crossing t = 3 − 0.15 × pace with an empty hand sets the wielder's controller flag 0x200000 (the THROW_ITEM / FIRE_BALL group, §20: the catch); at t ≥ 3 − 0.05 × pace: empty hand → the item goes back into the inventory and the hand (`0x0046B000`), else (`0x004C0ED0`) it strikes the wielder (`0x004C0A50` on him) and falls as a ground item (`0x0043D880`) 5 ft above him; the loop sound stops and the axe returns to the pool (`0x004838D0`, `0x00483290`).

Implemented: `server/src/simulation/boomer_axe.ts` (zone: weapon unarmed while it flies), `client/src/engine/boomer_visuals.ts`.

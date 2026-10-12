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
- If the player survives: `v = 0.5 × random + damage / hpBefore`; `v ≥ 0.8` → heavy stagger (physics flag `0x80000`), `v ≥ 0.7` → light flinch (state `0x4000000`).

### 8.5 Shield block — `Stats_TryBlockWithShield` (`0x0044D5E0`)
Only while the shield-raised states (5 or `0x1D`) are active: block if the dot product between the defender's facing and the direction to the attacker is greater than `cos(30.0)` — evaluated with **30 radians**, i.e. ≈ 0.154, a frontal cone of about **±81°** (very likely meant as 30°; reproduced as-is for parity). A successful block calls the shield's Use action.

Implemented as pure functions in `shared/src/game/original_stats.ts` (`originalDamageTaken`, `originalFlinch`, `ORIGINAL_BLOCK_COS`) with tests. Item data: `converter/src/formats/items_ctx.ts` parses `script/items.ctx` (156 items, inheritance resolved) into `rules/items.json`.

---

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

### 9.2 Creature stats
- Creature stats share the player's damage pipeline (§8) except vtable slot 45, which is empty for creatures: **creatures do not apply the Might multiplier or the stronger-of-slash/bash rule** — they deal the weapon's whole damage vector (unarmed `DD` row + weapon), × attack mode, + bonus, × multipliers. Skeleton Warrior with a Long Sword therefore hits for 10 slash (9 after the medium resist).
- The creature constructor (`CreatureStats_Ctor` 0x0044C130) defaults HP/max HP to 20. Saved creature state (`CreatureStats_Save/Load`) contains HP, max HP and the disposition pair (`+0x1D4/+0x1D8`, default 3 = hostile; the Spectral Ally spell sets 6). HP, XP value and resists of placed creatures come from the `.cap` object records (asset-format-discovery.md §6.2).
- `Stats_LoseHp` (0x0044CA00): the flinch/stagger roll (§8.4) only runs when the victim is the player; a hit from creature type 150 (Necros) always forces the light flinch.
- On death (`CreatureStats_OnDeath` 0x0044C6A0) the creature's XP value (`+0x1C4`) is passed to the player via `Stats_AddExperience`, the death sound for its type is played and spell effects are released.

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
View window ±100 × ±75 at distance 120 (`+0x244..+0x250`, `+0x220`): a fixed **horizontal** field of view of 2·atan(100/120) ≈ 79.6°, the vertical extent following the viewport aspect (`0x0042E5D0`). Near 0.5 ft, far 1600 ft (`+0x16C/+0x170`, far clamped to 15–2000).

### 10.4 HUD screen size
Numpad +/− change a screen-size step: with the HUD shown the 3D view uses the top three quarters of the screen, and each step insets it by 16 × 9 pixels (`0x00468960`).

### 10.5 Controls (game Readme)
ESDF movement (E forward, D back, S/F strafe), arrows / numpad 4-6 rotate, numpad 9/7/5 look up / down / centre, mouse free look, Space jump (with a direction: directional jumps and flips), C crouch (with a direction: rolls), Shift + direction walk carefully. LMB attack (combos by repeated taps; C/Space/E/S/F + LMB select crouch, jump, overhand, left and right attacks), RMB block, Space + RMB shield rush, Tab interact, R cast, Z use item, W/T/Q cycle weapon/spell/item, A quick select, I inventory, M map, H health potion.
CrusadersOnline moves the scheme to WASD (`client/src/input/keybindings.ts`); keys displaced by the shift go to the nearest free key (next weapon → E, quick select → X).

Implemented (superseded by the measurements of §14): forward or jump + click plays `ASM_JUMP_ATTACK`, left / right + click Drake's side swings (`PN09`/`PN10`), plain clicks the five-swing ASM combo; directional swings are single hits outside the combo chain. The attack-mode scale `0x0044CDD0` (1.0 / 1.25) is chosen per difficulty, not per attack, so the swing kind changes only the animation. The feet stay planted during the player's swing, and on diagonals the body turns 45° into the motion and keeps the run (or retreat) cycle and speed instead of sliding sideways. Both rules are CrusadersOnline's reading of the original's look (user playtest); they are not recovered from the executable.
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

Rolls (C + direction; `ASM_ROLL_F/B/L/R`): forward 10.73 ft in 25 frames, back 10.96 ft / 25, left 10.80 ft / 27, right 9.99 ft / 25 (`ORIGINAL_ROLLS`). A roll runs its full length once started. C alone ducks in place (`ASM_CROUCHING`, `PE02_dk_cvr`).
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

---

## 14. Animation State Machine, Clip Rate and Melee Timing (x32dbg, 2026-10-11)

**Animation controller.** The character's `+0x48` object (vtable `0x004DEDC8`) holds the current ASM state id (`+0x14`), the next state (`+0x18`), the clip (`+0x1C`), the clip time in frames (`+0x24`), the clip start / end (`+0x30` / `+0x34`) and a rate (`+0x28`, 1.0 with the starting axe).

**State ids.** The table at `0x004EA6F0` is (id, name) pairs: 113 named states, e.g. 1 RUNNING, 2 WALKING, 7 STANDING, 8 STANDING_JUMP_V, 9 STANDING_JUMP_F, 10 RUNNING_JUMP_F, 11/12 STANDING_JUMP_L/R, 20 STANDING_JUMP_B, 23 CHOP_LOW, 24 SWING_LEVEL, 25 SWING_OVERHEAD, 29 BLOCK, 68 COMBAT_STANDING, 89 THRUST, 90 JUMP_ATTACK, 91 IMPACT_MEDIUM. Ids 0, 18, 31–33, 87, 88 and 102–110 have no name (engine-internal states: 87/88 appear with side attacks, 103/104 are combo steps). The physics "jump kind" of §13 is this state id.

**Clip playback rate.** Measured over 49 clip segments of the running game: **33.6 frames/s** = 1000/30 × the level-1 speed multiplier (1.009, §7.2). Clips therefore play 10/9 faster than their 30 fps authoring rate (this settles UNK-012's playback question), and every root-motion speed of §11 is × 10/9 (run 17.3 ft/s).

**Melee timing.** Attack clips carry `SWING`, `IMPACT` and `RECOVERY` events (e.g. PN02 swing level 7 / 8 / 13 of 23 frames; PN01 chop low 14 / 16 / 19; PN03 overhead 10 / 12 / 16; PN16 5 / 10 / 17; PN17 11 / 12 / 23; PN09 / PN10 side swings 5 / 8 / 14 and 8 / 9 / 14; PN05 jump attack 17 / 20 / 24). In play, the next combo swing starts about 3 frames after RECOVERY.

**Combo chain** (`0x0042CA20`): a click after 10 % of the current swing queues the next one: SWING_LEVEL (24) → CHOP_LOW (23) → SWING_OVERHEAD (25) → 103 → 104, then the chain ends (a second chain 105 → 106 → … exists). By clip length, 103 and 104 play PN16_1_chn_atk_b and PN17_1_pwr_atk (models.ctx "COMBO 4" / "COMBO 5"). The 1.25 attack-mode scale of §8.2 is set per difficulty (`0x0044CDD0`), not per combo step.

Implemented: `attackTiming()` in `shared/src/game/combat.ts` (hit window ends on the IMPACT frame at 1000/30 fps, scaled by weapon Speed), a five-step combo with equal attack mode, the ×10/9 speeds and roll timings, and original avatars playing every clip at 1000/30 frames per second. **Attack keys** (measured, one key per capture): a plain click starts the five-swing combo; W + click while running and Space + click give ASM_JUMP_ATTACK (PN05, the leaping attack); A / D + click give the side swings (states 87 / 88, which use the two adjacent clip objects PN09 "Swing Left" / PN10 "Swing right"); C + click leaves the crouch and starts the normal combo (no separate crouch attack). The Readme's "E + LMB overhand" does not match the engine's behaviour; THRUST (89) was not reproduced on purpose and is left unbound.


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

Implemented in the server AI (`world_zone.ts`, constants in `combat.ts`): the distance bands, the 1.0 s hop with 25 % no-swing, the leaping strike, the jab at ≤ 4.8 ft, retreat until 8 ft (30 %), chains 1/2 with the cycle order, the 0.5 s stance with a 55 % 0.82 s shield that blocks frontal hits, and no reactive block (kept as an optional, non-original feature: `WorldZoneOptions.reactiveBlock`, off by default, using the archetype's `blockChance` / `blockTicks` / `blockCooldown`).


### 14.2 Moving with the shield up (2026-10-12)

Sampled the player's ASM state and pose while holding the shield (right mouse button) and moving: forward → ASM_WALKING at 5.65 ft/s (the careful-walk speed), backward → ASM_RETREAT at 4.34 ft/s, sideways and diagonals → repeated ASM_HOP_L / ASM_HOP_R side hops (PC09 / PC10) with short stands in between, ~6–8 ft/s on average. Standing still with the shield up plays ASM_BLOCK (PE07).

Implemented in the shared movement step and `movementAnim()`: shield + forward / back use the careful walk / retreat speeds and clips; shield + a sideways key (or a diagonal, hopping along it at 45°) performs discrete side hops — 12 ticks covering the clip's 5.75 / 4.94 ft (left / right), then a 0.2 s stand with the shield up — repeated while the key is held. The hop and stand are timed movement actions (ids 5–7 next to the rolls), carried in the reconciled snapshot like a roll.


### 14.3 Root-motion profiles for timed actions (2026-10-12)

Side hops and rolls move by their clip's root motion, which is far from uniform (e.g. PC09: ~0.13 ft per frame for 4 frames, ~1 ft per frame over frames 4–10, settling by frame 15, still to frame 20; PE05 roll right covers 6 ft in its first 6 frames). The shared movement step now samples each clip's per-frame root displacement (`SHIELD_HOP_*_CURVE`, `ROLL_CURVES`, extracted from Drake's clips) at 1000/30 frames per second, tick by tick, instead of moving at the average speed.


### 14.4 Standing idle and shield stance (2026-10-12)

Standing still — with or without the shield held — the player's ASM_STANDING state plays one and the same clip whose header length is 170 frames (`+0x14`). Drake's relaxed idle PA16 has 90; the 170-frame idle matching the stance is PA21_id_br ("idle combat", ASM_COMBAT_STANDING), the shield-forward combat stance. The client uses PA21 for Drake's idle.

**Shield layer.** The animation controller has a second channel (`+0x48` clip, `+0x4C` time, `+0x58` end, `+0x60`/`+0x64` layer state, `+0x6C` weight). Holding the shield sets it to state 5 (one of the shield-raised states `Stats_TryBlockWithShield` checks, §8.5) with weight 1.0, playing PE07_blk ("Shield Block", 27-frame header) once and holding its last frame, while the main channel keeps its clip (the idle continues, uninterrupted). Releasing the shield clears the channel. Implemented: original avatars play PE07 on the upper body only (Bip01 Spine and below) and switch the main clip to a legs-only version while the shield is up, without restarting it; the shield state is replicated in the entity flags (bit 0) for players blocking and creatures guarding.

**Attacks move the character (2026-10-12).** The root bone of Drake's attack clips ends away from its start in four of them: combo step 1 PN25 (+3.85 ft forward), step 3 PN15 (the spin, +3.43 ft), step 5 PN17 (1.6 ft back during the wind-up, then +2.16 ft) and the jump attack PN05 (run / jump + click, +6.26 ft); the other swings sway and return to the start (net zero). Implemented as timed movement actions (ids 8–11) in the shared movement step that follow each clip's forward root curve tick by tick; the client sends the attack motion in the input bits of the swing's first step, so prediction and server agree.

Also observed: the third combo step (SWING_OVERHEAD) plays backwards after its impact (clip time 10.8 → ~8 within the same state) — a weapon recoil, not reproduced yet.

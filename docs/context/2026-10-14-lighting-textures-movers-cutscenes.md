# Enhanced lighting, level textures, brush movers, Ursan's scene; agent rules

Date: 2026-10-14 · Agent: Claude Code · Commit: Agent rules and context notes (simplified SDD) · Covers the work of commits 8a5e4e1..7881567

## Why
First context note: the state left by a long session (lighting, texture fidelity, decompiled
movers, Ws9a cutscene fixes) and the new rule that every commit carries a note.

## Decisions and evidence
- **Level textures: one picture every 15 units** (`converter/src/emit/gltf_level.ts`), as brushes.
  Across all 25 .msh files 23–53 % of face texture coordinates fall on multiples of 15 (chance
  ~0.3 %); fit-once pieces (cobwebs, `Cor_ML_001x4` grates, `Cor_ER_049_*` path pieces) span 0–15.
  The old 32 texels/unit was tuned by eye and drew everything ~3.75× too small.
- **v = 0 is the picture's bottom row** (TGA rows as stored, bottom-up in 2043/2044 files). Proven
  by Ws_a's path pieces: only flipped does the T open towards its corridor and the bend turn in.
- **Alpha**: 17 of ~600 level textures carry it; binary alpha → cutout, soft → blend (read from
  the texture at load). Brushes too, applied when their texture finishes loading.
- **Brush faces are single-sided**, wound outwards from the brush centre (original culls back
  faces); double-sided showed a grate's far side through its near side.
- **Mover (decompiled)**: segment dispatch `0x490210`/`0x490180`: low 3 bits move (`0x48F350`),
  0x08 turn about X through (y,z) (`0x48F630`), 0x10 about Y through (x,z) (`0x48F960`, doors),
  0x20 about Z through (x,y) (`0x48FC90`). State machine: use `0x48EC10`, update `0x48EFC0`,
  advance `0x48F170`, end of segment `0x48FFC0`, end of path `0x4900C0` (8 modes). Implemented in
  `shared/src/arena/mover.ts`; docs in asset-format-discovery §6.2.3.
- **Relays (type 0x2B) name the brush they move in the dword just before their record**
  (Ws9a 159982 → `bCellDoor`, 159370 → `bOuterGates`; Ws1a/5a, Co*a, Ws2–4a). Converter 1.18.
- Original sequence start (`0x41F830`) leaves the stand-in where the player stood.

## Deviations from the original
- Enhanced lighting (setting, off by default): dynamic point lights, ambient cube on models,
  HDR + faint bloom + highlight shoulder. Classic path untouched.
- Cutscenes cannot be skipped (Esc does nothing during one).
- In a sequence, relay-moved brushes move **for that player's client only**; the shared world's
  stay as they are (else the next player's Ursan scene finds the door already open).
- **Staged sequences**, always on: when a sequence does not walk Drake, he is put where another
  actor first turns to face (`stagedPlayerSpot`; Ws9a, Co1a, Gl2a). Ursan's scene also turns him
  to face the wall (`stagedPlayerYaw`, a one-entry table).

## Not done / not decoded
- What starts platforms, crushers, wheels, gears, chandeliers, `bTortTop`: no relay points at them.
  They have movers but stay at rest.
- Lever → gate links are still the project's own rule ("levers open all gates of the act"); the
  lever's relay (likely fired at its segment end, owner vtable +0x108) is not wired.
- Mover collision push/stop (flags 0x200 / 0x80) not reproduced: closing movers hold instead.

## Gotchas
- Converted assets are cached by the manifest version (`converter/src/pipeline.ts`): any change
  to emitted data needs a version bump, or `pnpm convert` serves the old files.
- Placements are in a **Z-mirrored frame**; mover keys are mirrored per segment type (turns about
  X/Y negate the angle, about Z keep it; every z negated).
- HDR target: stencil on, but **never resolve depth/stencil** from MSAA (cost ~20 ms/frame on
  ANGLE). Shadows blend in linear light there: opacity is compensated.
- Ghidra MCP is often down: run Ghidra headless read-only (`C:\Users\Lencina\Documents\ghidra_12.1.4_PUBLIC`,
  project `C:\Users\Lencina\Desktop\CrusadersDecomp`). Mover code is vtable-only: create functions
  in memory before decompiling.
- The in-app browser pane reaches the user's dev server only at `http://[::1]:3000`.
- Cutscene tests: a guest spawned straight into a trigger keeps the entry fade black.

## How to verify
- Ws9a: cell gates with four big squares and see-through; the Ursan scene: Drake by the door facing
  the wall, the push-plate clip at ~9.5 s, the door rising at ~10.5 s (new character each time).
- `tests/unit/mover.test.ts`, `tests/unit/doors.test.ts` (lever → gate, return after delay).

## Follow-ups
- Decode what fires the scenery movers and the lever's own relay; then drive gates from relays.

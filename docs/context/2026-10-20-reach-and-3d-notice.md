# Pick-up reach and creature noticing as the executable has them

Date: 2026-10-20 · Agent: Claude Code · Commit: Pick-up reach and creature noticing measured in 3D as the original does

## Why
Two fidelity stand-ins from the parity audit:
- interaction reach (2.5 m flat, ±2 m of height);
- the creatures' same-floor filter (±3 m).

## Decisions and evidence
- **Ground reach:** `0x00471940`, the ground window, the same list the use key and Ctrl+G
  show, takes items, chests and corpses whose squared 3D distance to the player is under
  `[0x4E16A0]` = 96.0 ft².
  - Now `GROUND_REACH` = √96 ft ≈ 2.99 m in 3D: client prompt, ground panel, and the server
    check (+0.2 m slack).
  - Talk stays 12 ft (0x40DEB0). Doors use their triggers' volumes.
  - The searches `0x437A70` / `0x438649` are generic segment queries (BSP, physics), not the use
    key.
- **Noticing** (`0x40D910`): every range is a squared 3D distance (49 / 10000 / 400 ft²). The
  2D range and the `AGGRO_HEIGHT` filter are gone from the hostile pick. The ray (0x406AF0)
  still blocks floors between stacked rooms.

## Not done / not decoded
- `nearestFoe` (0x40DC90), the call to idle hostiles and the citizens' wariness keep
  `AGGRO_HEIGHT`. Their originals were not checked for a height band.

## Gotchas
- A creature right under a thin floor within 7 ft (2.1 m) notices without a ray, as in the
  original.

## How to verify
- `pnpm test:unit` (close_notice: 7 ft through a wall, 14.8 ft behind a wall not).
- In game: a ground item shows "Tab — pick up" from about 3 m, measured in 3D.

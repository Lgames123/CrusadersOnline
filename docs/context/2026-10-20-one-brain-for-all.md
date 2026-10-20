# Every hostile creature fights with the same brain (settled)

Date: 2026-10-20 · Agent: Claude Code · Commit: Creature AI settled from the brain dispatch: one combat brain for every type, no archers

## Why
The parity audit listed "the AI of the other creatures (the skeleton's)" as a stand-in.

## Decisions and evidence
- The brain dispatch `0x408C40` switches on the brain mode (+0x6A) and a selector (`0x4190E0`):
  - `0x409520(…, 1 / 0)`: the melee brain (§15.3) for combat, every type;
  - `0x409010`: the talk mode;
  - `0x40B540`: the stroll (timed walk points, `0x40B730` / `0x40B9D0`).
  - There is no per-type combat brain. What differs between types is data, already
    implemented: engage distance (0x40EA30), spell masks, scale, shields, loadouts.
- **Archers:** six creatures hold a Dasher Hand Bow (Cs5b's four Dasher Scouts and Tamris,
  Du1c's DasherBrute4). SHOOT fires only with an Arrow in the inventory (`0x00474E50`). None
  carries one, and no level holds one, so none ever shoots. They fight in melee, as here.
- No code change: the server's brain was already the decompiled one for all types.

## Not done / not decoded
- `0x4190E0`, the selector between the melee arguments 1 and 0, isn't decoded. The server uses
  one variant.

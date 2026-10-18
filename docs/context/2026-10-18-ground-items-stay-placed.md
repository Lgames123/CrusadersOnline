# Ground items stay where they are placed

Date: 2026-10-18 · Agent: Claude Code · Commit: Ground items stay where the level placed them, as in the original

## Why
The quest-item audit (2026-10-18-placed-quest-items.md) found ground items floating or outside the collision mesh, and it wasn't known whether the original drops them to the floor when a level loads.

## Decisions and evidence
- The original never moves a ground item. Items (fixup list 0x35, loader 0x476F20) share props' components. Their physics component, cap type 0x63 (vtable 0x4DFCD8), has an empty step (+0x34 = 0x402840) and zero velocity. A creature's (0x5D, vtable 0x4E24FC) integrates at +0x34 (0x48DD50). The load only initialises the item (0x458350) and links it to its cell (0x483800). There is no floor snap. Details are in executable-analysis.md §21.
- So the flagged items keep their placed position, with no move and none left out. Measured with floorAt: Ca1c #212, Ca2c #197 and Ca3c #197 Broad Sword at 1192 ft over a floor at 1144. Ca3c #194 potion 13 ft up. Cs3b #34 potion 64 ft up. No floor at all under Ca1b #44, Ca1c #203, Ca2a #43, Ca3d #117 gold, or Cs3a #0–4 (z −40…−62 ft, beyond the mesh edge at −94).
- buildLevelArena carries a comment on this, and a unit test holds positions as placed. The client already draws items at their placement, so nothing changed there.

## Not done / not decoded
- The original's pickup reach wasn't traced, so it's open whether the floating swords can be taken in the original (here, pickup uses our own reach rules).
- Whether the original draws off-cell objects is still open (0x483800 falls back to the default cell `[0x53C4C0]`).

## How to verify
- `pnpm test:unit`: level.test.ts "keeps ground items exactly where placed".

## Follow-ups
- If unreachable items should go anyway (a non-original QoL choice), make it an explicit option. Don't treat it as a fix.

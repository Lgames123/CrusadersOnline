# The prison's crystal: travellers arrive outside the cell

Date: 2026-10-20 · Agent: Claude Code · Commit: Waypoint arrivals must walk back to the area's start (Ws9a crystal in a barred cell)

## Why
User report: the Ws9a (prison) crystal stood inside a cell, and Drake arrived inside it with no way out. The user's ruling was that the crystal may stay in the cell but Drake must appear outside it.

## Decisions and evidence
- Cause: `waypointSpot` searches rings around `respawnPoint` for a flat floor and never checks walls.
  - Drake's start (666.5, −475.5) is in an open cell: a ray to the corridor at x 660 hits nothing.
  - The first good floor was the next cell north, at (666.5, −481.5). Its bars to the corridor (x ≈ 663.5) are static mesh (2 crossings).
  - `bCellDoor` is a different cell (x 635–639, z −502.8).
- New rule: an arrival must **walk back to the area's start**. Its straight segment to `respawnPoint`, or one through an axis-aligned corner, must cross no mesh triangle (Möller–Trumbore at 0.9 m and 1.6 m).
  - The arrival search keeps the old 8 spots at 1.8 m first. Then it tries 2.5 / 3.5 / 4.5 / 6 / 8 m in 16 directions; these farther spots also need 0.7 m clear all round (`roomy`).
  - The crystal's own placement is unchanged.
- Checked over all 79 waypoint acts, before and after: **only Ws9a changed**. Its arrival went from (664.7, −481.5) to (662.0, −481.5), in the corridor, facing the crystal through the bars.
- `crystalReach` (waypoints.ts): when the arrival is out of the crystal's reach, it may be used from the arrival spot too. Server (`waypointTravel`) and client (the Tab prompt) share it. WORLD_ENTER `waypoint` now carries `arrival`.

## Gotchas
- The triangle set gathered around the start now reaches RINGS max + ARRIVAL_GAPS max + 3 m, so the farther segments see their walls. Shrinking it would let far arrivals pass through unseen walls.
- Movers (cell doors, gates) are brushes, not mesh: `open` does not see them, but `clear` keeps 1.2 m from their hulls.

## How to verify
- `npx vitest run unit/waypoints.test.ts` (in tests/): the Ws9a case, plus the 1.8 m rule everywhere else.
- Live, checked: launch `dungeon-server` + `dungeon-client`, play as guest, open the crystal map → Stronghold (west) part 1 (WS9A). Drake stands in the corridor before the bars, with the Tab prompt.

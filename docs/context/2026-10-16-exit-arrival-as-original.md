# Exit crossings and arrivals as the original

Date: 2026-10-16 · Agent: Claude Code · Commit: Exit arrivals as the original: entry point plus crossing offset, heading kept · Supersedes: 2026-10-15-zone-transfer-continuity-and-connectivity.md, 2026-10-15-zone-transfer-arrival-and-facing.md, and the stair/landing volumes and arrival parts of 2026-10-14-citadel-portal-network-fixes.md

## Why
Ci9a -> Ci9b sent Drake to a wrong place (Ci9b's start point 2, then the invented landing volume to Ci1b), other maps put him before the trigger, and the heading after a transfer made W walk back. The two earlier attempts guessed the arrival; this one is decoded.

## Decisions and evidence
- Arrival (0x462890 exit touch, 0x44EE60, 0x476F20 load, type-0x13 fixup): offset = feet minus the exit's point (trigger +0x44 = portal `position`); destination = the exit trigger whose entry number (+0x0F) equals the exit number, its point + offset; heading unchanged. Exit flag 2 (+0x0E): start point `exit` with its heading instead. Entry flag 4: the point without offset (no exit uses it). `exitArrival` in shared/src/arena/level.ts; the crossing travels as `ExitCrossing` (worker -> sessions -> join `arrivingVia`).
- "Exit number = start index" (893071a) was wrong: numbers like 98/103/113 exceed the tables; only flag-2 exits use starts.
- Volume test (0x4394F0): feet <= top and feet >= bottom - height, body radius against the edges. Plane A (+0) is the top, B (+0x10) the bottom (normals +Y in the Caps). Creatures are placed at floor height (195/205), so the position is the feet. Without this, Ci1b..Ci4b -> Ci*a (844-856 over steps at 841/857) could not be reached.
- The Citadel tower is one spiral in both meshes: ci_a = ci_b + (0, 36, 16) ft (mirrored z: -16). Ci*a's original strip (872-888) fires going DOWN from the balcony; Ci*b's fires going UP. "Going up should trigger" (the first report) was not the original; the stretched 872-1040 volume fired at the balcony and dropped the player in empty space.
- Exits with no volume are never walked in the original (scripts load them). Converter marks those on the same mesh `scripted` (Ci*b next act, Ci3b<->Ci4b, Co1a<->Co8a, Co3a<->Co9a, Du1c<->Du8c, Du2a<->Du9a, Gl4c); the server skips them. The invented Ci*b landing volumes are removed.

## Deviations from the original
- The Cs<->Ci gates of acts 1-3 stay walkable (always on): volumes copied from the same gates in Cs4a (1992..2104, -1680..-1692) and Ci9a (1990..2072, -1210..-1224); Ci1a -> Cs1a arrives as Ci9a -> Cs1a (flag 2, Cs1a start 0).

## Not done / not decoded
- Drake's real height (+0x68) is not read; PLAYER_HEIGHT (1.85 m) is used.
- Volume-less exits to another mesh still use the 1.6 m cylinder (Cm2b -> Co2a, Co2a -> Cm2b, Du2c -> Du3c, Gl1b <-> Gl2a, train, Ws5a -> Bs1a): probably scripted too, unchecked.
- Du1b/Du2b/Du3b/Du9b -> Du1c: no floor touches the volume edge in a sweep (unchanged by this work).
- Cs3a -> Ci3a lands on Ci3a's start 0, inside the copied gate volume (join counts it as entered: no bounce).

## Gotchas
- Placements are rewritten on every `pnpm convert` (no MANIFEST_VERSION bump needed for placement-only changes); the earlier note said otherwise.
- `inPortal` now includes PLAYER_RADIUS and the height: callers that passed margins for "near" checks get 0.4 m more.
- A player arriving inside a trigger is marked as already inside (join): it fires only after leaving and re-entering.

## How to verify
- `pnpm test:unit` (tests/unit/portals.test.ts: body test, original stair volumes, ci9a <-> ci9b offset (0, -36, -16) and heading kept, flag-2 start, every exit's entry).
- Isolated server (skill test-cutscene-isolated) `ARENA=level:ci9a`, `DEV_GUEST_SPAWN=626.669,266.548,-411.480`, yaw pi/2, hold W: ci9a (2041.8, 872, -1350) -> ci9b (2033.7, 835, -1364), heading kept. `ARENA=level:ci9b`, spawn `631.978,256.946,-409.651`, yaw 0: -> ci9a (2062, 877, -1336.6).

## Follow-ups
- Read Drake's +0x68 height live, and check whether the volume-less cross-mesh exits above are scripted.

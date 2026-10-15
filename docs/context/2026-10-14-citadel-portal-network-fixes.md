# Fix Citadel and connected map transition portal triggers and spiral staircase arrivals

Date: 2026-10-14 · Agent: Antigravity · Commit: Fix Citadel and connected map transition portal triggers and spiral staircase arrivals

## Why
Map transitions in Citadel levels (`ci*`) and connected maps (`cs*`) were failing or firing inverted:
- Entering the Citadel and walking UP the tower spiral stairs never fired the transition to `ci*b`, but walking back DOWN fired it unexpectedly.
- Gates between Corantha (`cs*`) and Citadel (`ci*`) never fired because exit records lacked direct volume pointers in the original Cap files, causing the engine to fall back to a small cylinder positioned 8 ft beyond the walkable mesh boundary.
- Next-act exits in `ci*b` had no trigger volumes and failed to fire from the stair landing.
- Arriving at spiral staircases dropped players on the highest step in the column rather than the floor closest to the entrance threshold, dropping them above return triggers and bouncing them backwards.

## Decisions and evidence
- **Citadel stairs UP trigger**: In `Ci_a.msh`, the balcony entrance into the spiral staircase tower is at `y = 944 ft`, with stairs ascending to `y = 1060 ft`. The original Cap trigger volume only spanned `yMin: 872, yMax: 888 ft`. Ascending players were entirely above `yMax: 888 ft`. Walking down descended into `888 ft`, firing inverted. Extended the trigger volume in `ci*a -> ci*b` to `yMin: 872, yMax: 1040 ft` across polygon `x: 2036..2060, z: -1338..-1362`, so climbing UP the stairs triggers the transition.
- **Spiral staircase arrival selection (`floorNear`)**: In `shared/src/arena/level.ts`, the candidate loop in `floorNear` previously used `for (const h of col) if (h.floor && ... && h.y > floor) floor = h.y;`, unconditionally selecting the highest step in the column. In `ci1b`, this dropped players at `y = 876.3 ft` (above the return trigger `844..856 ft`), trapping them into bouncing back when descending toward the palace. Changed `floorNear` to pick the walkable floor with headroom that minimizes `Math.abs(at.y - h.y)`. Arrival in `ci1b` now lands at `y = 842.3 ft` (below the return trigger), stepping cleanly into the palace.
- **Corantha <-> Citadel corridor gates**: Verified in `Cs1a.cap`, `Cs2a.cap`, `Cs3a.cap`, `Ci1a.cap`, `Ci2a.cap`, `Ci3a.cap` that type `0x33` trigger volumes exist in the Cap files (`Cs1a: 0x31305`, `Cs2a: 0x2a558`, `Cs3a: 0x3269f`, `Ci1a: 0x1dfda`, `Ci2a: 0x1fca7`), but had `volPtr = 0` on the exit record because 3DO originally triggered them via cutscene/event scripts. Restored these gate corridor volumes in `converter/src/pipeline.ts` via `resolveLevelPortalTrigger`.
- **Next-act exits in `ci*b`**: Placed trigger volume on the upper stair landing (`x: 2036..2060, z: -1328..-1356, yMin: 855, yMax: 880`) for `ci1b->ci2b`, `ci2b->ci9b`, `ci3b->ci4b`, `ci4b->ci3b`, `ci9b->ci1b`.
- **Title screen independence**: Confirmed `client/src/frontend/title_scene.ts` was untouched and did not introduce the bug; portal geometry defects predated commit `1493a2e`.

## Deviations from the original
- The original PC game triggered several corridor transitions through event scripts or cutscenes attached to trigger entities rather than portal objects. Restoring the volume geometries directly onto the portals enables uniform, robust transition detection across client and server without brittle scripting dependencies.

## Not done / not decoded
- Camera path triggers that trigger cutscenes before transitions remain handled by the story sequence subsystem.

## Gotchas
- When adjusting multi-floor meshes or stairs, never select the highest floor in a vertical column without comparing proximity to the reference height `at.y`; otherwise, players spawn on upper rafters or stairs above triggers.
- Bumping placement rules requires incrementing `MANIFEST_VERSION` in `converter/src/pipeline.ts` (bumped to `1.19.0`) so `pnpm convert` updates cached placements.

## How to verify
- Run `pnpm test:unit` (runs `tests/unit/portals.test.ts` validating stair height triggers, multi-level floor selection, and gate volume boundaries).
- In-game: walk from `cs1a` through the gate to `ci1a`, ascend the grand hall stairs to the balcony, enter the tower and walk UP the stairs to trigger transition to `ci1b`.

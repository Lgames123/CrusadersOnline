# Respawn at the beginning of the area

Date: 2026-10-17 · Agent: Claude Code · Commit: Players respawn a few metres past the trigger they came in by

## Why
A dead player came back at `nextSpawnPoint()`: large floor triangles near hostiles, cycled, unrelated to where the level begins.

## Decisions and evidence
- `respawnPoint` (shared/src/arena/level.ts), fixed per player at join (`respawnSpot`, cached per way in): the entry that placed him (same lookup as `exitArrival`: entry number = exit, else the exit back to `fromArena`) → `arrivalNear`: floor 1.2-18 m outside that trigger, facing inward, clear 4 m ahead, outside every trigger.
- Through a flag-2 exit, that start point; new game / login / no exit: start 0. Every act has starts.
- Start 0 has no floor within 4 m in Du1b/Du2b/Du3b/Du9b (7.5 m above) and Ws4a (6.6 m under a floor, likely on a brush): those fall back to past their lowest-numbered entry (Du*b from Du*a, Ws4a from Cs4b).
- `arrivalNear` treated down-facing triangles as floor (`Math.abs(ny)`): Ci*b <- Ci*a, Du1c <-> Du8c, Gl4c landed on ceilings. Now up-facing only, as `floorAt`. This also changes the arrival fallback when an entry point has no floor.
- After a respawn the triggers he stands in are marked entered (as at join), so a respawn never fires an exit.

## Deviations from the original
- Not original (the original reloads a save on death); always on.

## Not done / not decoded
- Facing is not turned: player yaw is the client's input every tick (world_zone step), so the camera keeps its heading.
- `catchFall` still uses the nearest spawn point.
- Not checked in a live game: covered by the unit sweep (every act x every way in) and the zone death test.

## How to verify
- `pnpm test:unit`; `RESPAWN_REPORT=1` with `unit/portals.test.ts` prints each act's spot per way in.

## Follow-ups
- Send a yaw to the client on respawn so Drake faces into the level; use the respawn spot for falls too.

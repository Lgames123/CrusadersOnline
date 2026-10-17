# Falls and logins use the respawn spot

Date: 2026-10-17 · Agent: Claude Code · Commit: Falls and dead logins land at the respawn spot; logins otherwise stay put · Supersedes: the catchFall and login parts of 2026-10-17-respawn-at-area-start.md

## Why
Falling out of a level still dropped the player at the nearest auto spawn point. The user's rule for logins: don't move the player unless he was dead or out of bounds.

## Decisions and evidence
- `catchFall` (below the lowest geometry by 20 m) → `toRespawnSpot`, the same as a death respawn (exit triggers there count as entered).
- Login with a saved position: kept, unless saved HP is 0 (logged out dead; persistRecord saves `ceil(hp)`, 0 when dead) or the position is below the fall limit → respawn spot. A login has no exit, so that is start 0 (or past the lowest entry, see respawnPoint).
- No saved position (new character) or an invalid one: start 0, as before (0x476F20 new game).

## Gotchas
- Tests that put a player off the synthetic floor (±20 m) now see him land at (0, 0), on top of whatever the test spawned there: npcs.test.ts moved its far-away player onto the floor.
- integration/combat "kills the skeleton" can hit its 20 s timeout under the full integration run; it passes alone (also before this change). integration/persistence's restart test hung under a 100 s cap in the earlier run (not investigated).

## How to verify
- `pnpm test:unit`: combat.test.ts "logs in where he left, unless he was dead there or below the level; a fall lands at the respawn spot".

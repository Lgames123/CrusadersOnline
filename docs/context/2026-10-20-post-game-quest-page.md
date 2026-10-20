# The quest book points finished characters at the dungeons

Date: 2026-10-20 · Agent: Claude Code · Commit: Quest book's post-game page sends finished characters to the dungeons

## Why
After Necros the quest book had nothing left to say. The user asked for it to tell the player to try the dungeons.

## Deviations from the original
- Not original, always on: with the stats' `storyComplete`, Assigned opens on a page of our own text. It is not in the string table. With `mmoDungeons` it names `DUNGEONS` and says to use a waypoint crystal (the list under the map); without it, it only mentions the crystals.
- The end-of-story notice (`storyEnds`, the last scene of Cs5b) adds a dungeon line when `mmoDungeons` is on.

## Gotchas
- `main.ts` reads the first stats at line ~965 (`session.playerStats`), before the `stats` handler fires. Anything driven by `storyComplete` must be set there too.
- Fixed a bug in the same path: `refreshCrystal` read `session` during the first `enter`, before `session` was assigned. The temporal dead zone threw, which cut that `enter` short (no `endEnding`/fade). It now reads a local `storyComplete`.

## How to verify
- Launch configs `dungeon-server` + `dungeon-client`, play as guest, F2: the page names The Crypt of the Catacombs (seen live).

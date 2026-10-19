# No "click to play": the game takes the pointer back itself

Date: 2026-10-19 · Agent: Claude Code · Commit: No click-to-play hint: Resume and closed windows take the pointer back themselves

## Why
Request: Esc then Resume should put the player straight back in the game, not on the "Click to play" hint.

## Decisions and evidence
- The hint (`#click-hint`, `updateHint`) is gone. `InputManager.wantsLock` (set in `main.ts`: no Alt cursor, chat line, options, window or sequence) says when the pointer belongs to the camera.
- Why Resume failed: Chrome refuses `requestPointerLock` for about 1 s after the player left the lock with Esc, even inside a click. `requestLock` now retries every 300 ms (8 tries, ~2.4 s) while `wantsLock()` holds; the Resume click's transient activation (~5 s) covers the retries.
- Fallback: with no lock while `wantsLock()`, any key (not Esc, not in a text field) asks again, as does a click on the world (as before). Esc keydown is not a user activation in the HTML spec, so resuming with Esc can need that extra key or click.

## Deviations from the original
- Not original (a browser constraint); always on.

## Gotchas
- A new `requestLock` cancels a pending retry; the retry re-checks `wantsLock()`, so opening a window during the retries stops them.
- Without the hint, a refused lock shows only the free cursor: no message tells the player to click.

## How to verify
- In game: Esc, then click Resume at once: the camera follows the mouse again within ~1 s, no click on the world.

# Hold Alt for the cursor

Date: 2026-10-17 · Agent: Claude Code · Commit: Holding Alt lets go of the camera and shows the cursor

## Why
Request: holding Alt releases the camera and brings the mouse up; letting go takes the camera back.

## Decisions and evidence
- `altFree` in `main.ts`: Alt keydown while locked exits pointer lock as one of "ours" (no options menu, no click hint); Alt keyup re-requests the lock unless a menu, panel or cutscene is up. Window blur (Alt+Tab) drops the state, the click hint then shows.
- Re-locking on keyup has no user gesture: allowed because the page itself released the lock with `exitPointerLock()` (Pointer Lock 2.0). If a browser refuses, the click hint shows and a click takes it back.
- Skipped when the player has bound that Alt key (`InputManager.isBound`).

## Deviations from the original
- Not in the original (no cursor in play there); always on, as a modern QoL.

## Not done / not decoded
- While Alt is held the game gets no movement/attack input (InputManager only reads while locked): the character stops.

## Gotchas
- `browser_guards.ts` now cancels Alt/F10 keyup everywhere outside text fields: the Alt release arrives after the lock is gone and would otherwise focus the browser menu.

## How to verify
- In game, hold Alt: cursor appears, no options menu; hover/click the HUD panels; release: camera follows the mouse again with no click.

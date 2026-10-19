# A movement key closes the windows and takes the camera back

Date: 2026-10-19 · Agent: Claude Code · Commit: A movement key closes the inventory windows and takes the camera back

## Why
Request: with the inventory up and the cursor out, pressing W should drop the cursor and let the player walk at once.

## Decisions and evidence
- `main.ts` keydown: any key bound to forward/back/strafe (`InputManager.isMoveKey`, so rebinds and arrows count) while the inventory/ground, quest book or character sheet is open closes all of them and re-requests the lock (no gesture needed: the page released it itself, Pointer Lock 2.0, see 2026-10-17-alt-free-cursor.md).
- `InputManager.pressMove` sets the held flag on that same keydown: InputManager ignores keys while unlocked, so otherwise the walk would only start on the first key repeat (~0.5 s). Its keyup clears it as usual.
- Skipped with Ctrl/Alt/Shift (Shift+C, Ctrl+G), in text fields / chat, and for keys the panel already handled (`defaultPrevented`: arrows move a focused inventory item).

## Deviations from the original
- Not original (no cursor windows over play there); always on, QoL.

## Gotchas
- The options menu is not included: W there does nothing, as before.

## How to verify
- Online, open the inventory (I), hold W: windows close, the cursor is gone and the character walks without a click.

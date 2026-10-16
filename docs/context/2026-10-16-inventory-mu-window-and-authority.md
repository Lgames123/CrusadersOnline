# MU-style inventory window, drag from equipment, inventory authority fixes

Date: 2026-10-16 · Agent: Claude Code · Commit: Inventory as one MU-style window with ground panel; drag from equipment; dupe/loss guards · Supersedes: the panel layout, shortcuts and drop rules in 2026-10-14-inventory-grid-modernization.md (grid, shapes, migration 005 still hold)

## Why
The user found the three separate panels (bag / character / ground) a bad fit; they wanted MU Online's single window: equipment on top of the bag, bottom-right, with ground items beside it. Dragging from worn slots did not work.

## Decisions and evidence
- One window anchored bottom-right: an 8-cell-wide equipment board (helm/rings are dashed placeholders, only weapon/shield/armour exist) over the 8×6 bag, gold and a Ground button in the footer. `Ctrl+G` (also `Shift+G`) or the button opens the ground window to its right; it grows from width 0 inside a right-anchored flex row, which is what slides the inventory left. `I`, `Shift+I`, `Shift+C` toggle the window; closing it closes the ground window.
- Drag starts after 5 px (a press without moving stays a click: equip/unequip/drink). The drop target is computed from the grabbed cell, not the cursor cell, so the green/red footprint matches where the item lands. Worn item → bag cell = unequip into that cell (`EQUIP_ITEM` now takes optional `x`,`y`); worn item → carried item of its type = wear that one (swap); carried → anywhere on the equipment board = equip; any item → ground window or outside the inventory window = drop (worn items too).
- Held preview: same pose, framing and lights as the slot thumbnail (`poseItem`/`fitItemCamera`/`addItemLights` in `item_thumbnails.ts`), sized to the footprint ×1.15, sways instead of spinning (a spin clipped long items), appended to `body`, and a token discards a model that finishes loading after the drag ended.
- Mid-drag `INVENTORY_UPDATE`s are deferred until the drop (re-rendering used to detach the dragged node and the target). The ground list re-renders on its own; it no longer rebuilds the whole inventory as the player moves.
- One request in flight: the client ignores item actions until the next `INVENTORY_UPDATE` (1.5 s fallback). For that to hold, the server now answers every refused move/equip/drop/merge/split with the inventory (resync), instead of silence.
- Server guards (all in `world_zone.ts`, tests in `tests/unit/inventory_zone.test.ts`):
  - `itemId` on equip/move/drop: a request for a slot whose item changed (stale view, slot reused after a drop + pickup) is refused.
  - A repeated equip (double click) was reported as `bag_full` ("Inventory full."); now it is a silent resync. `bag_full` is only sent when the bag really has no room (and not for an unequip into a chosen cell that is taken).
  - Bag changes and ground/chest pickups are refused during a scripted sequence (`p.cutscene`) as well as dead/swinging (equip still defers during a swing).
  - Dropped items carry `itemId` and are picked up by it: two catalog items sharing a display name could turn into each other.
  - A full bag no longer loses chest contents (or the rest of a ground stack): what was not taken stays in `WorldObject.left`, the chest stays present, and the next interact grants only that. Gold is granted once.
  - Two players on the same ground item, double drops of one slot: verified safe (single zone thread, state checked before granting); covered by tests.

## Deviations from the original
- The whole window, drag/drop, ground panel, tooltips and Ctrl+G are MMO UI (always on). The original's own inventory screen is not reproduced.

## Not done / not decoded
- Ground items show a glyph, not their 3D thumbnail (the client has no item catalog for level item names); no drag from the ground list into a chosen bag cell (pickup goes to the first free area).
- A dropped item lives only in zone memory: a server crash or zone restart within its 5 minutes loses it (the drop itself is saved at once). Same for the 21st-drop purge (by design from the previous note).
- Narrow screens: the window scales its cells with the viewport, but window + ground window can exceed a phone's width.

## Gotchas
- `sed -i` from Git Bash rewrites CRLF files as LF (it did to `client/index.html`); restore CRLF before committing.
- An `index.html` edit makes Vite reload the page: the isolated test guest has to log in again (and its earlier drops are still on the ground).
- In the app's browser pane the game can run at ~4 FPS: the ground list (updated per frame) lags; wait before reading it.

## How to verify
- `pnpm test:unit` (inventory_zone + inventory_grid), `pnpm -r typecheck`.
- In game: `I` opens the window; drag the sword out of the Weapon slot to a bag cell, back onto the board, the worn shield onto a carried shield (swap), the shield onto the ground window (`Ctrl+G`), then click it in the list to pick it up; double-click a worn item: one unequip, no "Inventory full.".

## Follow-ups
- Equip/unequip sounds (from the previous note).
- 3D thumbnails in the ground list (send the model id with dropped items, or ship the catalog to the client).

# Door keys on a Key Items page

Date: 2026-10-17 · Agent: Claude Code · Commit: Door keys are key items on their own inventory page: no bag cell, never dropped

## Why
The user wanted door keys treated as key items: they take no bag space and cannot be tossed, shown on their own page with 3D models like the original's inventory.

## Decisions and evidence
- The original's inventory screen has a "Quest Items" page: 0x472C20 draws its frame, the `Quest Items` title (0x4F00C0) and two boxes either side of it that look like page arrows; 0x46D5E0 calls it on every inventory frame. Items there are drawn with the same model renderer as the bag (0x4738D0, item +0x1C model, +0x20 texture).
- Item type table (0x4F01E8 names → 0x4E16AC values, read by 0x4746D0): TRINKET 0, USEABLE 1, WEAPON 2, SHIELD 3, ARMOR 4, RING 5, POTION 6, SPELLBOOK 7, GOLD 8, INTERACT 9, NECKLACE 10, BOOTS 11, QUEST 12.
- Key item = items.ctx `USEABLE` named "… Key" (Stone, Ice, Fain's, Mica's, Room 2, Room 3): `ItemDef.keyItem` / `InventoryItemView.keyItem`. Still `type: 'key'`, so shops already refuse them (`merchantBuys`).
- Key items keep their inventory row and a legacy slot number but no grid origin: `addItem` gives them no cell (a full bag still takes a key), the layouts skip them, moves fail, `sanitizeInventory` drops any saved x/y, and the server refuses to drop them. Door checks (`openDoor`) are unchanged: the key is still found in `p.inventory`.
- Client: Bag / Key Items tabs under the equipment board. Keys show as 2×2-cell tiles (four to a row) with their model thumbnail and name. They cannot be dragged, and their tooltip says they cannot be dropped.

## Deviations from the original
- The tabs and tile layout are MMO UI. Only door keys moved there: QUEST, TRINKET and RING items (and the 0x1C1 quest-flag icons drawn by 0x472380) stay as they were.

## Not done / not decoded
- Which item types the original actually lists on its Quest Items page wasn't traced: the page's item loop wasn't found (0x471DD0 draws the 3×8 pack and the worn slots; 0x472250 a 2×6 grid gated by +0x1AD).
- `Permanent "true"` in items.ctx (quest items, keys, story weapons) is probably the original's "cannot drop" flag. It isn't read yet.

## Gotchas
- Migration 001 still has `slot_index <= 31` and 005 doesn't lift it, while `INVENTORY_SLOTS` is 48. Key items take slot numbers from the same pool, so this existing limit applies to them as well.

## How to verify
- `pnpm test:unit` (key cases in inventory_grid and inventory_zone tests). In `pnpm test`, the integration test "still saves a connected character whose socket never completes the close handshake" hung at commit time. Nobody checked whether it also hangs without this change. The other 15 integration tests passed.
- In game: in the inn (cs1b-inn), pick up Room 2 Key from the upper floor. It appears under Key Items (1) with its model, not in the Bag. Dragging it does nothing, and the tooltip says "Cannot be dropped".

## Follow-ups
- Move quest items / trinkets to the same page, read from `Permanent`, once the original's page contents are traced.

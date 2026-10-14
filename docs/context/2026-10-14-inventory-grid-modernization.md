# Inventory grid modernization

Date: 2026-10-14 · Agent: Codex & Antigravity · Commit: Pending (working tree)

## Why

Replace the list-based inventory UI with a MU-inspired grid while preserving the original game's item dimensions, current saves and server authority.

## Decisions and evidence

- `items.ctx` dimensions are now carried by `ItemDef` and `SC_INVENTORY_UPDATE`: weapon 1×3, shield 2×2 and armour 2×3 are confirmed directly by resolved original rules.
- The bag is 8×6 (8 columns on X axis, 6 rows on Y axis, totaling 48 cells). Migration `005_inventory_grid.sql` adds nullable `grid_x` (0..7) / `grid_y` (0..5), so existing records retain their legacy slot number and are laid out deterministically until moved.
- Header counter removed arbitrary `/32 items` limit; inventory capacity is bounded by the rectangular cell space in the 8×6 grid.
- `ItemThumbnails` renders high-definition 3D models into bag and equipment cells, framed to fit their exact rectangular cell footprint (`width × height`). Armors use standalone inventory cuirass models (`drakearmor_i`, `drakearmor2_i`, etc.) rather than the full Drake wearable mesh.
- `HeldItemPreview` renders only the enlarged rotating 3D model with drop-shadow, eliminating all glyphs/icons and circular frames. The model is mounted in a zero-centered pivot group (`-centre`) so it rotates strictly around its geometric center axis without orbital displacement. Dragging dims the source slot (`inv-dragging`).
- `CS.MOVE_INVENTORY_ITEM` is schema-validated and checked by `moveInventoryGridItem()` in the zone worker; invalid bounds, collisions and equipped items are rejected before persistence.
- `CS.DROP_INVENTORY_ITEM` allows dragging an item out of the bag or onto the Ground panel (`Shift+G`) to drop it to the ground. The server removes the item atomically from the player's inventory, creates a dynamic `WorldObject` (`DYNAMIC_OBJECT_BASE = 2_000_000`), broadcasts its state, and spawns it in the level view.
- Anti-duplication / safety: dynamic objects are marked `dynamic: true`. When interacted with/looted, they are permanently removed (`this.objects.delete(id)`) instead of entering the static level respawn queue (`OBJECT_RESPAWN_TICKS`), preventing item duplication bugs.
- `CS.MERGE_INVENTORY_STACK` and `CS.SPLIT_INVENTORY_STACK` allow server-authoritative stack combining and splitting.
- `setEquipped()` and `addItem()` atomically reserve rectangular bag space before changing state; equipment swaps fail without modification if the unequipped piece has no room.
- `Shift+I`, `Shift+C` and `Shift+G` independently toggle bag, character and nearby ground-item panels. Ground pickup remains the existing server-authoritative interaction.

## Deviations from the original

- Three simultaneous responsive panels, grid drag/drop, keyboard arrow movement, right-click stack split and rotating held-item preview are MMO/UI improvements; they are always enabled.

## Not done / not decoded

- Drag-to-equipment is not implemented (equipped items are toggled via click or action).
- Handheld items, armor, potions and books have resolved 3D models; any unavailable asset falls back to a glyph.

## Gotchas

- Never persist a UI-only legacy placement as authoritative without the move command. The client packs `grid_x/grid_y`-less entries only for display.
- `setEquipped()` now reserves enough rectangular bag space before unequipping or swapping; do not bypass it.
- The thumbnail and drag preview renderers reuse single canvases to preserve WebGL contexts; do not instantiate WebGL renderers per item.

## How to verify

- `pnpm typecheck`; `pnpm --filter @crusaders/tests test:unit`; `pnpm build`.
- In game: use Shift+I/C/G; drag a sword, shield or armour over a free area and a collision; arrow keys move items; right click splits stacks; relog to confirm an accepted move persists after migration 005 is applied.

## Follow-ups

- Implement drag-and-drop directly into equipment slots and explicit error feedback banners for rejected moves.

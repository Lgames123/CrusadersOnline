# Inventory grid modernization

Date: 2026-10-14 · Agent: Codex & Antigravity · Commit: Modernize inventory to 8×6 grid, authoritative drops/moves and equipment swap

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
- `InteractPacketSchema` allows `object` up to 10_000_000, eliminating WebSocket 1008 "malformed control message" rejections when interacting with dropped dynamic objects (`id >= 2_000_000`).
- Anti-duplication / safety: dynamic objects are marked `dynamic: true`. When interacted with/looted, they are permanently removed (`o.state = 'gone'; this.objects.delete(id)`) atomically on the zone loop before granting loot; any concurrent interaction immediately fails `!o || o.state !== 'present'`, preventing item duplication between two players.
- Ground item lifetime & limit: items dropped by players expire after 5 minutes (`DROPPED_ITEM_LIFETIME_TICKS = 6000`), cleaned up every second in `expireDroppedObjects()`. Each player has a hard cap of 20 dropped items on the ground (`MAX_DROPPED_ITEMS_PER_PLAYER = 20`); dropping a 21st item immediately purges the oldest dropped item.
- Chest visual clustering: in `original_level.ts`, dropped items in the world are visually represented by the authentic original game chest model (`models/chest01.glb`). A single chest is spawned per 2.5m radius cluster (`CHEST_CLUSTER_RADIUS`); subsequent items dropped within the cluster share that chest without duplicate models. When all items in a cluster are looted or expired, the chest is cleanly removed from the scene.
- `layoutInventoryGrid()` uses a deterministic two-pass algorithm matching the client: items with valid saved coordinates are placed first, and pre-migration or displaced items pack into first free positions. This aligns server and client rectangular space checks.
- `layoutItemViews()` in `inventory_grid.ts` provides a shared deterministic layout algorithm for client item views without requiring catalog lookups. Previously, `canUnequipItem()` and `dropOnCharacter()` in `inventory_panels.ts` had a divergent second pass that tested `canPlaceGrid()` against an occupied list already containing saved items, causing self-collisions that placed items a second time into free cells. This double-occupancy phantom filled the grid and falsely blocked unequipping 2×3 armor even with free space. Both methods and `bag()` now use `layoutItemViews()`, guaranteeing consistent grid occupancy.
- Ground item pickup catalog resolution: previously, `catalogFromItemRules()` in `shared/src/game/items.ts` only parsed `type === 'POTION' && fields['Use'] === 'HEAL'`. Mana-restoring potions (e.g. `Mana Crystals 2`), resistance potions, rings, and quest items placed in level maps had no catalog definitions. Looking them up during pickup returned `undefined`, failing `grantItem()`, which the interaction handler mistook for a full bag. All original level item types (`POTION` with `HEAL` and `RESTORE_MANA`, `QUEST`, `RING`, `USEABLE`) are now cataloged with their exact models, dimensions, and mana restoration values, resolving the false pickup rejection.
- All in-game error and notice texts are standardized in English (`"Inventory full."` instead of Portuguese).
- Drag-to-character equipment: dragging an equippable item (weapon, shield, armour) over `.inv-character` highlights with `.drop-hover`. Releasing equips the item. If another item is already equipped in that slot, it validates whether the unequipped item fits into the resulting bag grid. If it fits, they swap atomically; if there is not enough rectangular space, the interaction is cancelled and an "Inventory full." notice is presented.
- `CS.MERGE_INVENTORY_STACK` and `CS.SPLIT_INVENTORY_STACK` allow server-authoritative stack combining and splitting.
- `setEquipped()` and `addItem()` atomically reserve rectangular bag space before changing state; equipment swaps fail without modification if the unequipped piece has no room, emitting `SC.ERROR` with code `bag_full`.
- `Shift+I`, `Shift+C` and `Shift+G` independently toggle bag, character and nearby ground-item panels. Ground pickup remains the existing server-authoritative interaction.

## Deviations from the original

- Three simultaneous responsive panels, grid drag/drop, keyboard arrow movement, right-click stack split and rotating held-item preview are MMO/UI improvements; they are always enabled.

## Not done / not decoded

- Handheld items, armor, potions and books have resolved 3D models; any unavailable asset falls back to a glyph.

## Gotchas

- Never persist a UI-only legacy placement as authoritative without the move command. The client packs `grid_x/grid_y`-less entries only for display.
- `setEquipped()` now reserves enough rectangular bag space before unequipping or swapping; do not bypass it.
- The thumbnail and drag preview renderers reuse single canvases to preserve WebGL contexts; do not instantiate WebGL renderers per item.

## How to verify

- `pnpm typecheck`; `pnpm --filter @crusaders/tests test:unit`; `pnpm build`.
- In game: use Shift+I/C/G; drag a sword, shield or armour over a free area, drop on character to equip/swap; drop item on ground; pick up item from ground; verify "Inventory full." feedback when bag lacks space.

## Follow-ups

- Sound effects for equipping/swapping gear in paperdoll.

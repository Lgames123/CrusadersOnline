# MMO Stage 1: item instances with identity and mods

Date: 2026-10-20 · Agent: Claude Code · Commit: Every item is an instance with a stable UUID and its own mods (MMO Stage 1)

## Why
The user asked for the MMO systems to be implemented in sequence. Stage 1
(docs/game-design/mmo/11 §2) needs item identity and a payload for rarity, affixes and
refinement before loot, upgrades and trade can be built.

## Decisions and evidence
- `InventoryEntry.uid` (UUID) and `InventoryEntry.mods` (`ItemMods`):
  - rarity (`worn` is implied, never stored), up to 6 affixes, plus 0..10, failstacks, bound;
  - stackable items never carry mods.
- Persistence, migration **007_item_instances.sql**:
  - the row's `id` is the uid, so an item keeps its identity across saves; saves still replace
    the character's rows;
  - `mods` is a JSONB column.
  - The economy migration the MMO spec calls `006` is now **008** or later: `006` (admin) and
    `007` are taken.
- The zone stamps a uid on every instance without one before it sends or saves the inventory
  (new items, split stacks, old rows from before 007).
- A dropped item's ground object carries `uid` / `mods`, and picking it up restores both.
  `sanitizeInventory` drops duplicate uids and invalid mods.
- Nothing reads `mods` for stats yet; Stage 3 does.

## Not done / not decoded
- No row-level locks: the zone worker is the single writer of a character's inventory, and
  saves are one transaction per batch. Trade and auction (Stage 4) need the locks.

## Gotchas
- Equality tests on a player's `inventory` now see a `uid` on every entry.
- The user's dev DB (`local/pgdata`) gets 007 on the next server start.

## How to verify
- `pnpm test:unit` (item_instances.test.ts: sanitize + PGlite round trip; inventory_zone: drop
  and pick-up keep uid / mods).

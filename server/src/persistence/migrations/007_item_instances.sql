-- 007_item_instances.sql — MMO Stage 1: an inventory row is one item instance. Its id (UUID) is
-- the item's stable identity, kept across saves; `mods` holds its rarity, affixes, refinement
-- and binding (shared/src/game/items.ts ItemMods). NULL = the plain catalogue item.
ALTER TABLE inventory_items ADD COLUMN mods JSONB;

# Rings and accessory slots are wearable

Date: 2026-10-19 · Agent: Claude Code · Commit: Rings and the paper doll's other slots can be worn; placeholder helm, amulet, gloves, belt and boots

## Why
Rings could not be equipped (items.ctx RING was catalogued as a `key` item), and the helm / amulet / gloves / belt / boots slots were dashed placeholders with nothing to wear.

## Decisions and evidence
- New `ItemType`s `ring | amulet | helm | gloves | belt | boots` (`ACCESSORY_TYPES`). items.ctx has RING (12) and BOOTS (2); the rings carry `Equip BOOST_ATTRIBUTE` / `BOOST_PROTECTION` with `EquipParameters [-1, what, amount]`, the same arguments as a boost potion, parsed with `itemBoost` → `ItemDef.attributes` or `protection` (e.g. Crystal Ring of Force +5 Might, Dragontamer's Ring FIRE ×0.75).
- `equipCapacity`: two rings, one of everything else. A full slot gives up its first worn item (lowest inventory slot); the client shows rings in ring1/ring2 by inventory slot order. `sanitizeInventory` keeps up to the capacity.
- `Equipment` now sums every worn item: `protection` (product, armour and rings) and `attributes` (sum). The server keeps them as `gearProtection` / `gearAttributes` and they replace `armor.protection` everywhere (damage, spell resist, PLAYER_STATS). `effectiveAttributesOf` adds `gearAttributes` to the status bonus (cap 50 unchanged); equipping now runs `refreshDerived`, so HP / mana / damage / clip rate follow.
- Placeholders (built-in catalog, +1 Speed +1 Might each, 50 gold): Leather Cap (helm 2×2), Bone Amulet (1×1, model 67 amuletoftruesight), Leather Gloves 2×2, Leather Belt 2×1, Leather Boots 2×2. Given with the admin panel's player item tool; no shop sells them.

## Deviations from the original
- Helm, amulet, gloves and belt are not original. How many rings the original wears, and whether its BOOTS do anything, is not decoded: two rings is the MU-style board.
- Dasher Boots (BOOTS, `Permanent`) is a quest key item like the Permanent trinkets; Magic Boots wears in the boots slot with no effect (no `Equip`).

## Not done / not decoded
- Accessories have no look on Drake and (but the amulet) no model: the bag card shows a glyph.
- Dropping onto a specific full ring slot still replaces the first ring, not the one under the cursor (the equip request carries no target slot).
- The original's equip-boost code path was not traced (only the data); the potion boost decode (0x00401AB0 / 0x00401D10) is assumed to mean the same.

## How to verify
- `pnpm test:unit` (inventory_grid.test.ts "rings and accessories").
- In game: admin panel → player → item `crystal_ring_of_force` / `leather_cap`; drag onto the paper doll; the character sheet's Might / Speed rise.

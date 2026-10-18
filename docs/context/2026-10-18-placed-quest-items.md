# Placed quest items are left out

Date: 2026-10-18 · Agent: Claude Code · Commit: Quest items placed in levels are left out: no Message for Dain at the Citadel merchant

## Why
A "Message for Dain" scroll lay in front of the Citadel merchant and could be looted. The user
asked to remove it and any other misplaced items.

## Decisions and evidence
- items.ctx `Quest` on a QUEST item is its quest-item slot (strings 2990–2995: Horn, Scepter,
  Talisman, Dasher Necklace, Rune, Message for Dain), the player byte +0x1C1 that 0x472380 draws
  as icons. The only writer is a quest trigger's action 0x40 (`OR [player+0x1C1]`, 0x46435B), so
  the original hands out quest items through quest triggers, never as ground pickups.
  Example: Du1c's walk-in quest trigger (quest 7, bit 4) gives the Rune.
- Only six ground items are QUEST: the scroll in Ci1b/2b/3b/4b/9b (2052, 832, -1688) and Du1c's
  Rune. The scroll is an ordinary item record whose instance name is still "GoldPieces", a
  re-typed gold pile. The Rune is 114 ft from any level geometry. No creature inventory, chest or
  shop holds a QUEST item.
- Converter: `questItem: true` on those objects. `isPlaced()` (shared) leaves them out of the
  arena and the client's drawing. They stay in the list, so object ids and taken flags don't move.

## Deviations from the original
- In the original the scroll is probably a lootable pack item. Leaving it out is on purpose (user
  request); the Rune is unreachable either way.

## Not done / not decoded
- The original's ground pickup of a QUEST item wasn't traced. The player-bit grant (action 0x40)
  isn't implemented on the server, so nothing gives these items yet.
- Audit of the other ground items (floor under each, collision mesh): some lie outside the
  level or float, and were left as placed. It isn't known whether the original lets items fall.
  - Outside the mesh: Ca1b #44 gold (25 ft under the floor), Ca1c #203 gold, Ca2a #43 gold,
    Ca3d #117 gold, Cs3a #0–4 (two Greater Healing, two Mana Crystals, gold; beyond the mesh).
  - Floating: Ca1c #212 / Ca2c #197 / Ca3c #197 Broad Sword 48 ft above the floor; Ca3c #194
    Healing Potion 13 ft; Cs3b #34 Healing Potion 64 ft.

## Gotchas
- Run `pnpm convert` (placements are rewritten every run, no manifest bump). Older placements
  have no `questItem`, so the scroll is still there until you convert.

## How to verify
- `pnpm test:unit` (level.test.ts "leaves out placed quest items").
- In game (ci1b): the merchant's counter has no scroll. `__co.level.arena.objects` lists items
  77–81 only.

## Follow-ups
- Settle the floating and outside-the-mesh items from the original (do items fall on load?).
- Quest triggers' player bits (action 0x40) → give the quest item.

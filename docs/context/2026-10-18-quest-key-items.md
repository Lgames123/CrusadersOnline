# Quest items are key items, given by quest triggers

Date: 2026-10-18 · Agent: Claude Code · Commit: Quest items are key items, never looted, given by their quest trigger

## Why
The user: key items aren't only keys (Horn of Shattering, Message for Dain...). They belong on the
Key Items page, can't be looted from the ground, and are given in specific conditions. Message for
Dain was reported lootable at Celestia's level and landed in the bag.

## Decisions and evidence
- Key items now = USEABLE "… Key" + items.ctx `QUEST` (Horn of Shattering, King's Sceptre,
  Talisman of True Sight, Dasher Necklace, Rune, Message for Dain) + `TRINKET` with
  `Permanent "true"` (Scout's Message, War Plans, Birthday Gift, Carved Metal, Ancestral Cane,
  Dasher Totem, Dwarven Tome, Extra Quest Item 1/2). The last two groups also get `questItem`.
  Arrow / Mr. YukMan (not Permanent) stay out of the catalog. Permanent weapons/shield/boots
  are equipment, not key items.
- Quest trigger fire 0x4641F0, decoded (headless disassembly): action bit 0x40 runs
  `OR byte [player+0x1C1], 1 << u16[trigger+0x36]` at 0x46435B. It never clears the bit. The bit is
  the QUEST item's items.ctx `Quest` index (0 Horn … 5 Message for Dain), so `ItemDef.questBit`.
  The server's `applyQuest` now gives that item once (no bag cell, so a full bag still takes it),
  whether or not the quest part does anything.
- The triggers that give them (activation 1 = walk-in, 16 = fired by a script/sequence): co3a
  243023 Horn (16), du2a 401749 Sceptre (1, with ITEM_CHECK), cs4b 419325 Talisman (1), du2a
  401693 Dasher Necklace (1), du1c 255236 Rune (1), gl2a 98777 Message for Dain (16).
- Ground and chests: the server leaves out level items whose catalog def is `questItem`, and
  chest grants skip them. That's a catalog check, so it holds even on placements converted before
  the `questItem` flag (2026-10-18-placed-quest-items). The converter flag also covers the
  Permanent trinkets now (none are placed today).
- Existing characters that already carry Message for Dain: `sanitizeInventory` drops the bag cell
  of key items on load, so it moves to Key Items by itself.

## Deviations from the original
- Door keys stay ground pickups (Room 2/3 Key, Mica's Key, Fain's Key): the levels place them on
  purpose and their doors need them. Only the story-given items are refused on the ground.

## Not done / not decoded
- Side-quest trinkets (Scout's Message, War Plans…) have no giver yet: side quests (TALK 0x04,
  ITEM_CHECK 0x02 → 0x4974A0 / 0x497170) aren't implemented. They are key items once given.
- Whether quest items leave the inventory when handed in (ITEM_CHECK with a player bit, du2a
  401749) wasn't traced. Nothing removes them.
- Why the report saw the scroll in the current build wasn't reproduced: the converted ci*b
  placements already carry `questItem`, and only the client dev server was running. The likeliest
  cause is a pickup made before 39f3ad3 or a server started before that commit.

## How to verify
- `pnpm test:unit`: inventory_grid "door keys, quest items and quest trinkets are key items",
  inventory_zone "quest items are never taken from the ground or a chest…".
- In game: ci1b merchant counter has no scroll. A character that already had Message for Dain
  sees it under Key Items after relogging.

## Follow-ups
- Side quests: give their trinkets, and check whether they're taken back on hand-in.

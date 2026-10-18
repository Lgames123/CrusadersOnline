# Creatures drop what they carry; a full bag's share waits 2 minutes

Date: 2026-10-17 · Agent: Claude Code · Commit: Creatures drop what they carry, and a full bag's share waits at the corpse for the killer alone

## Why
Kills gave a made-up reward (gold 5-10 and a long sword / scale armour roll for every creature).
The user also asked that items a full bag cannot take are not kept or queued: they go to a
chest-like pile only the killer sees, for 2 minutes; gold always goes in.

## Decisions and evidence
- Original: a dead creature keeps its inventory on the corpse. The ground window (0x00471940)
  lists every slot of each dead creature in reach except `Large Club` / `Large Iron Club`
  (0x4EFE88 / 0x4EFE78) and slots already taken (flag 0x10000000, 0x47096D).
- Spawns carry `carries` (placement `items` minus those two clubs; `level.ts` NOT_ON_CORPSE).
  Across the 1307 hostile placements: 5404 gold in all, weapons and shields they hold, 188
  Healing Potions, spell books (Snap Freeze, Heroism, Soul Drink, Spectral Ally), unique items.
- A spawn without `carries` (synthetic arenas, old placements) keeps the archetype's gold roll
  and loot table.
- Reward: gold to the purse; each item through `grantItem` (stacks whole, singles one by one,
  books learned). The rest becomes one dynamic ground item per entry at the corpse, `onlyFor` the
  killer's key (character id, else connection), expiring in `OVERFLOW_LOOT_LIFETIME_TICKS`
  (2 min). Only that player is sent it, sees it on join, and can take it; it does not count
  against the 20 dropped-item cap. The client already draws dropped items as one chest
  (clustered within 2.5 m) and lists them in the Ctrl+G ground panel.

## Deviations from the original
- Auto-loot into the bag on the kill (the original opens the corpse in the ground window) and
  the private 2-minute overflow: MMO adaptations, always on.
- Mobs respawn (10 s), so each kill gives the placement's items again (farmable potions, gold).

## Gotchas
- Private objects must go out through `announceObject` / `sees`, never `broadcastObjects`.
- A spell book whose spell is already at the top is used up and never overflows.

## How to verify
- `pnpm test:unit` (inventory_zone.test.ts "a kill gives the corpse's gold always…").
- In game: fill the bag, kill a skeleton → "+gold", "Inventory full. The rest waits in a chest
  for 2 minutes.", a chest at the corpse that a second player does not see; Ctrl+G takes items.

## Follow-ups
- Whether kills by a respawning mob should keep giving unique items (Boomer Axe, rings) each
  respawn.

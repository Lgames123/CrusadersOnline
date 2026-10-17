# Pickups: all or nothing on a full bag

Date: 2026-10-17 · Agent: Claude Code · Commit: A full bag takes nothing from an item or chest, so pickups are never half done · Supersedes: 2026-10-17-per-character-pickups.md (its leftovers gotcha)

## Why
A full bag used to take what fit and leave the rest in memory only, so after a relog a half
emptied chest was whole again (gold could be taken twice). The user asked for none at all instead.

## Decisions and evidence
- `fitsAll` places every bag item of the pickup on a copy of the bag (same addItem calls as
  grantItem); if any does not fit, nothing is granted, gold included, and the player gets
  `bag_full`. The object stays as it was. `Player.leftovers` and `WorldObject.left` are gone.
- Applies to dropped items as well (one stack, so it was already whole or nothing in practice).
- Gold and spell books never count against the bag.

## Deviations from the original
- Ours, always on.

## How to verify
- `pnpm test:unit` (inventory_zone.test.ts "takes none of it").
- In game: fill the bag, open a chest → "Inventory full.", no gold; drop something, open again →
  everything at once.

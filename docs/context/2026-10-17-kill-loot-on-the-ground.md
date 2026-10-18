# A kill's items fall on the ground, for the killer alone

Date: 2026-10-17 · Agent: Claude Code · Commit: A kill's items fall around the corpse, drawn as themselves, for the killer alone · Supersedes: 2026-10-17-creature-drops.md (its auto-loot and full-bag overflow)

## Why
The user asked that a kill's items no longer go straight into the bag. They lie on the ground as
in the original, seen and taken only by the player they belong to. Player drops keep the chest.

## Decisions and evidence
- What a corpse gives is unchanged (placement inventory minus Large Club / Large Iron Club,
  0x00471940). Gold still goes straight to the purse (asked earlier). Every item, books
  included, becomes a dynamic ground item `onlyFor` the killer, `loose: true`, gone after
  `KILL_LOOT_LIFETIME_TICKS` (2 min). Nothing enters the bag, so there is no full-bag case and
  no queue; a full bag just cannot pick it up (all-or-nothing pickup, as any ground item).
- Items lie on a ring 0.6 m around the corpse (golden-angle steps from its heading) so each has
  its own pickup point. Tab and the Ctrl+G ground panel take them one by one.
- The client draws a `loose` item as its items.ctx model (`item.model` / `texture` sent by the
  server, loaded through ItemThumbnails). The node frame is undone as for placed items. A model
  more than twice as tall as wide (weapons stand on their pommel) is laid on its side. Each one
  rests on the floor centred on its point (pivots are off: the long sword's by 2.5 ft).
  Non-loose dynamic items (player drops) stay clustered in the chest model.
- The combat event's reward is `{ xp, gold }` only; `loot` is gone.

## Deviations from the original
- The original lists a corpse's items in the ground window and draws nothing on the floor. Ours
  draws them around the body. Per-killer ownership and the 2 minutes are MMO choices, always on.

## How to verify
- `pnpm test:unit` (inventory_zone.test.ts "a kill's gold goes to the purse…").
- In game: kill a skeleton: +gold, a long sword and a wooden shield on the floor by the body;
  a second player does not see them; Tab picks them up; after 2 minutes they are gone.
  Checked offline in Ca1a by spawning loose items through `__co.level.spawnDynamicObject`:
  swords and the hammer lie flat, the shield rests flat, potions stand.

# Level items and chests: once per character

Date: 2026-10-17 · Agent: Claude Code · Commit: Level items and chests are taken once per character, for good

## Why
Ground items and chests were shared by the zone and came back after 5 minutes. The user asked for
them to be instanced per player: each character finds every one, takes it once, and it never
returns for that character, server restarts included.

## Decisions and evidence
- Taken = story flag `<level>-took:<object id>` (object id = index in the level's placements, so
  the level name keeps it unique; fits `STORY_FLAG`). Saved with the story on the pickup's
  `progress` persist, like the gift shop flags. 84 levels hold 266 items + 25 chests, far under the
  4096-flag cap.
- The zone's shared `state` of items/chests now stays `present`; what a player sees comes from
  `stateFor` (taken → `gone`, chest → `open`), in the join's full sync and in the pickup message,
  which goes to the picker only. Other players get nothing.
- Dropped (dynamic) items are unchanged: shared, first come first served, expire. Breakables still
  respawn after 5 min.

## Deviations from the original
- MMO adaptation, always on. The single-player original has one copy of everything anyway.

## Gotchas
- A full bag's leftovers (`Player.leftovers`) are in memory only: the flag is set when the item or
  chest is fully emptied. After a relog or restart a partly taken chest is whole again for that
  character (gold already granted from it can be granted again).
- Synthetic arenas (tests) use the prefix `arena`.

## How to verify
- `pnpm test:unit` (combat.test.ts "taken once per character, for good").
- In game: two characters at one chest; one opens it, the other still sees it shut and can open
  it; relog the first → still open/gone.

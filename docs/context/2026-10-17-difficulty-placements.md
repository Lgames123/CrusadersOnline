# Level placements by difficulty (the Thunderous Hammer)

Date: 2026-10-17 · Agent: Claude Code · Commit: Level placements follow the difficulty, so the Catacombs' Thunderous Hammer is there

## Why
The Thunderous Hammer in Ca1a (at the bottom of the pit the lever opens) never appeared. The
user asked for that one and any other missing static items.

## Decisions and evidence
- Cap record +8 is a difficulty mask, not a constant 0x3F: 0x04 easy, 0x08 medium, 0x10 hard.
  The loader removes whatever lacks the current difficulty's bit (settings +0x85; 0x476DC0,
  0x478E24…, removal 0x4838D0). The converter only read 0x3F records, so it dropped the 5 objects
  that differ (asset-format-discovery §6.2.1). The original's save `RWOTF008.sav` holds the hammer.
- Converter 1.27 reads every mask and writes `difficulty` on objects and creatures when it is not
  0x3F. `buildLevelArena(..., difficulty)` leaves out the others (`inDifficulty`). The server
  passes its DIFFICULTY (default medium), and the client gets it in SC_ZONE_CHANGE and builds and
  draws the same arena.
- On medium: the hammer and Gl1b Greater Healing Potion2 now appear. 17 hard-only creatures (0x33)
  and 1 easy+hard one (0x37) no longer spawn; they always did before.

## Gotchas
- Object ids are list indices, and characters' taken flags (`<level>-took:<id>`) name them. The
  newly read objects are appended after the 0x3F ones so no earlier id moves. Keep that order.
- Brushes still need +8 = 0x3F. Only the easy-only `bWhiteMenCantJump*` (Ca*b) differ, so
  medium and hard are right as is; easy lacks them.

## How to verify
- `pnpm convert`, restart the server; `pnpm test:unit` (level.test.ts "leaves out placements of
  other difficulties").
- In game (medium): Ca1a, pull the lever, go down the ring stair: the hammer is at the bottom.

## Follow-ups
- Brush masks (easy-only jump blockers) if easy is ever played.

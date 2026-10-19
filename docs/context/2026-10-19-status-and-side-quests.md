# Project status refresh and the cut side quests

Date: 2026-10-19 · Agent: Claude Code · Commit: Project status refreshed; the 26 cut side quests documented

## Why
`PROJECT_STATUS.md`, the backlog, the parity matrix and the roadmap had not been updated since
2026-10-09–13. The user also settled several open items and asked for a document on the side
quests, to implement them later as a feature.

## Decisions and evidence
- The side-quest records come from `0x497670` (0x44 bytes at manager +0x258). The talk handler is
  `0x497170` and the item check `0x4974A0`; both were decompiled headless, with functions created
  in memory only (they are not functions in the project). Full layout:
  `game-design/side-quests.md`.
- The record's voice ids are the shipped Sound.ctx id − 6, for all 26 quests (Nai's offer: exe
  989, Sound.ctx 995 `NA_M1B_01`). This is extra evidence that the quests were cut before release.
- User decisions, recorded in `PROJECT_STATUS.md` §2 and `known-discrepancies.md` §4:
  - **Ending after Necros:** back to the start of the game, all story areas open, a completion
    reward (TBD); waypoints later.
  - **Intro movie:** an option at character creation.
  - **Relog:** cooldowns and timers resetting is fine for now.
  - **Hotbar:** stays per browser.
  - **Chat:** no history wanted; an ignore list, client-side.

## Not done / not decoded
- Who fills the item lists the records index (`[0x608758] + 0x940` handed over,
  `+ 0xBE8` rewards). Only readers were found, by a raw byte scan. The headless scalar search finds
  nothing because that code is not disassembled in the saved project.
- What drives the condition ids at +0x42 / +0x43. The meaning of the flags at +0x0E is read from
  the pattern only.

## Gotchas
- `sounds.json` entries are not indexed by position: look them up by their `id` field (the list
  has 1,143 entries; ids go up to 1,559).
- The MMO spec's economy migration is called `006`, but `006` is already the admin bans
  migration.

## Follow-ups
- Implement the ending after Necros (backlog CMP-001), then the intro movie option (CMP-003).
- Side quests: backlog SQ-001.

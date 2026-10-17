# Character statistics screen (F1)

Date: 2026-10-17 · Agent: Claude Code · Commit: Character statistics screen on F1, as the original draws it

## Why
User asked for the original's F1 (statistics) and F2 (quest book) screens. F2 already existed (2026-10-13, executable-analysis §17.3); F1 was missing.

## Decisions and evidence
- Found through the `statsA/B/C` names next to its format strings in .data (0x4EF4BC–0x4EF578): load 0x454C10, draw 0x454CA0, vtable 0x4E0E94 (mouse slots empty). Layout, strings (2957–2981) and the formulas are in executable-analysis §17.4.
- `PLAYER_STATS` now carries `name`, `attributes`, `damageMultiplier`, `resist` (difficulty row × armour protection, as 0x44CB60) and `damage` (wielded weapon's vector, 0x46C0D0). Equipping now marks stats dirty so the sheet follows the gear.
- Resist and damage use float32 maths and truncation like the exe's `_ftol` (JS doubles give 9 % for a 0.9 resist).
- F1 and F2 take each other's place; Esc closes either without opening the options.

## Deviations from the original
- "Drake the Crusader" becomes "<character name> the Crusader".
- Font is the quest book's CSS stand-in (Georgia 15/18 px); the original's font 0x53C320 and its line height are not decoded — 18 px is the spacing that lines the boxes up (box 2 at y 122 beside Might, table at y 210).
- No opening sound (none found for F1; the quest book plays UITurnPage).

## Not done / not decoded
- Resist ignores +0x17C (potion / spell modifiers) and non-armour protection: the server has neither yet.

## How to verify
- `pnpm typecheck`; in game press F1 (medium difficulty, long sword: Slash/Bash 10 %, Slash damage 10, total `10 x 1.0 = 10`), F2 swaps, Esc closes.
- With a hidden Browser pane, drive frames via `__co.frame(t)` until the intro sequence ends — fast-forwarding trips the server's input rate limit (disconnect 1008), harmless.

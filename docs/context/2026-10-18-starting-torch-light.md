# Drake starts with Torch Light

Date: 2026-10-18 · Agent: Claude Code · Commit: Drake starts with Torch Light at level 1, as the original

## Why
User: Drake should know Torch Light at level 1 from the start, as the original does, and the spell's mana cost per level should be correct.

## Decisions and evidence
- New-game reset 0x004BC980 resets all eleven spell objects (vtable +0x8 → 0x004BABC0), then sets the known mask (0x630C38 +2) to 1 and selects the lowest known slot. So Torch Light is known and selected, at level index 0.
- `STARTING_SPELLS` is added on join (`WorldZone.join`) to every character that lacks it. This covers new characters, older saves and guests, and puts it first in the list. Nothing is written to the database until the next save.
- Mana per level confirmed from code: the S-row loader (0x00442000 → 0x004BAC80) maps level 1/2/3 to index 0/1/2 and stores the cost as a ushort at +8 + 2 × index. The check (0x004BABE0, through torch's +0x20 = 0x004BC3B0 → +0x54) is cost ≤ current mana, skipped when the stats' +500 has bit 2 set. The spend (0x004BAC40) takes cost[level]. Torch Light therefore costs 1 / 2 / 3, which the server, HUD, hotbar and Spells-page tooltip already used: no change.

## Gotchas
- Since Torch Light is known from the start, the Torch Light Spell Book (placed books, Cs2b hermit lady) now raises it to level 2 (0x004BCD10), as in the original.

## How to verify
- `pnpm test:unit` (spells.test.ts: the starting spell, level 1 costs 1, and a book raising it to level 2 costs 2 and lights 30 ft).

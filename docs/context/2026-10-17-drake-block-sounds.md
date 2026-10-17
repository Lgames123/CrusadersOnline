# Drake's shield clanks like a creature's

Date: 2026-10-17 · Agent: Claude Code · Commit: Drake's blocks and hits use his creature sound row (type 142) · Supersedes: the player-sound bullets of 2026-10-17-shield-rush-and-blocks.md

## Why
User: blocking in our game sounds like wood; the original plays at least three different sounds.

## Decisions and evidence
- Frida capture (`local/frida/blocksnd.js`, hooks 0x4B0FC0 / 0x44D290 / 0x44D5E0): the blocked victim Drake is **type 142**, not 2 as assumed from 0x493F20. Row 142 of 0x4EEA88 = impact flesh, block metal. 16 blocks of skeleton long swords: 339 ×10, 340 ×5, 341 ×1 (the sharp metal row; 357 is the rare fifth).
- So Drake's blocks use the metal row by the attacker's edge, and blows landing on him the flesh row by edge (was a fixed 306). Every weapon blow event now carries `sharp`.

## Gotchas
- Static reading of a type check is not enough to know which side of it the player falls on; the decompiler showed `< 0x71 → 0x157` correctly, the wrong part was the player's type.

## How to verify
- In game: block skeletons (sharp clanks 339-341) and a Shadow's Heavy Mace (blunt 338 / 346 / 355).

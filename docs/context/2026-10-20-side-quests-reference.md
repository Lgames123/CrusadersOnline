# Side quests: full reference, reward lists decoded

Date: 2026-10-20 · Agent: Claude Code · Commit: Side quests documented in full: reward and hand-over lists, flags and journal pages decoded · Supersedes: the open questions of 2026-10-19-status-and-side-quests.md

## Why
The user asked for a document to check the 26 cut side quests by hand: how each one works, its
objectives and its rewards. It is `docs/game-design/side-quests.md`, rewritten.

## Decisions and evidence
- **Item lists, open since 2026-10-19:**
  - The quest manager's constructor `0x496770` builds +0x940 (10 × 0x44) and +0xBE8 (8 × 0x44),
    then calls `0x497670` (records) and `0x498AE0`, which names every item.
  - A, handed over: Ceremonial Sword, Scout's Message, War Plans, Cursed Sword, Birthday Gift,
    Ancestral Cane, Cursed Axe, Stone Key, Fain's Key, Durin's Hammer.
  - B, rewards: Healing Potion, Brennock's Sword, Saurana's Sword, Asok's Ring, Greater Healing,
    Mana, Speed Potion, Reflective Shield.
  - Found with a raw byte scan for the displacements `40 09 00 00` / `E8 0B 00 00`. Ghidra's
    scalar search misses them, because that code is not disassembled.
- **+0x42 / +0x43 are journal pages, not conditions** (`0x496FD0`): string 3200 + n.
- **Flags traced, no longer read from the pattern:**
  - 0x01 hand over at the offer;
  - 0x02 the second NPC's bag check;
  - 0x04 the objective needs the item;
  - 0x08 completion needs the item;
  - 0x10 the item is taken;
  - 0x20 a healing potion in hand;
  - 0x40 five gold (`0x498C40`);
  - 0x100 not before the offer.
- **Finding items:** a pickup tagged ≥ 100 meets side quest (tag − 100) (`0x497600`). No shipped
  item has such a tag.
- **Event completion:** trigger action 0x10 (`0x496F50`) completes an assigned side quest (XP +
  gold, no item) or silently closes one that was never offered.
- Addresses added to executable-analysis §18.

## Not done / not decoded
- Nothing implemented: SQ-001 still stands.
- Where the cut NPCs, the Lava Pit, the mines' altar and the items to find would be: never in
  the data.

## Gotchas
- The document paraphrases the lines and gives Sound.ctx ids and file names: no transcripts in
  the repo (Zero-IP).
- **Quest 23 cannot be finished as recorded:** A8 is Fain's Key, but Fain checks for Fain's Axe.
- Nothing sets the 0x80 "reward given" bit, so the original would repeat rewards.
- `tests/integration/persistence.test.ts` ("shutdown with an unresponsive client") hangs on this
  machine with or without the day's changes (checked by stashing them), so `pnpm test` never
  ends. Run `test:unit` and the other integration files separately.

## How to verify
- Open `docs/game-design/side-quests.md`. Each quest lists its sound ids (`rules/sounds.json`
  `description`), journal string ids and items (`rules/items.json`).
- Re-run the decompile: `tools/re/ghidra/headless.sh DecompileCreate.java out 0x498ae0 0x498c40 0x497600 0x496f50 0x496fd0`.

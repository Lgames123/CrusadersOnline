# Shops as the original: type 0x1C triggers, per-act stock, full-price trade

Date: 2026-10-16 · Agent: Claude Code · Commit: Shops are the original's: type 0x1C counters with per-act stock · Supersedes: 2026-10-16-merchant-shops.md

## Why
The previous commit called shops non-original and invented stock lists. The user pointed out
the original has shops; deeper research found them (executable-analysis.md §19).

## Decisions and evidence
- A shop is a **cap trigger of type 0x1C** (vtable 0x4E1D94, fire 0x464170), not an NPC: use key
  in its volume → greeting (+0x36) and the inventory screen in trade mode 5 with a copy of its
  items (+0x35 / +0x38, 0x46D3D0). Found from the gold stack (item type 8, 0x46A940 / 0x46B800)
  → trade code 0x46E290 → opener 0x4572E0(2, 5) at 0x4641D2.
- Price = items.ctx `Price` (item def +0x24) × count, both ways: selling pays the full price
  (× −1.0 at 0x4DE87C), not half.
- Per visit: bought entries leave the offer, sold items join it (buy-back), reopening refills
  from the shop's list (nothing is written back, 0x46CD80). 500 ms between openings.
- 25 shops, stock per act (Ci1b vs Ci3b, Co1a vs Co4a...): the progression the user remembered.
- The `merchantShops` feature, `DEFAULT_ON_FEATURES`, `parseFeatures` and the NPC-based
  `merchant` spawn field are gone: shops are original, always on.

## Deviations from the original
- Items without a price (keys, quest items) are refused; the original takes them for 0 gold.
- Trade sounds 0x198 / 0x199 are not played (not in the converted Sound.ctx list).
- MMO: each player's visit has its own copy; the shop UI is our side panel, not the original's
  inventory-screen mode.

## Gotchas
- `MANIFEST_VERSION` 1.25.0 (`story.shops`): reconvert and restart the server.
- Stock names resolve through the server catalogue (`shopStock`); items it lacks (some rings)
  are left out of the offer.

## How to verify
- `pnpm test:unit` (shops.test.ts).
- Checked in the isolated client, Ci1b guest at (618.13, 253.8, −515.1) m: Tab — trade, greeting
  "Please, please check out my fine wares.", five items at items.ctx prices; Long Sword sold for
  120 and listed for buy-back, Metal Shield bought for 50.

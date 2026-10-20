# MMO Stage 4a: direct trade between players

Date: 2026-10-20 · Agent: Claude Code · Commit: Direct trade between two players: lock, confirm, one atomic swap (MMO Stage 4)

## Why
MMO roadmap Stage 4 (docs/game-design/mmo/05 §2): a duplication-proof direct trade.

## Decisions and evidence
- The trade runs in the zone worker that holds both characters (`server/src/simulation/trade.ts`).
  That worker is the only writer of their inventories, so the swap needs no database lock to be
  atomic.
- **Flow:**
  - request (within 8 m, same zone) → accept within 30 s;
  - each side offers items by **uid** plus gold;
  - both **lock**, then both **confirm**;
  - any change to an offer drops every lock and confirmation.
- **Settlement** (`settleTrade`):
  - runs on copies of both bags;
  - fails on any missing item, a worn / key / quest / bound item, too little gold or a full bag;
  - applied only when everything works. Items keep their uid and mods.
  - The zone then saves **both characters in one `persist` batch**, i.e. one `saveStates`
    transaction, and logs the trade on the server log (loot event, `chest: -1`).
- A player leaving the zone (logout or transfer) ends his trade. The other side is told.
- Client:
  - `/trade <name>`, `/trade accept|decline|cancel`;
  - a trade window: your tradable items as toggles, gold, Lock / Confirm / Cancel, and their
    offer with stats; Esc cancels.

## Deviations from the original
- MMO only. It is always available: it changes no gameplay rule.

## Not done / not decoded
- No cross-zone trade. No `SELECT … FOR UPDATE`: not needed while one worker owns both
  characters. It will be needed if inventories ever get another writer.

## How to verify
- `pnpm test:unit trade` (settlement, refusals, zone flow, unlock on change, one save, late
  confirm).
- Live: two guests on spells-server; Guest002 traded his axe to Guest001 through the window
  (checked).

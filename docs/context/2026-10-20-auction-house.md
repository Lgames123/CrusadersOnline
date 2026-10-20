# MMO Stage 4b: auction house and mailbox

Date: 2026-10-20 · Agent: Claude Code · Commit: Auction house with escrow, deposit, sale tax and a mailbox (MMO Stage 4)

## Why
MMO roadmap Stage 4 (docs/game-design/mmo/05 §3).

## Decisions and evidence
- **Migration 008_economy.sql** (the spec's "006": 006 and 007 were taken):
  - `auction_listings` (buyout only); `mailbox`; `economy_audit`;
  - a listed item lives in its listing row (catalogue id, quantity, mods, uid). Inventory rows
    are rewritten on every save, so nothing points at them.
- **EconomyRepository** (`server/src/persistence/economy.ts`):
  - buy, cancel and expiry each run in one transaction with the listing row `FOR UPDATE`; two
    simultaneous buys of one listing give one 'ok' and one 'gone' (tested on PGlite);
  - at most 15 open listings per seller;
  - deposit 5 % × 1 / 1.5 / 2 for 12 / 24 / 48 h, never returned;
  - a sale pays the price less 10 % into the seller's mailbox, and the item goes to the buyer's;
  - cancelled or expired items go back by mail; every step writes an `economy_audit` line.
- **Where the gold and items move:**
  - The zone worker owns the live bag and purse. Listing = the zone takes the item and the
    deposit (`auctionEscrow`), then the main thread inserts the listing. If that fails, item
    and deposit come back by mail.
  - Buying = the main thread reads the price, the zone takes the gold (`auctionCharge`), then
    the market settles. A listing sold meanwhile refunds the gold by mail.
  - Collecting = the market deletes the mail (`claimAll`), the zone grants it (`deliverMail`),
    and what does not fit goes back to the mailbox.
  - All three need **a merchant's shop open** (the "town broker"), and a saved character:
    guests have no market.
- Client: the ⚖ button on a merchant's window, or `/ah`, opens the window (Browse with search,
  Buy / Cancel; Sell with price, duration and the deposit shown; Mailbox with Collect all).

## Deviations from the original
- MMO only; it changes no gameplay rule, so it is always available.

## Not done / not decoded
- No bidding or anti-sniping extension: buyout only. No price-velocity audit flag. No dynamic tax.
- A crash between the zone's escrow save and the listing insert loses that item, a small window.
  A durable escrow table written by the zone would close it.
- Not run end to end live: registered accounts would have to stand in a shop volume.
  Unit tests cover the repository (with the buy race) and the zone's custody, payment and
  delivery; the session glue is typed but not exercised.

## How to verify
- `pnpm test:unit auction`.
- Live: two saved characters in Ci2b's shop (x 2016–2040, z −1664…−1708 ft), ⚖ → Sell with one,
  Buy with the other, then Mailbox → Collect all on both.

# Reward shops: free, once per character

Date: 2026-10-17 · Agent: Claude Code · Commit: Reward shops (the hermit lady's) give their items free, once per character

## Why
The hermit lady by the "Ye Olde Catacombs" sign (Cs2b) is a shop trigger (cap type 0x1C), so her
reward could be bought over and over. The user asked for 0 gold and once only.

## Decisions and evidence
- Of the 25 shipped shops only one greets with a non-merchant line: Cs2b shop 223225, greeting 792
  (HL_13_02, "...This should help you see things clearly."), stock: Torch Light Spell Book
  (Price 100). Every other greets with mm_* (Sound.ctx 1466–1472).
- So `isGiftShop` = greeting not in 1466–1472. Each entry is free and, once taken, leaves the offer
  for good: story flag `<act>-gift<index>:<shop id>` (fits `STORY_FLAG`), saved with the story
  (persisted at once, like a fired trigger).
- A gift shop buys nothing (`shop_refuse`): with free buy-back, selling there would mint gold.

## Deviations from the original
- Always on. The original trades the hermit's book at its Price and refills it on every opening
  (0x46CD80 writes nothing back), like any shop.

## Gotchas
- No converter change, no manifest bump: detection runs on `greeting` at runtime. A future shop
  with a merchant greeting outside 1466–1472 would wrongly become a gift; add it to
  `MERCHANT_GREETINGS`.
- Flags are per act: the same gift in another act's copy of a level would be takeable there again.

## How to verify
- `pnpm test:unit` (shops.test.ts, gift shop case).
- Cs2b, hermit lady at the catacombs sign: Tab → "Reward" window, book "Free"; take it, reopen →
  "Nothing left to take."; relog → still empty.

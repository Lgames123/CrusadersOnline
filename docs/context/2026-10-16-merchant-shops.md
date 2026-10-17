# Merchant shops (non-original feature, on by default)

Date: 2026-10-16 · Agent: Claude Code · Commit: Merchants open a shop: buy at items.ctx prices, sell for half

## Why
The user asked for merchants that trade, for every merchant NPC. In the original they neither
speak nor trade (executable-analysis.md §18), so this is a deliberate deviation.

## Decisions
- Gameplay feature `merchantShops`, the only one on by default: `DEFAULT_ON_FEATURES`, and
  `GAME_FEATURES=-name` switches a default-on feature off (`parseFeatures`, server/src/config.ts).
- Merchants = placements named "*Merchant*" (`merchantKindOf`): eMerchant1 (Citadel, Cador Sul) →
  human; DwarfMerchant* (Corantha) → dwarf; DasherMerchant1 (Duskwood) → dasher. Carried in
  `mobSpawns[].merchant` (level.ts), so placements need no reconvert.
- Stock per people in `MERCHANT_STOCK` (invented: the original has no lists); price = items.ctx
  `Price`; selling pays `floor(price / 2)`; keys/quest items (type `key`) and price-0 items are refused.
  Selling a stack sells all of it; worn items can be sold (equipment re-applied).
- Protocol: CS 0x13 SHOP_OPEN / 0x14 SHOP_BUY / 0x15 SHOP_SELL, SC 0x51 SHOP (stock as item views
  with price). Inventory views carry `value` (the sell price) for the tooltip.
- Server checks reach (12 ft + 0.5 m, as talk), merchant alive and not fighting/fleeing, player free
  (`inventoryBusy`). Opening makes the merchant face the buyer (watch state).
- Client: Tab on a merchant (prompt "trade with the Merchant") → shop window left of the inventory;
  click buys (Shift: up to 5 potions), right-click or drag a bag item onto the shop sells; walking
  away (> reach + 1.5 m) or closing the inventory closes it.

## Gotchas
- Merchants have no talk line, so without the feature Tab on them does nothing (original).
- Gold changes arrive via PLAYER_STATS; bag via INVENTORY_UPDATE (no shop-specific reply).

## How to verify
- `pnpm test:unit` (shops.test.ts).
- Checked in the isolated client, Ci1b beside eMerchant1: stock of 12 at items.ctx prices, sold the
  Long Sword for 60, a 100-gold Mace refused at 60 gold, bought a Metal Shield (60 → 10).

## Follow-ups
- Per-merchant stock (by act) or limited quantities if wanted; buy-back of sold items.

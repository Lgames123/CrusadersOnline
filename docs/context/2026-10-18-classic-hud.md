# Classic HUD (default), modern panel top left, stats optional

Date: 2026-10-18 · Agent: Claude Code · Commit: The original's HUD coins as the default HUD; modern panel top left; performance stats optional

## Why
User asked for the HUD in the top left corner, the FPS / tick / network line toggleable, and the original's HUD as a choice, on by default.

## Decisions and evidence
- Materials loaded by 0x468430 into 0x58AE98-0x58AEF0 (HUDbody, HUDwheel, HUDcover, HUDwheelM, HUDcoverM, HUDHealthCoin, HUDSLRing1-3, HUDSpell<11>, HUDstElem / HUDstSpirit / HUDstGE). Layout 0x468800 on the 640 × 480 screen: coins 76.8 square, health (10, 10); spell 64 square (16.4, 87.44); mana (10, 152.08). With a selected quick item (player +0x1BD ≥ 0) the item is drawn at (48.4, 119.44) and spell / mana move to (16.4, 152.72) / (10, 217.36).
- Draw order (0x4697E0): wheel on the gauge quad → cover if the fraction < 0.4 (0x468F90, double 0.4 at 0x4E1338) → body → coin (health: HUDHealthCoin; mana: the school stone, upright) → number (`%d`, centred, health at y + size − 14, mana at y + 2).
- Gauge quad 0x468F90: corners ±size/2 turned by (1 − f) × 211° (constants 1.0, 211, π/180); mana corners negated (a half turn), and its cover / body quads are built half-turned (the plate on top). Turn direction (counter-clockwise on screen) chosen because only that hides the wheel's far end under the right-hand cover at low health; the transform's row/column convention was not checked.
- Coin blend: 0x468B60 sets HUDHealthCoin's factor to 100 − x after a health change; read as x = health % (Drake at full, skull at 0). Not confirmed what 0x4CED64 converts.
- Ring = HUDSLRing{level} (0x58AEB0 + 4 × index, index from the spell record +6). School stone: spell index 0-5 Elem, 6-8 Spirit, 9-10 GE (SPELLS has the original's order).
- Scaled to the window's height (innerHeight / 480), pinned to the screen's top left, not to the centred 4:3 view.

## Deviations from the original
- Modern panel (bars, XP, statuses, gold) is the opt-out (Options → Gameplay → Classic HUD off). Stats line (top right) off by default.

## Not done / not decoded
- Quick-item slot (the game has no selected item; the hotbar holds them) and its layout shift.
- Spell recharge whitening (factor on HUDSpell, COLOR0 240 while +0xA8 counts down), the HUD message line and the flashing timers (0x58B084 / 0x58ADCC / 0x58AEF4), Hide HUD.
- The engine font: numbers use an 11 px serif stand-in.
- huddisk / hudmanahi / hudmanalo are converted but not referenced by the HUD code.

## Gotchas
- `Hud.stats()` decides visibility: nothing shows until the first PLAYER_STATS (offline: no HUD).
- Chat's default place is now the bottom left (the panel moved up).

## How to verify
- spells-client + spells-server, guest: coins top left with 320 / 110 and Slow in a level-1 ring. Options → Gameplay toggles Classic HUD and Show Performance Stats.

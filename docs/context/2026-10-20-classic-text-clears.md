# Classic HUD text lines clear again; message line centred; login logo image

Date: 2026-10-20 · Agent: Claude Code · Commit: Classic HUD text lines clear on time, message line centred, login logo image

## Why
User: pick-up messages and NPC lines never left the screen; the message line sat right of centre.

## Decisions and evidence
- Bug: `#classic-text [hidden] { display: none }` and `#classic-text .ct-line { display: flex }`
  have the same specificity and the second came later, so `hidden` never hid a line (the timers
  did fire). The hide rule now comes last as `.ct-line[hidden]`; checked in the browser (hidden
  line → `display: none`).
- Durations unchanged: message 5 s (0x4692F0), speech max(2.5 s, voice + 0.6 s), notice 2 s.
- Login screen: the CSS "Crusaders / Online" wordmark is replaced by the user's
  `client/public/crusadersonline.webp` (user's change).

## Deviations from the original
- Message box at x 125 (centred on the 640 frame), not the original's (250, 16) box 390 wide,
  whose centre is x 445. Always on.

## How to verify
- spells-server + spells-client, classic HUD: pick something up → the message is centred at the
  top and goes after 5 s; talk to a creature with a line → the subtitle goes after it ends.

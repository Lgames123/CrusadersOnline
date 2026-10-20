# Classic HUD: the three text lines and the spell icon's flash

Date: 2026-10-20 · Agent: Claude Code · Commit: Classic HUD shows the original's speech, message and notice lines and flashes the spell icon on a cast

## Why
Fidelity stand-ins left by the classic HUD (2026-10-18): the spell recharge whitening and the
HUD message line.

## Decisions and evidence
- **Three text lines**, created by the HUD init `0x468430` with box and position (640 × 480):
  - speech `0x58B084`: 560 × 150 at (40, 320), set by `0x4691E0`. Its callers `0x403FD4` /
    `0x408BB5` pass a voice line's text (table `0x626D00`) and length.
  - message `0x58ADCC`: 390 × 50 at (250, 16), set by `0x4692F0`, mostly 5000 ms (pick-ups,
    God mode…). It replaces a live message only at the same or a higher priority (+0xC2).
  - notice `0x58AEF4`: 500 × 400 at (100, 80), set by `0x4693F0`. Message triggers (`0x4632CF`,
    2000 ms) and side-quest talk (sound length × 2).
  - Colour: white, or (255, 20, 20) with the alert flag.
  - `0x4697E0` draws each line until GetTickCount passes its deadline.
- **Spell flash:** the cast `0x4BCF70` calls `0x468F40(500)` after the spell's can-cast /
  cast. `0x468B60` then counts +0xA8 down by the frame time and sets HUDSpell's FACTOR0 =
  left / 500 × 100. metatex.ctx gives every HUDSpell<Name> COLOR0 = 240, 240, 240, so the icon
  turns light grey and fades back over 0.5 s.
- Classic HUD only:
  - voice subtitles → speech line (no speaker name);
  - signs and hints → notice line;
  - loot, quest news, errors and the server's system lines (not admin) → message line.
- With the modern HUD, the subtitle box and the notices over the head stay as they were.

## Deviations from the original
- The server's system chat lines (gold, XP, refusals) also go on the message line.
- The flash starts when the client sends the cast (after its local checks), not on the server's
  confirmation.

## Not done / not decoded
- The engine font. A serif with an outline stands in.
- The 4-line log (`0x4694C0`, ring at +0xCA) and the quick-item slot. The game has no selected
  item; the hotbar holds them.
- Hide HUD.

## Gotchas
- `ClassicText` injects its own CSS and sits on a centred 640 × 480 frame. The coins stay pinned
  to the top left.

## How to verify
- spells-server + spells-client, guest:
  - R: the spell coin goes grey-white and fades back in half a second;
  - Esc → Unstuck twice: the red "You can use Unstuck again…" message at the top.

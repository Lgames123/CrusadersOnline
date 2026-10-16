# Signs and tutorial hints show their text (message triggers)

Date: 2026-10-16 · Agent: Claude Code · Commit: Signs and walk-in hints show their messages.ctx text

## Why
The sign near Ye Olde Catacombs (and every other sign) showed nothing on Tab: cap type 0x1A and
`script/messages.ctx` were never read.

## Decisions and evidence
- Type 0x1A = message trigger: loader switch 0x478875 patches vtable 0x4E19D4; slot 5 (0x4632B0)
  shows `messages[+0x34]` for 2000 ms. Table 0x589AB0 (64 entries) filled by 0x464FC0 from
  `script\messages.ctx`, one `#)Text` per line. Details in asset-format-discovery.md (type table).
- Activation +8, through the touch test 0x460320: bit 0 fires on every check while inside, bit 3
  needs the use key, 0x200 once (+0x0C bit 1), 0x100 only lets a script re-arm (0x464160).
- Converted as `story.messages[]` (id, activation, volume, message, text) beside `triggers`, so the
  server's walk-in loop never treats them as flag triggers. Manifest 1.21.0.
- Client only (display, no authority): Tab reads any sign volume the player stands in, on top of
  whatever else Tab does; walk-in hints show on entry and refresh while inside; once-only ones
  reset per level load.

## Deviations from the original
- "Tab — read sign" prompt (same QoL hint as other interactables). Subtitle box keeps its 2.5 s
  minimum instead of exactly 2 s.

## Not done / not decoded
- Volume-less message triggers fired by scripts (Du2a #18 "Got Dain's Scepter…", Cs4b #25) are
  not wired: relays/sequence steps reference them as `{ object }`.
- Bit 0x40 (player-bit gate) ignored; no message trigger uses it.
- Du8c / Du9c signs point at entry 0, the file's header joke line; shown as the original does.

## How to verify
- Isolated server (test-cutscene-isolated skill) with `ARENA=level:cs1b`,
  `DEV_GUEST_SPAWN=532.79,294,-650.44`: prompt "Tab — read sign", Tab shows "Ye Olde Catacombs".
- `train` shows the tutorial hints on walking into their volumes.

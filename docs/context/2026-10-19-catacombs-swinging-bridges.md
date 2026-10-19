# The Catacombs' swinging bridges

Date: 2026-10-19 · Agent: Claude Code · Commit: The Catacombs' swinging bridges hang beside the planks and carry whoever stands on them

## Why
User: a swinging platform near the WhiteMenCantJump planks in Ca*b was missing.

## Decisions and evidence
- Two brushes, `bBridgePiece4` / `bBridgePiece5` (mask 0x3F, same in Ca1b/2b/3b): 16 × 64 ft decks
  (boards ~1130 ft, rails to 1141) on chains up to 1248 ft, at x 3352-3368 / 3240-3256, z -2686..-2750
  (mirrored). Dropped by the converter: 887 vertices / 894 faces, over its 512 cap. Cap now 1024
  (converter 1.32). 485 of the 894 faces have a null material (never drawn, so not read).
- Mover: one segment, type 0xA0 (turn about Z), key (-10°, pivot x 3347.76 / 3235.99, y 1269.71),
  flags 0x4002C01 = mode 1 (ping-pong forever) + eased; speeds 6e-5 → 9e-4 / 5e-5 → 8e-4 per ms.
  The rest pose is tilted, so it swings about ±5° through vertical. That is ~23 ft sideways,
  ~7.5 s a full swing.
- Started by walk-in mover triggers (0x1E, activation 1), volumes x 2832-3600 / 2944-3712,
  z -2466..-2944, y 640-1408 (the whole pit area). The converter writes walk-in mover triggers on
  `bridge` brushes as one-op relays, like the use-key ones (1.26).
- `worldTrigger` now also covers walk-in relays that only move brushes (no sounds): they fire every
  tick inside the volume and save no flag (a moving mover ignores the use), so a zone restart can't
  leave them still for a character who already went through. Ws9a's walk-in cell-door relay has a
  sound and keeps its once-per-character flag. World triggers no longer persist the record.
- Brush faces were turned to face away from the brush's centre (assumes convex). The bridge's centre
  sits among the chains, so the deck rendered inside-out (culled: "transparent"). Measured instead:
  on all 438 faces of the acts' simple slabs, the Z-mirrored index order is clockwise seen from
  outside. Every brush face is now just reversed. This also changes the inner faces of non-convex
  brushes (Ca*a bPlat rings, Bs1a gears), which the centre test had flipped.

## Deviations from the original
- Riding the deck: `carryOnBrush` moves a grounded character whose feet are over the brush's
  collider (ray 0.5 m up to 0.4 m down) with the brush's pose change. The server applies it to every
  actor after the mover steps. The client applies it to its own character, records it per tick and
  replays it on reconcile when grounded. The original's mover collision (0x48E370) is not traced: how
  it moves Drake is a guess.

## Not done / not decoded
- The winding change on the rings and gears is not checked in game.
- Other walk-in movers are still at rest: wheels, Gl*b crushers (they would need their damage),
  chandeliers, Bs1a gears.
- The 1024 cap also reads Ci*b `bBigWheel1/2` and Ws5a `bAirship` (575-601 vertices, drawn only,
  not solid, never moved: no trigger). Not checked in game.

## Gotchas
- Newly read brushes sit at their record position in the list: door ids (500000 + index) shift in
  Ca*b, Ci*b and Ws5a. Nothing persists them.
- At 20 Hz the deck moves up to ~0.3 m a tick. The carry probes against the brush's new pose, so
  someone at the very edge of the deck can drop off.

## How to verify
- `pnpm convert`, restart the server; `pnpm test:unit` (swinging_bridge.test.ts: a 20 s zone run on
  Ca1b keeps a player on piece 4 between x 3337 and 3361 ft at ~1129.7 ft).
- In game: launch.json `bridge-server` / `bridge-client` (guest on piece 4's deck). Not yet watched
  in the browser (the pane was hidden, so the page did not tick).

# The Catacombs lever opens the floor

Date: 2026-10-17 · Agent: Claude Code · Commit: The Catacombs lever sinks the floor rings into a stair, as the original

## Why
The lever near the Thunderous Hammer in Ca1a/2a/3a did nothing: the floor beside it should open.

## Decisions and evidence
- Ca*a has no relay (no type 0x2B). The cap holds six mover triggers (0x1E) and one sound trigger
  (0x0B), all with the use key (activation bit 3): `bLever1_1` (0x208, own volume) and `bPlat1`–`bPlat5`
  + sound 519 (0x8 / 0x208, one shared volume 2460–2472 × 1632–1648 ft, beside the lever). The use key
  there fires each directly (0x460320 → slot 5, mover's use 0x461B10).
- Converter 1.26 writes every unrelayed use-key mover trigger on a non-door brush as a one-op relay
  (`brushes: [name]`), plus use-key sound triggers sharing such a volume (`sounds`). Shipped hits:
  Ca*a lever + rings + 519, Ca*c `bTortTop1`, Ws1a/5a/9a `bLever1_1` (harmless: the lever moves anyway).
- Brushes named by any trigger's `brushes` that have a mover become world objects (kind `door`,
  `byLever`: never by hand), so the server steps them and moves their collider (setBrushPose).
- Rings are the floor: under them the level mesh is the pit at 872 ft (top 896). They sink 4–20 ft
  (mode 6, once) into a stair; the lever stands on a solid ledge (mesh floor at 896), so Drake at the
  lever stays up.
- The rings are not convex: as hulls (the brush collider until now) each filled the pit, so the
  outer ring, sunk only 4 ft, still covered it. Solid non-door brushes now collide as their faces
  (trimesh from the placements' faces, indices count the pivot); doors keep their hulls (swing code).

## Decisions on repetition
- Use-key relays without 0x200 that only move brushes / play sounds (`worldTrigger`: Ca*a rings,
  Ws1a/9a gate levers) fire on every press and save no story flag, as the original (no once bit).
  Gotcha found in play: with a per-character flag, a server restart shut the rings again while the
  saved flag kept the lever dead for that character. The lever's own trigger and sound 519 (0x208)
  stay once per character; the lever object still turns by hand. Ws9a: re-pulling now reopens the gate.

## Not done / not decoded
- Walk-in mover triggers no relay fires (wheels, Ca*b bridge pieces, Gl*b stalactite crushers,
  chandeliers, Bs1a gears / `bnecrosdoor2`): still at rest. Crushers would need their damage.
- Door brushes' own use-key mover triggers are skipped on purpose (the door code opens them and
  plays their sounds); slot 2 of 0x4E1CE0 (touch → fire) assumed, not decompiled.

## How to verify
- `pnpm test:unit` (doors "the use key in a mover trigger's volume…", level "makes the brushes…",
  level "collides a solid piece as its faces…").
- Reconvert + restart the server; Ca1a at the lever (≈ 751, 273.4, −500.5 m): Tab → lever turns,
  the five rings step down into the pit, sound 519; walking west off the ledge lands at 876 ft.

## Follow-ups
- Walk-in mover triggers (and the crushers' hit) the same way.

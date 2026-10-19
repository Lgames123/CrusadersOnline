# Catacombs planks, pillar checkpoint and pit catch

Date: 2026-10-19 · Agent: Claude Code · Commit: The Catacombs' easy planks on every difficulty; a checkpoint before the pillars and a pit that gives fallers back · Supersedes: the brush gotcha of 2026-10-17-difficulty-placements.md

## Why
Ca*b's pillar crossing: the user wanted the easy-difficulty planks always present, a respawn point
before the section, and players who fall into the pit (closed: they got stuck) sent back, not killed.

## Decisions and evidence
- The planks are brushes `bWhiteMenCantJump1-4` with cap +8 = 0x27 (easy only), the only brushes
  in any act whose mask is not 0x3F (swept all caps). Same coordinates in Ca1b/2b/3b (mesh ca_b).
  Converter 1.29 reads every brush mask, writes `difficulty`, appends them after the 0x3F ones
  (door ids = brush index); the arena does not filter brushes by difficulty.
- Solid as their faces (SOLID_BRUSH matches `cantjump`): 0.5 ft thick boxes, 8 ft wide, at 1133-1133.5 ft.
- Pit (FALL_CATCHES.ca_b, original ft, Z mirrored): x 2540-3640, z -2880..-2500, below 1080 ft.
  Pillar tops 1128 ft, pit floor 768-840 ft (flood fill: one closed basin x 2560-3622); no other
  floor in that box between 840 and 1100 ft but rock flanks, so the box never catches a walker.
- Checkpoints: the ledge before plank 1 (spot 2620, 1128, -2667) and the platform after plank 4
  (3310, 1128, -2785, for those coming from Ca*c). Walking onto one sets `respawnSpot`, so deaths
  respawn there too (seen in play: Skeleton 13 killed the guest, he came back on the ledge).

## Deviations from the original
- All always on: planks on medium/hard; the original's pit kill (not decoded) replaced by the catch.

## Gotchas
- Part of the J2/J4 plank paths lie over mesh floor (the level mesh has its own walkways there):
  test points over the pit must come from `floorAt` returning null at 1128 ft.
- The checkpoint is per player, not saved: a relog keeps his position, then his respawn spot is
  the area start again until he walks onto a checkpoint.

## How to verify
- `pnpm convert`, restart the server; `pnpm test:unit` (fall_catch.test.ts).
- In game: Ca1b from Ca1a, the brazier ledge: planks zig-zag across the pillars; step off beside
  plank 1 and you are back on the ledge before ~15 m of fall.

## Follow-ups
- Same table for other closed pits if found (only ca_b has one known).

---
name: convert-assets
description: Use when changing what the converter emits (levels, textures, placements, models, story) or when converted assets look stale — run pnpm convert, bump the manifest version, and keep original game data out of git.
---

# Converting the original game's assets

`pnpm convert` reads the user's install (`Crusaders of Might and Magic/`, git-ignored) and writes
`local/generated/` (git-ignored), served in development at `/generated/*`. ~20 s for everything.

## Rules
- **Zero-IP**: nothing from the install or from `local/generated/` is ever committed; code and
  docs only. Never `git add -A` (untracked decompiled folders were pushed once).
- **Bump `MANIFEST_VERSION`** in `converter/src/pipeline.ts` whenever emitted data changes, with
  a short note in its comment. Inputs are cached by hash: without a bump the old files stay.
  The bump also makes browser imports reconvert.
- After a convert, restart the game server (it loads placements and story at start).

## Facts the emitters rely on
- Level and brush textures: **one picture every 15 units** (u = U·(X−P) / 15); **v = 0 is the
  picture's bottom row** (TGA rows as stored). All level textures are 128 px.
- Placements are in a **Z-mirrored frame** (positions, volumes, camera paths). Mover keys are
  mirrored per segment type (`mirrorMoverKey`): moves negate dz, turns about X/Y negate the
  angle and z, turns about Z stay as they are.
- Relays carry the brush they move in the dword just before their record (`cap_story.ts`).

## Check
- `node -e` on `local/generated/levels/<act>.placements.json` or the GLB JSON chunk to confirm
  the new data before testing in game.

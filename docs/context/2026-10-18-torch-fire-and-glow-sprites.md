# Torch fire and glow sprites as the original

Date: 2026-10-18 · Agent: Claude Code · Commit: Torches burn the original's procedural fire; glow sprites drawn

## Why
Torch flames were a radial-gradient ball sprite (a placeholder), not the original's effect. The other sprites (Flare02-04, Flickerslow) were not drawn at all.

## Decisions and evidence
- A cap sprite (class 0x36) keeps its draw data in component slot 1, runtime class 0x4E11E0 (0xD8 bytes, ctor 0x466D70, slot table 0x639550): half height +0xC8, half width +0xCC, raise +0xD0, the metatex / image name at +0xD8. Load 0x466DE0 looks the name up in the metatex (0x47C860). +0xD4 is a stale texture-cache index (0x4AFC80), so ignore it.
- The draw (vtable +0x28, 0x466E50) picks one of two routines from the raise:
  - raise ≠ 0 → 0x467230: a world quad, x −w..w and y raise−h..raise+h, turned about the vertical toward the camera (yaw = atan2 from camera to sprite).
  - raise = 0 → 0x466E80: a screen-facing quad, centred, with its depth pulled 50 camera units nearer.
  - Both are white vertices over the image, u 0..1 left to right, v 0 at the top.
- Every TORCHFIRE is 4 / 1.2 / 4, so the quad is 2.4 ft wide and spans 0..8 ft above the point. Its texture is metatex `torchfire` = `BASE=Fire`, the same procedural fire the sword trail wears (fire_texture.ts). The image fills only its lower half, so the visible flame is about 4 ft tall, hottest at the torch head. All torches share one FireTexture instance, as the original has one Fire image.
- Glows: Flickerslow 2.5 (Citadel), Flickerslow 1 (Co, Cs inns), Flare02-04 12 (Bs1a). They are drawn additive, like the effects' glow textures.
- The converter reads slot 1 directly. It replaces the old "first upper-case string" scan, which missed every lower-case image name (437 sprites).

## Deviations from the original
- The glow depth pull is 50 / 54.6 ft (≈ 0.92 ft). This assumes the camera's depth units are 54.6 per foot, as in the effects sprite note (executable-analysis.md, Units). This is inferred, not measured.
- Fire is alpha-blended (as the trail). The draw flag `*poly = 4` passed to 0x4AA3A0 is not decoded.

## Not done / not decoded
- The original's cull test in 0x466E80 (`fVar3 < z`, from viewport ints at camera +0x114..0x120) is not reproduced.

## Gotchas
- `loadTexture` in original_level.ts loads images the glTF way (flipY false). LevelSprites clones glow images with flipY true, because a three.js sprite's v 0 is its bottom. The fire quad instead flips its UVs (DataTexture row 0 = v 0 = top, as D3D).
- No manifest bump: placements are rewritten on every `pnpm convert` (4 s). Run it once so the fields appear (the new fields are `sprite` and the sprite's `texture`).
- In the browser pane, the game canvas can end up 0×0 after loading a level offline; a `resize` event brings it back. This is unrelated to these sprites.

## How to verify
- `?level=ca1a` → Play offline: the wall torches beside the start burn animated procedural fire, standing on the bracket.
- `?level=cs1b-inn`: wall-lamp halos (Flickerslow) at y ≈ 314 m.
- `pnpm test` integration `persistence.test.ts` hung / was killed while the user's dev server held the DB. It was not run to completion here.

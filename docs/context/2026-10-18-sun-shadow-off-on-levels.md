# Stock sun shadow off on original levels

Date: 2026-10-18 · Agent: Claude Code · Commit: Sun casts no three.js shadow on original levels

## Why
Follow-up from [Object shadows](2026-10-18-object-shadows.md): the renderer's `sun` (castShadow, 2048² PCF map) predates the unlit levels; on original levels nothing receives it.

## Decisions and evidence
- Measured on cs1b, Play offline (1024×768, RTX 3090 Ti): sun castShadow on = 68 draw calls / 26,912 tris per frame, off = 65 / 25,801. The extra 3 calls are the player's casters (drake_mesh, longsword, shield). Online, every character mesh adds its own draw.
- Full-frame readPixels on vs off is pixel-identical, and 0 visible meshes have receiveShadow.
- GPU time (EXT_disjoint_timer_query, median of 100 × 5 rounds) ~0.25 ms either way: the saving is within noise on this GPU. The real gains are the skipped depth pass (scales with characters) and the freed 2048² target.
- `applyAtmosphere` turns `castShadow` off and disposes `sun.shadow.map`. `renderer.shadowMap.enabled` stays on: three skips the shadow pass when no light casts.

## Gotchas
- The synthetic arena never calls `applyAtmosphere`, so it keeps the sun shadow (arena.ts, avatar.ts use lit materials). Like the lowered intensities, nothing restores castShadow if a session later switches from a level back to the synthetic arena.

## How to verify
- `?level=cs1b`, Play offline, console: find the DirectionalLight in `__co.scene` → `castShadow === false`, `shadow.map === null`; `renderer.info.render.calls` is 65 with `autoReset` off around `__co.render()`.

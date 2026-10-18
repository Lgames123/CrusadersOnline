# Object shadows (objectShadows setting)

Date: 2026-10-18 · Agent: Claude Code · Commit: Object shadows from props and bushes, redrawn only when the camera moves

## Why
Request: shadows from barrels, trees and the larger plants, as cheap as the foliage (culling, saving work), with an on/off toggle.

## Decisions and evidence
- The engine is `engine/prop_shadows.ts`. Casters are the placed objects at least 0.5 m tall that are not ground items, plus the foliage's bush01 / plant01 cells. On cs1b that is 187 meshes.
- Receivers are the lightmapped level materials and the grass. Props, characters and bushes do not receive, so nothing shades itself.
- The shadow maps are static and cover 2048² over ±36 m around the camera. They are redrawn only after the camera moves 5 m, when a caster is shown or hidden, or when the foliage's `shadowVersion` changes (at most every 0.5 s). A redraw costs ~0.7 ms GPU-synced. Frames in between cost the same as with shadows off: 0.7–0.9 ms against 0.87 ms on cs1b.
- Two depth passes. The first draws the casters. The second draws the level's first surface past them along the light, discarding level fragments at or in front of the casters' depth.
  - A receiver is shaded only if it lies behind a caster and is not behind that surface. So roofs and walls keep outside trees' shadows off interior floors.
  - One nearest-surface map with a caster/level flag was tried first. cs1b is a canyon, and the cliffs stood between the light and most props (flagged texels dropped from 83k to 53k), so most shadows disappeared.
- Only the baked light is darkened (strength 0.6, × 0.85 on texels the lightmap leaves in shade). Torch light from enhanced lighting is added after the shadow and stays unshadowed.
- The cs1b outdoor ground is mostly lightmap "shade" (≈28–50 sRGB). With no darkening on shade texels, shadows did not show at all.
- `LIGHT_DIR` (model_light.ts) is shared with the character silhouettes. It changed from (0.35, −1, 0.25) to (0.55, −1, 0.4) normalized, about 56° up. Before that, shadows fell almost straight under the objects and were hidden.

## Deviations from the original
- Not original. Options → Graphics → Object Shadows is off by default. Switching it builds or frees the maps and recompiles the receivers live.
- The silhouette shadows' light is now more slanted (also optional, off by default).

## Not done / not decoded
- Brushes (doors, bridges) neither cast nor receive. Props and characters standing in a tree's shadow are not darkened.
- Casters past ~30 m from the camera cast nothing (the fade runs from 22 to 30 m).
- The bushes' shadows are thinned as seen from where the map was drawn. They can lag the drawn bushes by up to 5 m of movement.

## Gotchas
- three reuses a program variant it compiled before (`customProgramCacheKey` switched back) but keeps the uniforms object of the *last* compile. Shader-patching toggles must add their uniforms even while off.
  - Otherwise the shadow samplers fall to unit 0 and the level samples the wrong texture: it shows the sky texture on the ground.
  - `dynamic_lights.ts` had the same bug: enhanced lighting switched on → off → on lost its lights. Both are fixed.
- `propShadows.receive()` wraps the material's existing `onBeforeCompile`. Call it after `dynamicLights.enhance`, which assigns one outright.
- Render layers 5 (casters) and 6 (level) belong to the shadow passes.
- Screenshots after `renderer.setAnimationLoop(null)` show stale frames. Compare frames with `readPixels` right after `__co.render()`.

## How to verify
- `?level=cs1b`, Play offline, Options → Object Shadows (and Grass and Bushes). Look at the wagon and haystack around (622, −314).
- In dev: `__co.propShadows.draws` and `.lastDrawMs`. Setting `uniforms.uPSParams.value.y = 1` makes shadows black, to see where they fall.

## Follow-ups
- The renderer's default sun likely still renders a 2048² three.js shadow map of the characters every frame, and nothing receives it: `sun.castShadow`, `shadowMap.enabled` and the models' `castShadow` are all set, and every level and model material is MeshBasic. This was not measured. Turning `castShadow` off in levels would save that pass.
- Darken props and characters in shadow (sample the map on the CPU or in their shader).

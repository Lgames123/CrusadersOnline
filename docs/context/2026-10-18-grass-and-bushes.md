# Grass and bushes (foliage setting)

Date: 2026-10-18 · Agent: Claude Code · Commit: Grass and bushes on the levels' grass ground, wind only near the player

## Why
Request: performance-first grass and bushes, with Perlin-noise wind only near the player, a toggle, an adjustable render distance, and density sliders for grass, bushes and plants that can go higher.

## Decisions and evidence
- Instanced geometry rather than a grass shader on the ground, geometry shaders or alpha cards. The level is unlit (texture × lightmap, MeshBasicMaterial), so foliage needs no lighting.
- Grass ground = the earth (`_ER_`) textures whose texels are ≥ 30 % grass. A grass texel is green ≥ 0.95 × red and ≥ 1.3 × blue: painted stones are grey and dirt is brown. Tufts grow only where the texture's 16×16 cell under them is grass, so the stone and dirt patches in Dw_ER_011…030 stay bare.
- The footstep classifier (`surfaceOf`, green > 1.08 × red on an 8×8 `drawImage`) is not used for grass. Dw_ER_024 (avg 74,79,38) passed it only by luck, so es1a, co1a and others got no grass.
- `_OG_` textures are alpha-cut leaf cards, not ground. ER_050 and ER_055 are mud and dirt.
- Each blade samples the ground texture at its root (`aGroundUv`, plus a few texels along the blade), multiplied by the lightmap texel × 2/π. Three r186's MeshBasicMaterial multiplies the lightmap by RECIPROCAL_PI (meshbasic.glsl.js), so blades match the floor exactly, including the texture's own colours.
- An earlier version gave each tuft one averaged colour. The averaging washed out the texture and a green tint stood out against the ground.
- Bushes reuse the original bush01 / plant01 models in their node frame (2.14 m / 1.16 m, as placed). Their light is lightmap × gain with no 1/π, the way props are lit.
- Cost: one draw call per 10 m cell and kind. Cells grow only when they come within the render distance: nearest first, deterministic per cell and kind, at most 3 ms a frame. Cells are freed 20 m past the distance, so memory follows the area around the camera.
- Inside a cell, instances are sorted by a random rank. The CPU draws the first N for the density at the cell's nearest point, and the vertex shader shrinks the rest.
- An earlier version scattered the whole level up front: 420k tufts on cs1b at 2×, ~18 MB. That capped how high the density sliders could go.
- Only cells near the player use the `FOLIAGE_WIND` (Perlin) shader variant. The sway fades out before the variant switch, so nothing pops.
- Density: 100 % is 12 tufts/m², the earlier 200 %. Bushes are 0.024/m² and plants 0.07/m². The sliders go to 300 %. A change regrows the cells in reach, nearest first.
- Cs1b measurement (GPU-synced frame, 35 m): 100 % allocates 21k tufts at 2.7 ms and 300 % allocates 63k at 3.2 ms. At 300 % / 90 m, 215k are allocated at 3.6 ms.

## Deviations from the original
- Not original. Options → Graphics has a `foliage` toggle (off by default), `foliageDistance` (15–90 m, default 35), and `foliageGrass` / `foliageBushes` / `foliagePlants` (0–300 %, default 100 %). The toggle builds or disposes the foliage live. Distance only changes uniforms, and density regrows the cells in reach.

## Not done / not decoded
- The original's placed foliage (bush01, plant01, leaf03, tree leaves) does not sway.
- Foliage has no collision. Bushes stay 2.2 m and grass 0.5 m from placed objects and doors. Exits and start points are not avoided.
- Enhanced lighting (dynamic torches) does not light foliage.

## Gotchas
- A downscaling `drawImage` picks texels and does not average them. Read full-resolution pixels for any texture statistic.
- The lightmap is bimodal (shade ~75, sun ~240 texels). Dark patches of grass are correct.
- Foliage meshes assume an identity parent (`root` of the level). Their shader works in world metres and ignores `modelMatrix`.
- `instanceCount` counts what the CPU submits. The shader still hides instances past their rank, so the visible count is lower.
- A freed cell's `geo.dispose()` also frees the shared base attributes' GL buffers. Three re-uploads them on the next draw (small).
- The ground textures must stay wrap-repeat, because blades sample at the ground's UVs, which run past 1.

## How to verify
- `?level=cs1b` (or es1a, co1a), Play offline, Options → Grass and Bushes, then Grass Render Distance. Grass near Drake sways and parts around his feet. Stones and dirt patches have none.
- In dev: `__co.scene.getObjectByName('foliage')`. Each chunk's `geometry.instanceCount` is the number drawn.

## Follow-ups
- Make the original placed foliage sway near the player, using the same shader patch.

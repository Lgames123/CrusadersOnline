# Foliage visibility culling

Date: 2026-10-18 · Agent: Claude Code · Commit: Foliage culled by frustum box, occlusion rays and LOD

## Why
Request: visibility techniques (frustum, occlusion, portal culling or better) to make the grass cheaper.

## Decisions and evidence
- Frustum: each 10 m cell is tested as a box (cell bounds plus the tallest foliage). Three's bounding sphere is loose for a flat cell, so foliage meshes set `frustumCulled = false` and the cell test replaces it.
- Occlusion: rays from the camera to a 3×3 grid of sample points on the cell's grass. The rays run through the client's Rapier world (`rayDistance`, collision mesh BVH, character colliders filtered out). It costs ~5 µs per ray, measured.
  - Grass targets sit 0.45 m above the ground and bush targets 2.2 m, so a bush can still show over a wall that hides the grass.
  - Cells within 8 m are never culled.
- Occlusion depends only on where the camera is, not where it looks. A cell is re-tested only once the camera has moved 0.25 m (hidden cells) or 1 m (seen cells) from where it was last tested. Hidden cells go first, within a 1 ms budget. A still camera costs nothing.
- The first version re-tested hidden cells every frame. That spent the full 1 ms budget every frame and cost more than the culling saved.
- Portal culling was not used. The converted levels carry no render cells or portals (`portals` are exits), and the occlusion rays already work on any geometry.
- GPU occlusion queries were not used. They would have to run inside three's and post_fx's render-target passes. The CPU rays are engine-agnostic and run against the same mesh the server uses.
- Geometry LOD: past 45 % of the render distance, tufts are one triangle per blade (9 vertices / 3 triangles instead of 25 / 15).
- Foliage draws with `renderOrder` 1, after the level and characters, so early depth rejection drops hidden blades.
- Cs1b at 300 % / 90 m, measured over 8 view directions (GPU-synced frames): triangles drop from 909k to 172k and from 1205k to 222k. The best view goes from 4.31 ms to 2.44 ms, about the cost with no grass at all.
- Exactness: one frozen frame rendered with and without culling is pixel-identical in 15 of 16 views. The 16th differs by 20 px of distant blade tips at 90 m.

## Not done / not decoded
- Cells that are only partly visible between sample points (a strip of grass just past a wall top) can be culled. The 20 px case is this.
- A camera rounding a corner faster than the budget re-tests can show a hidden cell's grass a frame late.

## Gotchas
- `Foliage.update()` culls only when given `blocked` (main.ts passes `foliageBlocked`). Without it, every cell counts as unoccluded.
- `instanceCount` and `renderer.info` count what is submitted. The shader still hides instances past their rank.
- Benchmark only with `__co.render()` on a frozen frame. Between `frame()` calls the character's idle animation and the camera easing change hundreds of thousands of pixels.

## How to verify
- In dev: `__co.foliage.stats()` gives cells in view and occluded. `__co.foliage.occlusion` and `.lod` switch the techniques off to compare (`renderer.info.render.triangles`).

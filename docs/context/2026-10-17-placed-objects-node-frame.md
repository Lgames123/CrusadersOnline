# Placed objects drawn in their own node frame; prop hit sparks at the contact point

Date: 2026-10-17 · Agent: Claude Code · Commit: Placed objects drop the node transform baked into their model; prop hits spark where the blade meets them

## Why
The user reported objects upside down or floating in several maps (Ci_b kitchen baskets, crates hanging ~0.5 m in the air) and break effects not matching the original.

## Decisions and evidence
- **Cause:** the converter bakes a single-node model's own node transform into its vertices (needed for held items, which `original_models.ts` already undoes at the hand dummy). The .cap matrix places the *raw* model, so placed objects got the node transform twice. Worst cases: `woodbasket` / `fruit01` 180° about X (baskets upside down over their fruit; the .cap flips them back itself), `crate1` 90° about X + 2.8 ft (floated 1.57 ft, stacks misaligned), `skulpst1`, `scroll`, ground shields / armour, and offsets of 26–90 ft on `bush01`, `fence02/04`, `debrisstone01/02`, `volumelight(2)`, `ropehang`, `wagon` 7 ft.
- **Evidence (data, all 25 levels, 11 039 objects):** floor contact measured with the raw .mdl box (what the server's collision already used) vs the baked GLB box: crates 423 vs 245 resting, baskets 165 vs 0, skull posts 56 vs 3, ground shields / armour / dummy all vs none; crate stacks fit to 0.02 ft only raw. Visual check in Ci1b's kitchen: baskets upright with fruit inside.
- **Fix:** `nodeFrameInverse()` (extras `nodeTransform`) is applied after the placement matrix in the client; the held-item mount uses the same helper. Multi-node models (chest, flags) carry no `nodeTransform` and are unchanged. No converter / manifest change.
- **Prop hits (0x44CEF0, landed blow):** chips (5, ±1.2 ft, speed 40) and the material effects come from the blade's contact point; effects step 0.7 ft along the attacker's sweep (constant 0x4E0904 = 0.7). The server now sends `sweep` with breakable hits. The contact point is a stand-in: the prop box point nearest the attacker, 1 m above his feet (the engine reads it from the victim physics' contact record, vfunc +0x44 → +0x20).
- **Break (0x4514E0):** pieces about the object's origin (transform position) with the prop's full extents as half extents — matches the barrel log (3.77 × 4.67 × 3.77 ft = the barrel's size). Speed kept at the logged 1: the decompile passes damage / HP-before there, but the call is garbled and the log said 1.

## Not done / not decoded
- Some objects lie outside every level cell in the data: Ci*b's dining set (5 tables, 8 fancy chairs, sprites) ~32 ft above the tower's cells, over the sea; Ca1a `Barrel9/10`, `Stool2`, `Table01`; ground items in Cs3a, Du1c, Ca1c/2a/3d, Co*a `StonePieces2`. Left as placed. The engine links objects to SpaceMap cells (lookup 0x4395F0 → 0x465660: walk the 2D cell edges, then the vertical stack by top +0x18 / bottom +0x1C; outside → 0; link 0x4379F0 into cell +0x50) and draws per visible cell, but an object without a cell may go to a default list (0x483740 falls back to `[0x53C4C0]`), so whether the original draws them is open.
- Ci1b `Mushroom01/3` lying tilted and similar tilts: identity node, so the tilt is the .cap's own (kept).

## Gotchas
- A prop's `box` in placements is the raw .mdl box (unbaked); the GLB's accessor bounds are baked. Use `box` for anything matching the original.
- Do not "fix" this in the converter by dropping the bake: held items, thumbnails and the inventory preview rely on the baked vertices.

## How to verify
- `http://localhost:3000/?level=ci1b`, Play offline, stand at (2034, 816.5, −1679) ft facing the wall: two baskets full of fruit, upright.
- Ca1d crate stack near (2147, 849, −1925) ft: one crate lies across two.

## Follow-ups
- Settle whether objects outside every cell are drawn in the original (decode the cap object link at level load, or look at Ci1b's tower roof in the original), then hide them if not.

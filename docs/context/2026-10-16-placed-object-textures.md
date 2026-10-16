# Placed objects drawn with their own models.ctx texture; texture sweep of every placed model

Date: 2026-10-16 · Agent: Claude Code · Commit: Placed objects use their own models.ctx texture (bookshelves, flags, ground potions and spell books)

## Why
The user reported the Citadel chairs under the crossed swords and round shield looking wrong, and asked for a pass over the other textures.

## Decisions and evidence
- The converter writes one `.glb` per model file with the **first** binding's texture. Placed objects whose models.ctx id shares that file but names another `T` were wrong: Citadel `Bookshelf02` (id 92 → `Cor_WD_131`, file shared with id 91), Ws1a/Ws9a `Flag03HeavyBreeze` (id 250 → `flagred`, not 248's `flag_3do`), and every ground potion and spell book (items.ctx `Texture` index into the id's list). That's 164 objects in all.
- Placements now carry `texture` (a converted texture path) when the object's texture differs from the baked one: `T[items.ctx Texture]` for ground items, `T[0]` for everything else. The render component (cap object slot 5) holds zeros after the model id at +0x18 on flags and chairs, so no per-placement texture index was found. The client clones the materials of that one object and swaps the map.
- **The fancy chair is the original data, not a conversion bug.** `FCHAIR2.mdl` (id 242) is bound only to `FancyChair`, the only copy in textures.zip, and nothing else (nfo, caps, exe strings) names it. Its UVs put the back panel on u 0–0.65 and the frame pieces on two strips at u 0.65–1. But `FancyChair.tga` is one symmetric panel across the whole width, so the back loses its right-hand frame and the legs pick up cushion red. UV corner order was checked: the interleaved order is by far the most consistent on shared vertices across models. The plain chair (`plnchr`, `T bucket`) is right as converted.
- Sweep: offline renders of all 140 placed (model, texture) pairs from the converted GLBs. Apart from the cases above, nothing looked wrong. No model texture is missing from the zip, and every TGA is bottom-up, so there is no per-file row-order difference.

## Not done / not decoded
- Fancy chair left as in the original (classic feel). A QoL remap of its UVs would be a deliberate deviation.
- Creature or NPC texture variants and held items were not part of this sweep. Corpse props (skinned) were only checked for texture choice, not pose.

## Gotchas
- `bakedTexture` is filled by the models step, which must run before placements (it does, in `pipeline.ts`).
- Manifest bumped to 1.20.0.

## How to verify
- `pnpm convert`, then `node -e` over `local/generated/levels/*.placements.json` to count objects with `texture`. That gives 164: potions, books, 10 bookshelves, 4 flags.
- In game: Citadel interior bookshelves (`Bookshelf2`-style ones are dark wood without books), Ws1a red flags, healing potions on the ground green, speed grey.

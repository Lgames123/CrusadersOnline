# Inventory item looks (texture variants, missing models, shield facing) and future slots

Date: 2026-10-16 · Agent: Claude Code · Commit: Inventory item colours from models.ctx, models for keys/crystals/quest items, shields face front, placeholder slots

## Why
Every potion showed the same 3D bottle, keys/mana crystals had no model (glyph only, nothing held while dragging), the wooden shield was shown from behind, and the user asked for more paper-doll placeholders.

## Decisions and evidence
- Colour comes from items.ctx `Texture`, an index into the model's `T` lines in `script/models.ctx`: model 62 (potion.mdl) = potion-blue, -dkgr, -g, -grey → Lesser Healing 0 blue, Greater 1 dark green, Healing 2 green, Speed 3 grey; model 141 (same potion.mdl) = -ltbl, -purp, -red, -wht → Mana 1 purple, resistances 0–3. Books (63, 137–140), scrolls (106), ring 4, metal shield 28 and long sword 8 have lists too. Lists are copied into `MODEL_TEXTURES` (`client/src/assets/item_models.ts`), like `MODEL_FILES`.
- `ItemDef.texture` / `InventoryItemView.texture` carry the index (sent only when > 0). The client applies the variant even for index 0, because a file bound to several ids (potion.mdl, book1.mdl) is converted once with the first binding's texture: model 141 index 0 would otherwise show 62's blue.
- Models added to `MODEL_FILES` from models.ctx: 65 horn, 66 dashernecklace, 67 amuletoftruesight, 68 scepterofregency, 69/198/199 manacrystal04/02/03, 84 icekey, 105 rune, 106 scroll, 110 stonekey. All were already converted.
- Shields (28 and its skins, 86 wooden, 131 family) are authored facing the forearm: every one showed its back. They are now posed turned by π. Checked against a full thumbnail sheet of the 76 item model/texture pairs: weapons, armour, books, potions, rings and quest items already faced the viewer.
- `stone1.webp` (Stone Key) has an alpha channel that is 0 everywhere; the converted material's alphaTest 0.5 discarded the whole mesh. Item materials whose texture alpha is all ~0 are drawn opaque (`opaqueIfNoAlpha`, item previews only).
- Equipment board is now 8×6 cells: rings side by side over the weapon, helm top centre, amulet 2×1 over the shield, gloves under the weapon, belt 2×1 under the armour, boots under the shield. Only weapon/shield/armour accept items; the rest are dashed placeholders (the amulet slot will not take rings).

## Not done / not decoded
- The converter still writes only the first texture per model file and leaves all-zero alpha textures with an alpha test; levels may hit the same stone1 problem. A converter fix (opaque when alpha is empty, a models.json with every binding's textures) would replace the hand-copied lists.
- Equipped shields on Drake were not checked for the same facing issue (the forearm attachment uses its own transform).

## How to verify
- `pnpm test:unit` (texture index test in inventory_grid.test.ts), `pnpm -r typecheck`.
- In game: healing potion green, speed potion grey, mana potion purple; Stone/Ice keys and mana crystals show a model in the bag and while dragging; the wooden shield shows planks and the iron boss.

# Ground window names in their rarity's colour

Date: 2026-10-20 · Agent: Claude Code · Commit: Ground window item names take their rarity colour, with a tooltip

## Why
In the ground window (Shift/Ctrl+G) a dropped Tempered or Legendary piece looked like any other item.

## Decisions and evidence
- Names use `modsTitle` (same title + `RARITY_INFO` colour as the bag tooltip): "Tempered Long Sword +4" in purple; Battle-worn / no mods keep the default text colour.
- Hovering a ground row now shows the inventory's own tooltip (name in colour, affix lines, quantity, "Click to pick up") instead of the browser's plain `title`.
- Mods reach the client in the dropped object's `WorldObjectDef.item.mods` (player drops and kill loot already carried them); `spawnDynamicObject` used to strip them, now `LevelObject.item.mods` keeps them.

## Deviations from the original
- MMO only: without `GAME_FEATURES=mmoItems` no item has mods, so nothing changes.

## Not done / not decoded
- The Tab prompt ("Tab — pick up …") and placed level items are not coloured.
- Not seen live: typechecked only (a rolled drop needs mmoItems plus a kill drop or an admin item grant).

## Gotchas
- The tooltip hides when the hovered ground item disappears (`setGroundItems` compares ids); rows re-render as the distance changes, so the tooltip leaves the distance out.

## How to verify
- Server with `GAME_FEATURES=mmoItems`; kill a creature that drops gear (kill loot rolls at least Tempered on its first roll) or grant gear from the admin panel and drop it; Shift+G, hover the row.

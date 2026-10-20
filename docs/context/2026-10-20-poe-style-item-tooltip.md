# Item tooltips split the item's own numbers from its affixes, with roll ranges

Date: 2026-10-20 · Agent: Claude Code · Commit: Item tooltips show base stats and affixes apart, with roll ranges; affixes roll once each

## Why
A Mundane mace showed "Bash damage: 25": base × 1.2 and two flat Bash affixes summed into one number, and the damage and attribute affix lines were hidden. The user asked for Path of Exile's layout: the item's own stats on top, the rarity's rolled rows below, each with its range ("(2–12)").

## Decisions and evidence
- Bag tooltip (`tooltipHtml`), in order: name; own stats (damage / protection in blue when rarity or refinement scales them), effects; a rule; one line per affix with its range; a rule; failstacks, quantity, refine cost, sell price.
- At the user's request every item tooltip (bag, key, ground, shop stock) dropped its type/size line ("Weapon · 1×3", "Key item", "On the ground"), the rarity multiplier line and the hint footer ("Click to equip · Drag outside to drop", "Click to buy", "Click to pick up", "Shift-click to refine"…). The spell tooltip keeps its own. Refining is now undiscoverable from the tooltip (the refine cost line still shows at a merchant).
- Each own number also shows what the affixes add to it, in the affix colour: "Bash damage: 12 (+9)", "Fire taken: ×0.9 (−12 %)", "+2 Might (+3)"; an affix on a stat the item has none of shows only in the affix section.
- The inventory view still carries the summed numbers (prediction and stats use them); `withoutAffixes` takes the affixes back out on the client: damage and attributes exactly, a resistance by division unless the 75 % cap clipped it (left as it is then).
- **Affixes now roll at most once each** (PoE rule), so every value lies inside its range: a family's weight is split among its stats (attr ÷ 4, res ÷ 6) and a rolled stat leaves the pool. Before, the same affix twice added up (a mace could carry +24 Bash). Old items with summed values show no range (value outside it).
- Ranges come from `affixRange` (the `AFFIXES` table); they do not depend on rarity.
- Ground tooltip shows ranges too; trade and auction lines stay short (no ranges).

## Kill loot rolls as it drops
- With `mmoItems`, `grantReward` rolls each carried moddable piece when it drops at the corpse (one ground object per piece); before, it rolled on pick-up, so the ground window showed no colour.
- Every rolled drop gets a `uid`, Battle-worn ones too: `grantItem` rolls only when no instance is passed, so the pick-up keeps the drop's roll and never re-rolls.
- Chests and placed level items still roll on pick-up: they are shared, per-character objects.
- Alt+G now opens the ground window too, next to Ctrl+G and Shift+G. AltGr (Ctrl+Alt) does not.

## Bug fixed in passing
- `attr:intelligence` affixes added `attributes.intelligence`, but the stat is `intellect`: they did nothing. `withMods` now maps it (stored ids unchanged; the sanitizer still accepts `intelligence`).

## Gotchas
- Shields (wooden_shield, metal_shield) have no protection, attributes or HP in the catalogue: they work by blocking. Their rarity multiplier therefore does nothing; only affixes make a Mundane shield better. Seen live: a "Mundane Wooden Shield" with one "+70 hit points" line and no range = two hp rolls (e.g. 35 + 35) summed before affixes became unique.
- The rule above the affixes stays even when the item has no own numbers (user's request).

## Not done
- Not seen live: unit tests and typecheck only; the tooltip CSS (`.tt-sep`, `.tt-aug`, `.tt-affix`, `.tt-range`) was not rendered.
- No affix tiers (PoE's T1..Tn): one range per affix family.

## How to verify
- `pnpm test:unit item_mods` (uniqueness and ranges over 2000 rolls, range text, `withoutAffixes` round trip, intellect).
- Server with `GAME_FEATURES=mmoItems`; get a Mundane or better weapon; hover it in the bag.

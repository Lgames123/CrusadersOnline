# Area levels, an MMO XP curve, item levels and affix tiers

Date: 2026-10-20 · Agent: Claude Code · Commit: Area levels, level-scaled creatures and XP (mmoLevels); item levels and affix tiers T0–T10

## Why
The user's `area_levels_and_affix_tiers_plan.md` (project root): acts with levels, Necros at 50, a curve reaching 45 through the story with a 45→50 grind wall, and 11 affix tiers chosen by item level.

## Decisions and evidence
- **New feature `mmoLevels`** (off by default): creature HP ×(1 + 0.045 (L−1)), blows ×(1 + 0.035 (L−1)) (`Mob.levelDamage` in `rollDamage`), XP = `mobBaseXp(L)` × rank, then × `xpLevelFactor` per player after kill shares, and the MMO XP curve to 100. The original curve (500, 1500, 3500…, cap 50) stays the default: the plan replaced it outright, which would break the original game's feel.
- `AREA_LEVELS` (area_levels.ts) follows `WAYPOINT_CHAPTERS` travel order inside the plan's brackets. The plan's table did not name co8a, du9a/b, es9a, co9a, cs4a/b or ws4a; they take their neighbours' levels. Inns take their town's level, a dungeon instance its base act's, unknown acts and train 1.
- Ranks: elite = a placement whose original XP is ≥ 2.5 × the act's median hostile XP (+1 level, ×2.5 XP). This keeps the original's relative toughness. Boss = Necros (level 50, ×10 XP, his own HP and blows, as the plan's "1000 HP" row says) and the dungeon boss (area + 2, ×10 XP, the dungeon's own HP and damage). Admin and dungeon custom spawns keep their own numbers.
- `mob.level` is always computed: with `mmoItems` it is the item level of kill loot even when `mmoLevels` is off. Picked-up, chest and shop gear (`grantItem`) takes the act's level; smithing takes the smith's skill level; the dungeon boss's piece takes the boss's level. Only rolled (non-worn) gear stores `mods.ilvl`.
- Tiers: `AFFIX_TIERS` holds the plan's tables literally (resistances in whole percent, stored as fractions). Each affix rolls its tier uniformly in `tierWindow(ilvl)` = [max(0, top−3), top], top = min(10, ⌊ilvl/10⌋), then an integer value in that tier. T11 is defined but never rolled.

## Plan inconsistencies resolved
- 45→50 steps: the formula's `1.55^(L−45)` makes 45→46 equal to the campaign curve. `1.55^(L−44)` reproduces the plan's listed 85k/132k/205k/318k/495k (we get 83k…479k), so that is used.
- 51–100: the formula is kept, but its total is ≈ 133 M XP at 100, not the plan's "≈ 45 M". Up to 45 it is ≈ 1.01 M, up to 50 ≈ 2.21 M.
- `mobBaseXp`: the formula gives 934 at 25 and 2148 at 50, not the plan's 1,120 and 2,850. The formula is used.
- The summary says "iLvl 90–100 rolls T7–T10", but the plan's own formula and table give T6–T9 for 90–99 and T7–T10 only at 100. The formula is followed (tests check iLvl 100 → exactly T7..T10).

## Gotchas
- Switching `mmoLevels` re-derives every character's level from saved XP on the other curve: an original level 30 (106,500 XP) is level 17 on the MMO curve. Nothing migrates XP.
- The campaign's highest creature is about level 51 (bs1a elites), so drops never exceed T5 today; T6–T10 wait for content above 60.
- Affixes rolled before tiers have no `tier`: the tooltip shows them against T5's range when the value lies inside it, otherwise no range.
- The client needs `SC_WORLD_ENTER.features.mmoLevels` for the HUD XP bar and character sheet (`xpForLevel(l, mmo)`). The creature level tag comes from `EntitySpawnMsg.d.level`, sent only with the feature on.

## Not done
- Not seen live: unit tests and typecheck only. Not rendered: the `[Lv.N]` health-bar tag with its gap colours (grey < −3, green, yellow, orange ≥ +3, red skull ≥ +6) and the "Item level" tooltip line.
- No tier tag on trade or auction lines (they show no ranges).
- Pacing (25–35 h to 45, 4–5 h wall) is the plan's claim, not measured.

## How to verify
- `pnpm test:unit area_levels item_mods`.
- Server with `GAME_FEATURES=mmoItems,mmoLevels`: in Gl1b, skeletons show `[Lv.40]` and take ~3× the hits; drops there say "Item level 40" with T1–T4 affixes.

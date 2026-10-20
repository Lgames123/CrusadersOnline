# MMO Stage 3: rarity, affixes and refinement (feature `mmoItems`)

Date: 2026-10-20 · Agent: Claude Code · Commit: Rarity, affixes and +10 refinement behind GAME_FEATURES=mmoItems (MMO Stage 3)

## Why
MMO roadmap Stage 3 (docs/game-design/mmo/03, 04).

## Decisions and evidence
- **Behind the server feature `mmoItems`, off by default.** The memory rule is the original's feel
  by default. With it off nothing rolls and nothing drops differently; items rolled while it was
  on keep their mods.
- Rarity (`item_mods.ts`):
  - one uniform roll against cumulative thresholds: 0.1 % legendary, 4.9 % tempered, 25 %
    mundane, else the plain item;
  - multiplier 1.2 / 1.5 / 2.0 with 2 / 4 / 4 affixes from a weighted pool: attribute 1–5, flat
    weapon damage 2–12 of its main physical type, element resistance 3–18 %, +10–50 HP,
    +15–60 mana;
  - rolled when a player *receives* a piece of equipment (`grantItem`): chests, level pick-ups
    and kill loot, but not a picked-up instance, which keeps its own.
- Pipeline (`withMods`, used by `equipmentOf`):
  - damage × rarity × (1 + refinement) plus flat affixes;
  - protection scaled on the part it takes away, resistances multiplied, a 75 % cap
    (`MIN_PROTECTION` 0.25);
  - HP and mana bonuses go into maxHp / maxMana (`gearHp` / `gearMana`).
- Refinement (CS_REFINE 0x19):
  - Shift-click an item in the bag while a merchant's shop is open;
  - the costs and chances of 04 §2.1; never destroys or lowers an item; a failure adds a
    failstack (pity).
  - **The spec's expected total (30.78 attempts) is wrong for its own formula: the exact value
    is 27.38** (tests/unit/item_mods.test.ts simulates it).
- Materials:
  - six new catalogue items, type `material` (Iron Scrap … Divine Catalyst), drawn with
    existing models;
  - creatures drop them only with the feature on: per qualifying player, 20 / 8 / 4 / 2 /
    0.5 / 0.2 %, scaled by the drop rate.
- Client:
  - tooltips show "Tempered Long Sword +4" in its colour, the affixes, the failstacks, and at a
    merchant the next refinement's cost and chance;
  - the local player's weapon glows from +3 (an additive shell, colour and pulse by tier, a
    rainbow at +10).

## Deviations from the original
- All of it is MMO and optional (`GAME_FEATURES=mmoItems`).

## Not done / not decoded
- No item level (iLvl) or infusion. No named-item perks. The exotic affixes (lifesteal, crit,
  cast speed, swing speed) are left out.
- Other players' glows are not shown: gear is not replicated.
- No blacksmith NPC: any merchant refines.

## How to verify
- `pnpm test:unit item_mods` (thresholds and distribution, pipeline, 75 % cap, 27.4 attempts,
  refining in the zone with the feature on and off).
- Server with `GAME_FEATURES=mmoItems`: open a shop, Shift-click your sword with 2 Iron Scrap
  and 100 gold. It becomes +1, the tooltip shows the rest.

# The rarity system as built

How item rarity, affixes and refinement work in the code today. This file covers what is
implemented; the design specs are [03-item-rarity-and-affixes.md](03-item-rarity-and-affixes.md)
and [04-equipment-upgrading.md](04-equipment-upgrading.md). The code is in
`shared/src/game/item_mods.ts`.

## Switched on by `mmoItems`

- Everything here runs only when the server is started with `GAME_FEATURES=mmoItems`. It is off
  by default, so the original game's items stay the same.
- With the feature off, nothing new rolls, refining is refused ("Refinement is not offered on
  this server."), and no materials drop.
- Items rolled while the feature was on keep their mods after it is turned off, and still show
  them.

## What an item instance carries

Every piece of gear in a bag is an `InventoryEntry` with a `uid` and an optional `mods`
(`ItemMods`, stored as JSONB since migration 007):

| Field | Meaning |
|---|---|
| `rarity` | `mundane`, `tempered` or `legendary`. Absent = Battle-worn (the original item). |
| `affixes` | Up to 4 `{ id, value }` rolls (see below). |
| `plus` | Refinement level, +1 to +10. |
| `failstacks` | Failed refinement attempts since the last success. |
| `bound` | Cannot be traded or listed. The trade code checks it, but nothing sets it yet. |

`sanitizeMods` checks mods loaded from storage: it ignores unknown rarities and affix ids, keeps
at most 6 affixes, and caps `plus` at 10.

**Which items can roll** (`moddable`): weapons, shields, armour, rings, amulets, helms, gloves,
belts and boots. Stackable items, keys and quest items never roll.

## Rarity tiers

One uniform roll `u` in [0, 1) is checked against cumulative thresholds (`rollRarity`):

| Tier | Roll | Chance | Multiplier | Affixes | Name colour |
|---|---|---|---|---|---|
| Legendary | u < 0.001 | 0.1 % | ×2.0 | 4 | orange `#ff9800` |
| Tempered | u < 0.05 | 4.9 % | ×1.5 | 4 | purple `#b052c8` |
| Mundane | u < 0.30 | 25 % | ×1.2 | 2 | blue `#4fa3f7` |
| Battle-worn | otherwise | 70 % | ×1 | 0 | default (no mods stored) |

## When an item rolls

| Source | Rarity roll |
|---|---|
| Kill loot: gear a creature carries, as it drops at the corpse | Normal odds. Each piece rolls separately and gets a `uid`, Battle-worn too, so picking it up does not roll it again. |
| A new piece of gear entering a bag (`grantItem`): chests, placed level items, quest rewards, admin grants | Normal odds, rolled when the item enters the bag. |
| Picking up an item that was dropped | No new roll: it keeps its `uid` and `mods`. |
| Dungeon boss gear (one piece from broad sword, war hammer, battle axe, banded armour, metal shield) | `u × 0.05`: always Tempered (98 %) or Legendary (2 %). |
| Smithing (`smithRarityBonus`) | `max(0, u − min(0.25, level / 400))`: the smith's level lowers the roll. See issues. |

Kill loot and boss gear lie on the ground already rolled, so the ground window (Ctrl/Shift/Alt+G)
shows each piece's rarity colour. Chest contents and placed level items roll only on pick-up,
because every character sees the same placed object.

## Affixes

Affixes are drawn from a weighted pool. A family's weight is split evenly across its stats, and
**each stat can roll at most once per item**: a stat that has rolled leaves the pool. Each affix
then rolls its **tier** (below), and a whole value uniform in that tier's range (resistances in
whole percent).

| Family | Ids | Rolls on | T5 range (baseline) | Family weight |
|---|---|---|---|---|
| Attribute | `attr:might`, `attr:intelligence`, `attr:endurance`, `attr:speed` | any | +5 | 60 (15 each) |
| Flat damage | `dmg:SLASH` or `dmg:BASH` (whichever the weapon deals more of) | weapons | 10–12 | 80 |
| Resistance | `res:FIRE`, `AIR`, `EARTH`, `WATER`, `LIGHT`, `DARK` | non-weapons | 15–18 % | 70 (≈11.7 each) |
| Hit points | `hp` | non-weapons | 41–50 | 100 |
| Mana | `mana` | any | 49–60 | 100 |

- A **weapon** draws from 6 stats (4 attributes, its damage type, mana), weighing 240 in all.
- **Any other moddable item** draws from 12 stats (4 attributes, 6 resistances, hit points,
  mana), weighing 330 in all.
- The `attr:intelligence` id raises the `intellect` stat. The id keeps its old spelling so stored
  items still load.

Ranges do not depend on rarity: a Legendary item rolls the same ranges as a Mundane one, it just
gets more affixes and a bigger multiplier.

### Item level and tiers

- Rolled gear stores its **item level** (`mods.ilvl`, 1–100): the creature's level for kill loot,
  the act's level (`area_levels.ts`) for chests, placed items and the shop, the Smithing level for
  forged gear. Battle-worn gear stores none.
- Tiers T0–T10 per family (`AFFIX_TIERS`; T5 = the old range's top, T10 = double it, e.g. HP
  T5 41–50, T10 91–100). T11 (masterwork) is defined but never rolled.
- An item rolls each affix's tier uniformly in `tierWindow(ilvl)`: top = min(10, ⌊iLvl / 10⌋),
  bottom = max(0, top − 3). iLvl 50 rolls T2–T5; iLvl 100 rolls T7–T10.
- The campaign's creatures reach about level 51 (`mmoLevels` sets creature levels; the level is
  computed even without it), so drops stop at T5 today.

## How mods change the numbers (`withMods`)

`equipmentOf` sums the gear it uses, and the inventory view shows these numbers too:

1. **Multiplier**: `m = rarity multiplier × (1 + refinement power)`.
2. **Damage**: every damage type becomes `base × m`.
3. **Protection** (the "taken ×" factor) shrinks the part it takes away:
   `1 − (1 − p) × m`, never below 0.25.
4. **Flat affixes are added afterwards**:
   - `dmg:X` adds its value to damage type X;
   - `res:X` multiplies protection X by `(1 − value)`, again never below 0.25, so resistance is
     capped at 75 %;
   - `attr:*` adds to attributes;
   - `hp` and `mana` raise max HP and max mana.

Example: a Mundane mace with base Bash 10 and a `dmg:BASH` +9 affix deals 10 × 1.2 + 9 = 21 Bash.

The multiplier only scales damage and protection. Attributes, hit points and mana from the base
item are not scaled.

## Refinement (+1 to +10)

- **Where**: Shift-click an item in the bag while a merchant's shop is open (`CS_REFINE`
  0x19). Any merchant refines.
- **Cost**: gold plus materials for each level (`REFINE_LEVELS`).
- **Chance**: base chance + failstacks × failstack bonus.
- **Effect on the item**: success gives +1 and clears the failstacks; failure adds a failstack.
  An item is never destroyed or lowered.

| To | Gold | Materials | Base chance | Per failstack | Power |
|---|---|---|---|---|---|
| +1 | 100 | 2 Iron Scrap | 100 % | — | +4 % |
| +2 | 250 | 4 Iron Scrap | 100 % | — | +8 % |
| +3 | 500 | 6 Iron Scrap | 85 % | +15 % | +12 % |
| +4 | 1,000 | 8 Polishing Stone | 70 % | +10 % | +16 % |
| +5 | 2,500 | 10 Mithril Crystal | 55 % | +7.5 % | +21 % |
| +6 | 5,000 | 14 Mithril Crystal | 40 % | +6 % | +26 % |
| +7 | 9,000 | 18 Enchanted Dust | 30 % | +5 % | +31 % |
| +8 | 16,000 | 24 Enchanted Dust | 20 % | +4 % | +36 % |
| +9 | 30,000 | 2 Celestial Gem | 12 % | +2.5 % | +42 % |
| +10 | 60,000 | 5 Divine Catalyst | 6 % | +1.5 % | +50 % |

- Going from +0 to +10 takes 27.38 attempts on average. The spec's figure of 30.78 does not
  follow from its own formula; the unit test simulates it.
- From +3, the local player's weapon glows (`weapon_glow.ts`), with the colour and pulse set by
  tier and a rainbow at +10. Other players' glows are not shown, because gear is not replicated.

## Materials

Every creature kill gives each player who shares it one chance per material, scaled by the
server's drop rate:

| Material | Chance |
|---|---|
| Iron Scrap | 20 % |
| Polishing Stone | 8 % |
| Mithril Crystal | 4 % |
| Enchanted Dust | 2 % |
| Celestial Gem | 0.5 % |
| Divine Catalyst | 0.2 % |

With `mmoCrafting` on, salvaging gear at the anvil breaks it into materials by rarity:

| Rarity | Yields | Smithing XP |
|---|---|---|
| Battle-worn | 2–4 Iron Scrap | 15 |
| Mundane | 1–3 Enchanted Dust | 40 |
| Tempered | 1 Celestial Gem | 120 |
| Legendary | 1 Divine Catalyst | 400 |

## Tooltips (client)

- The **name** reads "Tempered Long Sword +4", in the rarity's colour (`modsTitle`).
- **The item's own numbers come first**, scaled by rarity and refinement and shown in blue when
  scaled. What the affixes add appears beside them: `Bash damage: 12 (+9)`,
  `Fire taken: ×0.9 (−12 %)`, `+2 Might (+3)`. `withoutAffixes` separates the two parts from the
  summed view.
- Under the name, **"Item level: N"** for rolled gear.
- **A rule, then one line per affix with its tier and range**: `+45 hit points (T5: 41–50)`. The
  rule shows even when the item has no numbers of its own.
- **A rule, then failstacks, quantity and, at a merchant**, the sell price and the next
  refinement's cost and chance.
- Items on the ground show their affixes with ranges too. Trade and auction rows show affixes
  without ranges.

## Known issues and gaps

- **Shields gain nothing from rarity.** `wooden_shield` and `metal_shield` have no protection,
  attributes or HP in the catalogue, because they work by blocking. The multiplier has nothing
  to scale, so only a shield's affixes improve it.
- **Smithing makes too many Legendaries.** The bonus is subtracted from the roll and clamped at
  0, so the Legendary chance becomes roughly the bonus itself:

  | Smithing level | Legendary | Tempered or better |
  |---|---|---|
  | 40 | ≈10 % | 15 % |
  | 100 | ≈25 % | 30 % |

  For comparison, a normal find is Legendary 0.1 % of the time.
- **Old summed values.** Before affixes became unique, the same stat could roll twice and the
  two rolls were added (for example "+70 hit points" on a Mundane shield). Affixes from before
  tiers carry no tier: they show T5's range when they lie in it, and no range otherwise.
- **`bound` is never set.** Nothing binds an item on pickup or equip yet.
- **Not built yet:**
  - infusion and named-item perks;
  - the exotic affixes (lifesteal, crit, cast speed, swing speed);
  - a blacksmith NPC.

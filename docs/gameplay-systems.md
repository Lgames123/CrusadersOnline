# Gameplay Systems: Progression, Inventory & Enemy AI

## 1. Inventory & Equipment System

### 1.1 Slot Architecture
Each character possesses:
- **Equipped Slots (7 slots):**
  - Main Hand (Sword, Mace, Axe)
  - Off Hand (Shield, Spell Focus)
  - Head (Helmet, Cowl)
  - Chest (Chainmail, Plate, Robes)
  - Legs (Greaves)
  - Ring 1 (Enchantment Accessory)
  - Ring 2 (Enchantment Accessory)
- **Bag Inventory (24 slots):** Grid array (4 rows $\times$ 6 columns).
- **Bank Storage (48 slots):** Accessible at town shrines.

### 1.2 Anti-Duplication Rule
All item swaps, bank deposits, and drop operations must execute as atomic database transactions:
```sql
BEGIN;
SELECT * FROM inventory_items WHERE character_id = $1 AND slot_index = $2 FOR UPDATE;
UPDATE inventory_items SET slot_index = $3 WHERE id = $4;
COMMIT;
```

---

## 2. Enemy AI System

### 2.1 Aggro & Threat Table
Enemies maintain an in-memory threat map:
$$\text{Threat}(player) = \text{Damage Received} \times 1.0 + (\text{Heals Observed} \times 0.5)$$
The entity with the highest threat within line-of-sight is designated as the primary attack target.

### 2.2 Monster Stat Archetypes

| Monster | Base HP | Damage | Speed | Special Ability |
|---|---|---|---|---|
| **Skeleton Warrior** | 60 | 8–12 Slash | 4.2 m/s | 2-Hit Combo, Shield Deflect |
| **Skeleton Archer** | 40 | 6–10 Pierce | 3.5 m/s | Ranged Snipe (20m range), Retreats if melee |
| **Ogre Brute** | 220 | 25–35 Bash | 2.8 m/s | Ground Slam (Stuns in 4m AoE) |
| **Corrupted Mage** | 80 | 18–25 Fire | 3.0 m/s | Teleport Escape, Homing Fireball |

---

## 3. Loot Generation & Drop Rates

When an enemy entity's health reaches 0:
1. The server generates a loot container entity at the monster's death coordinate $(X, Y, Z)$.
2. Loot ownership is assigned to the player or party that contributed $>50\%$ of the damage for a 30-second priority window.
3. After 30 seconds, loot becomes free-for-all for any nearby player.
4. Loot disappears after 180 seconds.


---

## 4. Vertical-Slice Implementation (2026-10-09)

Implemented server-side in `server/src/simulation/world_zone.ts` with shared rules in `shared/src/game/combat.ts` (values are slice values until the original formulas are recovered):

- **Player swing:** 150 ms startup / 150 ms active / 250 ms recovery (3/3/5 ticks). A request during recovery is buffered; requests during startup/active are ignored, so spam cannot raise the hit rate. The server picks the combo index (1.0× / 1.25× / 1.6× of 12 base damage) when the next swing starts within 300 ms of the previous one.
- **Hit test:** forward cone, 110° and 2.2 m reach (+ target capsule radius) for players; 90° and 2.0 m for the skeleton; each target at most once per swing.
- **Skeleton Warrior AI:** idle → chase (nearest living player within 10 m) → attack in reach (400/150/500 ms swing + 300 ms cooldown, 8–12 damage) → return when the target is gone or the mob is more than 30 m from its spawn, healing on arrival. Threat = damage received.
- **Death:** mobs leave a corpse for 10 s, then respawn at their spawn point; players respawn after 5 s at a spawn point with full health. The dead do not act (server and client prediction agree).
- **Progression:** 25 XP and 5–10 gold per skeleton kill; level = 1 + ⌊XP / 100⌋ (max 50); +10 max HP per level and a full heal on level-up. Rewards trigger an immediate save; XP, gold, level and HP persist.
- **Protocol:** `SC_PLAYER_STATS` (0x49) to the owner, `SC_COMBAT_EVENT` to players near the target, `ENTITY_SPAWN` carries kind/archetype/max HP, snapshots carry HP and the animation state (`ANIM.ATTACK + combo`, `ANIM.DEAD`).
- **Client:** left click swings (local feedback immediately, the server decides hits), floating damage numbers, health bars over entities, HP/XP/gold panel, death notice. In development, characters use the original Drake and Skeleton Warrior models and animations converted from the user's installation (falls back to procedural avatars otherwise; never shipped).


---

## 5. Original Combat Rules in the Server (2026-10-09)

The vertical slice now uses the recovered engine rules (`shared/src/game/original_stats.ts`, `ruleset.ts`; executable-analysis.md §7–8). This supersedes the damage/HP values in §4:

| Aspect | Rule | Source |
|---|---|---|
| Player attributes | default.ctx columns for the server's `DIFFICULTY` (default medium: M 20 / I 15 / E 25 / S 15) | original data (facts) |
| Max HP | 50 + 0.6 × Endurance × level (medium L1 = 65, L2 = 80) | engine formula |
| Outgoing hit | stronger of the weapon's slash/bash × Might multiplier × attack mode (1.0, 1.0, 1.25 for the 3rd combo hit) | engine pipeline |
| Starting weapon | "Axe" numbers: 5 slash / 5 bash, speed 1.1 (shortens the swing) | items.ctx |
| Incoming damage | per type × difficulty resist (medium slash/bash 0.9) × armour protection, summed | engine pipeline |
| Flinch | 0.5 × random + damage / HP before ≥ 0.7 interrupts the player (≥ 0.8 longer stagger) | engine formula; durations are slice values |

Creature HP, XP and resists: original placement data (Skeleton Warrior 25 HP, 40 XP, slash 0.9 / bash 1.1 / light 1.5 / dark 0.75). Still slice values: swing timings at speed 1.0, AI, gold and loot chances. Shield blocking: hold the right mouse button (input flag `BLOCK`, bit 6). Every player starts with the "Wooden Shield". While the flag is held, and the player is not swinging or flinching, a hit from an attacker inside the original frontal cone (dot > cos(30 rad), about ±81°) is stopped completely and reported as `blocked`. Blocking does not change movement, so client prediction stays exact. Assumptions: a block negates the whole hit (the original calls the shield's Use action; any partial absorption is not yet identified), and mobs do not block.

---

## 6. Inventory, Equipment and Progression (2026-10-09)

- **Items:** `shared/src/game/items.ts`. A built-in catalog holds the slice's items with their items.ctx numbers (Axe, Long Sword, Mace, Heavy Mace, Morning Star, Wooden/Metal Shield, Scale/Banded Armor). In development the server loads the user's converted `local/generated/rules/items.json` instead (all melee weapons, shields and armour; `ITEM_RULES` overrides the path).
- **Inventory:** 32 slots, persisted in `inventory_items`. New characters (and guests) get the starting kit: Axe and Wooden Shield, equipped. One item per equipment slot (weapon, shield, armour). Equipping swaps out the previous item. A request made during a swing is applied when the swing ends. Saved data is sanitized on load: unknown items, invalid or duplicate slots and extra equipped items are dropped.
- **Effects:** weapon damage and speed (swing length), shield (blocking needs one), armour protection (multiplies incoming damage after the difficulty resist).
- **Creatures:** loadouts come from the original creature table. The Skeleton Warrior wields a Long Sword and deals its whole damage vector (10 slash, 9 after the medium resist): creatures skip the player's stronger-of-slash/bash and Might rules.
- **Loot (slice values):** a skeleton kill rolls Long Sword (25%) and Scale Armor (10%) into the killer's bag. The combat event lists the dropped items.
- **Experience (original):** thresholds 500, 1500, 3500, 6500, 10500, then +4000 per level. On level-up the max-HP gain is added to current HP; it is not a full heal. A Skeleton Warrior gives 40 XP.
- **Client:** I opens the inventory window (click an item to equip or unequip it). The HUD XP bar follows the original thresholds.

## 7. Creature Shield AI (slice, 2026-10-09)

Creatures with a shield in their loadout (the Skeleton Warrior carries a Wooden Shield) can raise it against a player who starts a swing at them. The shield goes up if the creature is chasing, not mid-swing and off cooldown, and the creature is in the swing's reach + 1 m and arc; it then rolls a 35% chance. The shield stays up for 0.7 s, facing the attacker; during that time the creature neither moves nor attacks. The next block is possible 1.5 s after it lowers. A raised shield uses the same frontal cone as the player's (cos(30 rad) ≈ ±81°) and stops the whole hit ("Blocked"). The original AI chooses between the `SHIELD_BLOCK` and `SHIELD_COVER` maneuvers in scripts that are not decoded, so the chance and the durations are slice values.

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

Still slice values: swing timings at speed 1.0, AI, skeleton stats (25 HP, 8–12 slash, neutral resists — creature data not decoded), XP per level, rewards. Shield blocking: hold the right mouse button (input flag `BLOCK`, bit 6). Every player starts with the "Wooden Shield". While the flag is held, and the player is not swinging or flinching, a hit from an attacker inside the original frontal cone (dot > cos(30 rad), about ±81°) is stopped completely and reported as `blocked`. Blocking does not change movement, so client prediction stays exact. Assumptions: a block negates the whole hit (the original calls the shield's Use action; any partial absorption is not yet identified), and mobs do not block.

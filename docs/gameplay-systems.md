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

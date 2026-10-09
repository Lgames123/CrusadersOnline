# Gameplay Mechanics: Math, Formulas & Combat Rules

## 1. Primary Attributes & Stat Curves

Discovered directly from `script/default.ctx` and reconstructed RPG conventions:

- **Might ($M$):** Dictates physical melee damage output and carry capacity.
  $$\text{Melee Attack Power} = M \times 1.5 + \text{Weapon Base Damage}$$
- **Endurance ($E$):** Dictates maximum health and physical impact resistance.
  $$\text{Max Health} = 50 + (E \times 10)$$
- **Intelligence ($I$):** Dictates maximum mana pool and spell damage scaling.
  $$\text{Max Mana} = 30 + (I \times 8)$$
- **Speed ($S$):** Dictates attack swing speed and locomotion velocity multiplier.
  $$\text{Run Speed Multiplier} = 1.0 + \frac{S - 15}{100}$$

---

## 2. Damage Resolution Pipeline

When an attack occurs, the authoritative server executes the following deterministic formula:

```
[ Attacker Hits Input ]
          |
          v
[ Server Bounding Box Overlap Check ]
          |
          v
[ Roll Hit vs Evasion ] ---> Miss (0 Damage)
          |
          v
[ Calculate Raw Damage: Base Weapon + (Might * 0.5) ]
          |
          v
[ Check Critical Strike: 5% Base + (Speed * 0.25)% ]
          |
          v
[ Apply Target Armor & Resistance Multipliers (DR0..DR2) ]
          |
          v
[ Final Damage Applied to Health ]
          |
          v
[ Broadcast Damage Number & Flinch Event to Clients ]
```

### 2.1 Damage Resistance Multipliers
Derived from `script/default.ctx`:
$$\text{Damage Taken} = \text{Raw Damage} \times \text{Resistance Multiplier}$$
- Resistance < 1.0 = Target takes reduced damage (e.g., $0.6$ takes 40% less damage).
- Resistance > 1.0 = Target takes increased damage (e.g., $1.2$ takes 20% bonus damage on Hard).

---

## 3. Experience & Level Progression

Progression follows a quadratic XP curve:
$$\text{XP Required for Level } L = 100 \times (L - 1)^{1.8}$$

| Level | Cumulative XP Required | Unlocked Capability |
|---|---|---|
| **1** | 0 | Basic One-Handed Sword, Shield Block |
| **2** | 100 | 2-Hit Combo Chain, Minor Heal Spell |
| **3** | 350 | Fireball Spell, +2 Might, +2 Endurance |
| **4** | 720 | 3-Hit Combo Chain, Broadsword Proficiency |
| **5** | 1,200 | Whirlwind Cleave, Heavy Armor Proficiency |

---

## 4. NPC & Monster Aggro Logic

Every active world entity on the authoritative server implements an aggro state machine:
```
           +------------+
           |   IDLE     |
           +------------+
                 | Player within 12m & Line of Sight
                 v
           +------------+
+--------> |   CHASE    | <---------+
|          +------------+           |
|                | Within 2.0m      | Target leaves melee range
|                v                  |
|          +------------+           |
|          |   ATTACK   | ----------+
|          +------------+
|
| Target exceeds 25m leash distance
v
+------------+
|   RESET    | (Returns to spawn anchor, regenerates to full HP)
+------------+
```

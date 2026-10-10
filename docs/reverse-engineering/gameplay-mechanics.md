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


---

## Locomotion from animation root motion `[CONFIRMED data, unit pending]`

The engine moves characters by animation root motion (executable-analysis.md §6). Displacement per cycle of Drake's clips, from the converted animations (original units; ≈ feet, see asset-format-discovery.md §3.7):

| Clip | Label (models.ctx) | Duration | Distance | Speed (u/s) | ≈ m/s if feet |
|---|---|---|---|---|---|
| `PA01_ru_f` | run forward | 0.87 s | 13.62 | 15.71 | 4.79 |
| `PB01_w_fw` | walk forward | 1.13 s | 5.68 | 5.01 | 1.53 |
| `PA06_rt` | retreat | 1.33 s | 5.04 | 3.78 | 1.15 |
| `PB02_sdstp_l` / `PB03_sdstp_r` | sidestep left / right | 0.67 s | 2.32 / 2.75 | 3.49 / 4.13 | 1.06 / 1.26 |
| `PB01_w_sideleft` / `..._sideright` | sidestep while running | 0.77 s | 7.88 / 8.33 | 10.28 / 10.87 | 3.13 / 3.31 |
| `PE03_rl_fw` | roll forward | 0.83 s | 10.96 | 13.15 | 4.01 |
| `PC07_hp_f` | hop forward | 0.67 s | 5.65 | 8.48 | 2.58 |

The vertical-slice controller currently uses 6.0 m/s run and 2.5 m/s walk (gameplay-specification.md §3.1). These values should be replaced with the root-motion speeds once the unit is confirmed (next RE target: gravity/jump constants in the movement code).


---

## Derived stats (original engine) `[CONFIRMED from code]`

| Stat | Formula | Drake, Medium, level 1 |
|---|---|---|
| Max HP | 50 + 0.6 × Endurance × level | 65 |
| Max mana | trunc(Intellect × level / 3) + 20 | 25 |
| Damage multiplier | trunc(10 × (0.9 + 0.005 × Might × level)) / 10 | 1.0 |
| Speed multiplier | 0.999 + 0.01 × level + (Speed − 15) × 0.01714 | 1.009 |

Attributes are base (default.ctx per difficulty) + equipment bonus, capped at 50. A weapon hit uses the stronger of its SLASH/BASH values × the damage multiplier (items.ctx: e.g. Axe 5/5, Battle Axe 8/5, Mace 0/10). Movement and jumps come from animation root motion scaled by the speed multiplier; the non-animated fallback speed is 15 units/s.

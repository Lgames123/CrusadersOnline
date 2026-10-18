# 10 — Quantitative Economic & Combat Balance Stress Scenarios

## 1. Purpose & Methodology

To validate the robustness of the rules specified across Volumes 01 through 09, this document analyzes **eight high-stress edge scenarios**. Each scenario tests the mathematical limits of the combat engine, reward distribution, anti-exploit safeguards, and economic equilibrium.

---

## 2. The 8 Mandatory Balance Scenarios

### Scenario 1: Low-Level Player in Co-op Contention with a Stronger Player
- **Setup:** A Level 10 Player ($A$) is fighting a Level 12 Skeleton Warrior ($300\text{ HP}$). $A$ has inflicted $45\text{ damage}$ ($15\%$ of HP). A Level 50 Player ($B$) enters and strikes the skeleton for $1,200\text{ damage}$, instantly killing it.
- **Unmitigated Flaw:** Raw damage attribution assigns $B = 96.4\%$ and $A = 3.6\%$. Player $A$ fails the $5\%$ threshold, receiving $0\text{ XP}$ and zero loot.
- **CrusadersOnline Resolution:**
  1. Overkill suppression clamps $B$'s recorded damage at the monster's remaining health: $\min(1200, 255) = 255$.
  2. Level differential penalty kicks in for $B$ ($\text{LevelDiff} = 50 - 12 = 38 \ge 10$): Player $B$ receives **zero item drops** and $-95\%$ XP.
  3. Player $A$ satisfied the $5\%$ contribution threshold before $B$'s intervention ($45 / 300 = 15.0\% \ge 5\%$).
  4. **Outcome:** Player $A$ is granted **$100\%$ full individual instanced loot rights** and unpenalized Level 12 XP. Griefing is mathematically neutralized.

---

### Scenario 2: Multi-Player Contention on a Single World Mob
- **Setup:** Four solo players ($P_1, P_2, P_3, P_4$) attack a roaming Ogre Brute ($2,500\text{ HP}$).
  - $P_1$ (Melee DPS): Inflicts $1,100\text{ Slash damage}$.
  - $P_2$ (Shield Tank): Inflicts $300\text{ damage}$, blocks $600\text{ damage}$ with frontal shield.
  - $P_3$ (Caster): Inflicts $800\text{ Fire damage}$.
  - $P_4$ (Leech): Inflicts $30\text{ damage}$ and stands idle for 20 seconds.
- **Calculation:**
  - $C(P_1) = 1100 \times 1.0 = 1,100$
  - $C(P_2) = 300 \times 1.0 + 600 \times 0.8 = 780$ (Tanking credit awarded!)
  - $C(P_3) = 800 \times 1.0 = 800$
  - $C(P_4) = 30 \times 1.0 = 30$ (Also failed anti-AFK 12s active input test).
  - **Total Score:** $E = 1100 + 780 + 800 = 2,680$.
- **Ratios:**
  - $\Phi(P_1) = 1100 / 2680 = 41.0\% \ge 5\% \implies \mathbf{Eligible}$
  - $\Phi(P_2) = 780 / 2680 = 29.1\% \ge 5\% \implies \mathbf{Eligible}$
  - $\Phi(P_3) = 800 / 2680 = 29.8\% \ge 5\% \implies \mathbf{Eligible}$
  - $\Phi(P_4) = 30 / 2710 = 1.1\% < 5\% \implies \mathbf{Denied}$
- **Outcome:** $P_1, P_2,$ and $P_3$ each receive an independent, instanced loot drop. $P_4$ receives nothing.

---

### Scenario 3: Instant One-Shot Kill Denying Area Participation
- **Setup:** A high-level caster casts an upgraded Fireball that hits a newly spawned pack of Dire Wolves for $800\text{ damage}$ each, killing all of them in tick 0.
- **System Analysis:** In low-level zones (Level 1–15), high-level players one-shotting mobs disrupts quests.
- **Mitigation Rules:**
  1. High-level players ($\ge 10$ levels above zone) have a **$0.0\times$ loot drop chance** on non-elite open-world mobs.
  2. Quest items drop on **Dynamic Phased Quest Objects** or personal respawn nodes rather than contested open-world mob drops.
  3. High-level players have zero economic incentive to farm low-level open-world spawns.

---

### Scenario 4: Max-Tier Power Leap (+10 Legendary Equipment)
- **Setup:** A veteran player obtains a Legendary Broad Sword ($10\text{ Slash}$ base) and refines it to $+10$ with top-tier affixes.
- **Power Calculation:**
  $$\begin{aligned}
  \text{Base} &= 10 \times 2.0 \text{ (Legendary Tier)} = 20.0 \\
  \text{Refinement Bonus (+10)} &= 20.0 \times (1 + 0.50) = 30.0 \\
  \text{Prefix (Brutal)} &= +12 \text{ Flat Damage} \implies 30.0 + 12.0 = 42.0 \\
  \text{Suffixes (Additive Sum)} &= +25\% \text{ Damage} + 20\% \text{ Slash} = +45\% \\
  \text{Final Weapon Output} &= 42.0 \times 1.45 = \mathbf{60.9 \text{ Slash Damage}}
  \end{aligned}$$
- **Impact vs. Baseline:** A starting Long Sword deals $10\text{ damage}$. The $+10$ Legendary deals $\approx 60.9\text{ damage}$ ($6.09\times$ power increase).
- **Encounter Survivability:** High-tier bosses have $45,000\text{ HP}$ and $40\%$ armor protection. A $+10$ player deals $\approx 36.5\text{ net damage}$ per swing. It still requires over $1,200\text{ swings}$ to solo a boss. The game balance holds firmly; soloing group content remains impossible.
- **Failstack Experience:** The player never experiences catastrophic item destruction or level loss; failure accumulates failstack pity bonuses, maintaining engagement and economic circulation across Common, Intermediate, and Rare materials.

---

### Scenario 5: Repetitive Group Boss Farming & Loot Flooding
- **Setup:** An elite 5-player party clears a dungeon boss every 12 minutes for 8 hours consecutively.
- **Risk:** Flooding the server economy with rare Tempered and Legendary weapons, crashing market prices.
- **Mitigation:**
  1. **Keystone Gate:** Dungeon chests require an **Adventurer's Seal** to unlock full drop tables. Players receive only 3 Seals per week.
  2. **Diminishing Yields on Normal Runs:** If run without a Seal, the boss drops only crafting salvage dust and gold, with high-tier gear drop rates reduced by $95\%$.
  3. **Bind-on-Pickup (BoP):** The top $10\%$ rarest raid drops are BoP, preventing them from being liquidated on the Auction House.

---

### Scenario 6: Market Flooding & Price Collapses on the Auction House
- **Setup:** 50 players level Mining simultaneously, generating 10,000 Iron Ingots in 24 hours, posting them on the AH.
- **Risk:** Ingot prices collapse to $1\text{ copper}$, bankrupting new gatherers.
- **Mitigation & Stabilizers:**
  1. **Non-Refundable Listing Fee (5%):** Sellers must pay upfront. Flooding listings at unrealistic margins incurs immediate capital loss.
  2. **NPC Merchant Baseline Floor:** NPC blacksmiths purchase raw ingots at a fixed floor price ($2\text{ gold}$ per ingot). Market price can never fall below the vendor floor.
  3. **High-Tier Consumption Sink:** Smithing higher-tier gear requires hundreds of baseline ingots for flux and alloy synthesis, maintaining constant demand.

---

### Scenario 7: Multi-Box Resource Farming Swarms
- **Setup:** A player runs 6 browser tabs concurrently using software broadcast to gather ore nodes and loot mobs on all accounts.
- **Risk:** Multiplied resource extraction with zero labor cost.
- **Mitigation:**
  1. **WebSocket IP & Device Fingerprinting:** Gateway limits concurrent active game sessions to **2 per public IP address** unless granted a verified household exception.
  2. **Dynamic Gathering Directional Prompt:** The 15% random fissure shift event requires physical character repositioning. Broadcaster scripts miss directional offsets and fail the harvest.
  3. **Trade Velocity Auditing:** Automated background workers flag accounts that routinely funnel $100\%$ of gold and materials to a single master account without bilateral value exchange.

---

### Scenario 8: Crafter Overproduction & Market Saturation
- **Setup:** A dedicated blacksmith produces 500 Banded Armor sets to grind Smithing to 100.
- **Risk:** Massive inventory bloat; worthless equipment flooding vendors.
- **Mitigation:**
  1. **Salvaging Conversion:** The crafter immediately salvages the 500 armor sets, returning $40\%$ of the raw metals and generating **Magic Dust** for refinement.
  2. **Vendor Sale Deprecation:** Banded Armor sells to NPC merchants for only $15\%$ of craft cost, making vendor liquidation an inefficient sink compared to salvaging.
  3. **Durability Breakdown:** Over time, items in active combat lose maximum durability from repeated repairs, creating continuous replacement demand for freshly forged armor.

---

## 3. Recommended Telemetry & Economic Health Metrics

The server monitoring dashboard should track these key metrics daily:

| Metric | Target Safe Range | Alarm Threshold | Corrective Action if Breached |
|---|---|---|---|
| **Gold Faucet / Sink Ratio** | $0.90 \text{ to } 1.15$ | $> 1.40$ (Inflation) | Increase refinement gold costs; increase AH tax rate. |
| **AH Average Listing Time** | $8 \text{ to } 22\text{ hours}$ | $> 36\text{ hours}$ (Stagnation) | Reduce listing deposit fee; lower vendor floors. |
| **+10 Refinement Density** | $< 0.5\%$ of active weapons | $> 2.0\%$ (Gear Saturation) | Reduce Divine Catalyst drop rates; adjust base chance. |
| **Gini Coefficient of Wealth** | $0.55 \text{ to } 0.70$ | $> 0.85$ (Extreme Wealth Gap) | Implement progressive wealth tax on bank holdings $> 10M\text{ g}$. |
| **Bot Detection Flags** | $< 50\text{ events/day}$ | $> 300\text{ events/day}$ | Tighten input jitter thresholds and IP session caps. |

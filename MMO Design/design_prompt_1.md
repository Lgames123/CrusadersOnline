# Agent Prompt — Crusaders of Might and Magic: MMO Systems Design

## 1. Role and Mission

You are a senior MMORPG systems designer, game economy designer, combat systems analyst, and technical game designer working on **Crusaders of Might and Magic Online**, a persistent browser-based MMORPG inspired by the original single-player *Crusaders of Might and Magic*.

Your task is to inspect the existing project, understand its current implementation and the original game's mechanics, identify the design changes necessary to transform it into a sustainable MMORPG, and produce a comprehensive collection of Markdown design documents.

The original game is being reverse-engineered, and its engine is being reimplemented using Three.js for browser-based rendering and a multiplayer architecture.

This is not a request to simply add multiplayer networking to a single-player game. You must design the game systems that make a shared, persistent world enjoyable, fair, exploitable-resistant, economically sustainable, and technically feasible.

### Primary objectives

1. Preserve the identity, atmosphere, recognizable items, monsters, spells, and gameplay characteristics of the original game wherever appropriate.
2. Adapt single-player mechanics to persistent multiplayer gameplay.
3. Design systems that work with many players competing for the same monsters, resources, and rewards.
4. Prevent common MMORPG exploits, including AFK farming, multiboxing advantages, kill stealing, botting, economic manipulation, and item duplication.
5. Establish coherent relationships between combat, character progression, equipment, crafting or upgrading, loot, trading, and endgame content.
6. Create concrete, implementable design specifications rather than vague suggestions.
7. Record assumptions and unresolved decisions instead of silently treating proposals as established requirements.

Do not assume that every original mechanic should be retained. Recommend changes when they improve the multiplayer experience, but explain the reasoning, trade-offs, and consequences.

---

## 2. Repository and Game Archaeology

Before proposing major changes, inspect the existing project.

Read the relevant source code, documentation, game data, reverse-engineering notes, existing implementation plans, and architectural decisions.

Pay particular attention to:

- Player movement, physics, collision, and interaction.
- Monster behavior, AI, spawning, respawning, and aggro.
- Health, mana, damage, resistances, and death.
- Weapons, armor, shields, consumables, and named items.
- Weapon attack speeds, animations, spell casting, and combat timing.
- Character attributes, levels, experience, and progression.
- Item definitions, inventory structures, equipment slots, and item identifiers.
- Original damage formulas and special weapon behaviors.
- Existing client-server communication and persistence.
- The current Three.js rendering implementation and any planned server architecture.
- Existing documentation that describes mechanics not yet implemented.

If the repository contains an existing wiki or reverse-engineering documentation, use it as the primary source for verified mechanics. Follow existing documentation conventions when practical.

### Rules for analyzing the repository

Distinguish between the following:

- **Verified:** directly supported by existing source code, game data, tests, or reliable project documentation.
- **Inferred:** a plausible interpretation of incomplete or indirect evidence.
- **Proposed:** a new design recommendation for the MMORPG.
- **Unknown:** insufficient information to reach a reliable conclusion.

Never invent an original game's formula, mechanic, item property, or technical capability and present it as verified.

When useful, cite source file paths, symbols, functions, data structures, or documentation sections.

If information is missing, continue with explicit assumptions and explain what needs further investigation. Do not halt the entire design process because some mechanics remain unknown.

Do not modify the original game files or overwrite existing reverse-engineering evidence. Keep design documents separate from original game assets and binaries.

---

## 3. Design Principles

Use the following principles when evaluating every proposed mechanic.

### 3.1 Fairness

Players should have a reasonable opportunity to participate in combat and receive appropriate rewards.

A player should not lose all meaningful progression opportunities because another player has higher burst damage, attacks first, or uses multiple accounts.

At the same time, rewards should reflect meaningful contribution when appropriate.

### 3.2 Anti-exploit design

Assume players will optimize every system, including unintended interactions.

For every important mechanic, consider:

- AFK farming.
- Multiboxing and multiple accounts.
- Botting and automated input.
- Kill stealing.
- Tagging a monster and waiting for others to kill it.
- Joining combat immediately before a monster dies.
- Leaving combat before receiving a penalty.
- Manipulating spawn locations and respawn timing.
- Exploiting party membership.
- Trading items between accounts to circumvent restrictions.
- Duplicating items through concurrent requests or reconnects.
- Exploiting death, disconnects, inventory capacity, or transaction failures.
- Coordinated farming and monopolization by guilds.
- Creating alternate accounts to bypass progression or daily limits.

Do not assume that proximity, damage dealt, participation flags, or account limits are sufficient solutions by themselves.

### 3.3 Economic sustainability

Evaluate how items and currency enter and leave the economy.

Consider:

- Loot generation rates.
- Item destruction and permanent item sinks.
- Currency faucets and sinks.
- Equipment progression and replacement.
- Item supply, demand, and price inflation.
- Trading between players.
- Market concentration and price manipulation.
- Rare-item scarcity.
- Long-term player retention.
- The impact of veteran players on new-player progression.

### 3.4 Meaningful progression

Players should have several ways to progress without requiring every activity to be equally rewarding.

Consider combat, equipment, upgrading, exploration, gathering, crafting, trading, soft skills, dungeons, boss raids, and social cooperation.

Avoid making one activity so efficient that all other systems become irrelevant.

### 3.5 Technical feasibility

The game is being rebuilt as a browser-based MMORPG using Three.js.

Design with a persistent multiplayer server, concurrent player actions, authoritative state, and durable inventory and economy data in mind.

The client must never be trusted to determine authoritative damage, loot, item upgrades, currency balances, or trade outcomes.

Do not assume a particular backend language, database, or networking protocol unless the repository establishes it.

Where implementation choices are unresolved, describe the required behavior and provide feasible architectural options.

---

## 4. Required System Designs

Analyze all the following systems and identify additional systems that are necessary for a coherent MMORPG.

### 4.1 Shared Monster Combat and Loot Distribution

This is one of the highest-priority design problems.

In a single-player game, a monster normally exists for one player. In an MMORPG, several players may attack the same monster, and some weapons or spells may kill it in one hit.

Design a complete loot and reward distribution system.

Evaluate at least these approaches:

1. **First-hit ownership:** the first player to damage a monster establishes ownership.
2. **Highest-contribution ownership:** rewards are determined by damage or another contribution metric.
3. **Individual loot:** eligible players receive independent loot rolls.
4. **Shared loot:** a common drop pool is distributed between eligible players.
5. **Party-based loot:** rewards are distributed among eligible party members.
6. **Hybrid distribution:** different reward types use different eligibility and distribution rules.

You may propose alternatives or combinations that better fit this game.

For each approach, document:

- How eligibility is established.
- Whether a player must deal damage.
- Whether healing, buffs, tanking, crowd control, or other support actions count.
- How players joining late are handled.
- How one-hit kills affect reward eligibility.
- How parties and solo players coexist.
- How loot is distributed when multiple players qualify.
- How ranged attacks and damage-over-time effects are handled.
- What happens when a player disconnects, dies, or leaves the area.
- How rewards are handled if the server restarts during a kill.
- How the system resists AFK farming, multiboxing, and automated participation.
- How rare and named items are handled.
- The server-side data needed to implement the system.

#### Special problem: low-damage players

Consider a level-10 player attacking a monster that a level-80 player kills instantly.

The level-10 player may not have enough time to deal meaningful damage. A damage-contribution system could therefore prevent the lower-level player from receiving any reward.

Propose a fair solution without encouraging players to stand near powerful players and collect rewards without participating.

Consider alternatives such as:

- A minimum contribution threshold.
- Normalized contribution based on character power or encounter difficulty.
- Individual reward eligibility.
- Contribution windows and minimum active participation.
- Separate personal rewards and shared rewards.
- Grouping rules and level-based scaling.
- Encounter-specific reward pools.

Do not automatically adopt every alternative. Compare the benefits, drawbacks, exploitability, and implementation complexity of each.

#### Special problem: proximity rewards

Evaluate whether players should receive rewards merely by being near a monster when it dies.

Explain why unrestricted proximity-based loot can encourage AFK farming, multiboxing, and passive reward collection.

If proximity is used, specify additional eligibility requirements that demonstrate meaningful participation.

#### Required output

Recommend one primary loot architecture and, if justified, one alternative.

Define the full reward lifecycle:

`Monster Spawn → Combat Eligibility → Contribution Tracking → Monster Death → Reward Resolution → Loot Generation → Inventory or Loot Claim → Persistence`

Include state transitions, formulas, edge cases, and pseudocode where useful.

---

### 4.2 Item Rarity and Loot Tables

Design a complete item rarity system that works with the original game's equipment.

The following is an initial proposal, not a final specification.

| Rarity | Example drop rate | Color |
|---|---:|---|
| Battle-worn | 70% | Grey |
| Mundane | 25% | Blue |
| Tempered | 4.9% | Purple |
| Legendary | 0.1% | Orange |

These example rates sum to 100%. They must be evaluated, not blindly accepted.

Initial intended behavior:

**Battle-worn**
- Uses original item properties.
- Excludes named items from ordinary generation unless a special rule applies.

**Mundane**
- Approximately 1.2× base stats.
- Two random modifiers.

**Tempered**
- Approximately 1.5× base stats.
- Four random modifiers.
- Potentially +0 to +1 spell skill levels.

**Legendary**
- Approximately 2× base stats.
- Three random modifiers under the initial proposal.
- Potentially +1 to +3 spell skill levels.
- May include named items.

The intended rarity multipliers and modifier counts are hypotheses. Evaluate whether these tiers produce sensible progression, especially when combined with weapon upgrades.

#### Questions to resolve

1. Are rarity rolls global, per monster, per item, or per player?
2. Are the rates independent of monster level, monster type, zone, and difficulty?
3. Can any item appear in any rarity?
4. Should named items always be Legendary, or should their identity be independent of rarity?
5. Should named items retain unique mechanics instead of having all their properties multiplied?
6. How should negative or inverse-valued stats be scaled?
7. How should fractional stats be rounded?
8. Can an item roll an affix that contradicts its weapon type?
9. Can the same modifier appear more than once?
10. How should spell skill bonuses interact with maximum skill levels?
11. Should bosses and dungeons have different rarity distributions?
12. How should rare items remain valuable without making ordinary drops irrelevant?

#### Cascading rarity rolls

The initial concept is to roll the highest rarity first and proceed downward if a roll fails.

Analyze the probability implications.

Determine whether the configured numbers represent:

- Mutually exclusive final rarity probabilities.
- Independent threshold probabilities.
- Conditional probabilities in a cascading roll.

Provide the correct algorithm for the chosen interpretation.

Use numerical examples to show the resulting probability distribution.

Do not accidentally convert a desired 0.1% Legendary drop rate into a different probability by treating every tier as an independent percentage without adjusting the thresholds.

#### Important item identity rule

A named item should not become an ordinary item merely because of its rarity roll.

For example, if the original game defines a Thunderous Hammer with a unique identity, determine whether it should retain that identity while receiving additional rarity modifiers.

Analyze the difference between:

- Base item identity.
- Named-item identity.
- Rarity.
- Random affixes.
- Upgrade level.
- Item level.
- Monster or encounter origin.

Recommend a model that supports all of these without creating contradictory item states.

---

### 4.3 Item Affixes and Randomized Stats

Design a modifier system for generated equipment.

The following modifiers are examples and must be evaluated for balance, terminology, scaling, and implementation.

#### Flat increases

- Maximum HP: +1 to +25.
- Maximum Mana: +1 to +50.
- Damage: +1 to +10.
- Stamina: +1 to +3, potentially requiring a new gameplay effect.

#### Resistances

- Physical resistance: 1% to 20%, covering slash and bash.
- Elemental resistance: 1% to 20%, covering earth, wind, fire, and water.
- Magical resistance: 1% to 20%, covering light and dark.

Determine whether resistance modifiers should apply to a damage category, a specific element, or a combination of categories.

Prevent stacking from making characters effectively immune to entire damage types unless that is an intentional and carefully constrained endgame mechanic.

#### Improved combat properties

- Cast speed: +1% to +20%.
- Swing speed: +1% to +20%.
- Bash damage: +1% to +20%.
- Slash damage: +1% to +20%.
- Elemental damage: +1% to +10%.
- Magical damage: +1% to +10%.

For swing speed, investigate the original game's attack-speed representation.

For example, if a weapon has an attack speed of 1.1, determine whether an affix should add a flat amount, increase attacks per second multiplicatively, or reduce attack interval.

Do not assume the original stat is expressed in attacks per second without verifying it.

For cast speed, define which parts of casting are affected: animation duration, wind-up, cooldown, recovery, or some combination. Avoid allowing animation changes to desynchronize the authoritative server's combat calculations.

#### Special or legendary modifiers

- Global movement or action speed: +1% to +20%.
- More damage: +1% to +25%.
- Reduced mana cost: +1% to +25%.
- Increased consumable effectiveness: +1% to +10%.
- Life gained on melee hit: +1 to +5.
- Mana gained on melee hit: +1 to +5.
- Health regeneration: +1 to +3.
- Mana regeneration: +1 to +10.
- Chance to deal double damage: +1% to +10%.

These are provisional ranges, not mandatory final values.

#### Affix architecture

Specify:

- Prefixes and suffixes, or an alternative modifier-slot model.
- Affix eligibility by item type.
- Affix eligibility by rarity.
- Affix pools and weights.
- Minimum and maximum rolls.
- Item-level scaling.
- Duplicate-modifier restrictions.
- Mutually exclusive modifiers.
- Flat versus additive percentage versus multiplicative bonuses.
- Modifier interactions with upgrades.
- Modifier interactions with buffs, spells, and consumables.
- Display names and tooltip formatting.
- Server-side validation.
- Item generation seeds or equivalent debugging mechanisms.
- Item data serialization and persistence.

Create a data-driven structure that can be implemented without hardcoding every modifier into combat logic.

Provide example modifier definitions in JSON or TypeScript-style pseudocode, consistent with the existing project architecture.

#### Balance analysis

Analyze the risk of combining multiple damage multipliers.

For example, a Legendary weapon may have doubled base damage, a +25% damage modifier, a +20% damage-type bonus, and an upgrade level of +9.

Explain whether these effects should be additive or multiplicative, and show the resulting formula for at least one example.

Also evaluate how attack speed, double-damage chance, lifesteal-like effects, mana regeneration, and consumable effectiveness interact.

Identify dominant affixes and propose ways to avoid a small number of mandatory best-in-slot modifiers.

---

### 4.4 Equipment Upgrading: +0 to +9

Design an equipment refinement system inspired by the visible progression and upgrade glow of MU Online.

The goal is to make equipment upgrades rewarding, recognizable, and economically meaningful without making ordinary equipment obsolete.

Specify:

- Upgrade levels from +0 through +9.
- Upgrade success probability at every level.
- Required materials and currency.
- Material acquisition sources.
- Upgrade costs.
- Whether failed upgrades consume materials.
- Whether failure preserves, decreases, resets, damages, or destroys equipment.
- Whether protection items are available.
- Whether upgrades can be reversed.
- Whether all item categories can be upgraded.
- Whether rare, named, and Legendary items have different restrictions.
- Whether upgrade level affects base damage, armor, attributes, or all of them.
- How upgrade bonuses interact with rarity and affixes.
- Whether an item must be repaired or maintained.
- How upgrade systems affect item sinks and economic inflation.

Do not copy MU Online's upgrade behavior automatically. Use it as visual and conceptual inspiration.

#### Required quantitative analysis

Provide a complete table for +0 to +9, including:

- Success probability.
- Resource requirements.
- Expected number of attempts to reach the level.
- Expected total currency expenditure.
- Expected material expenditure.
- Consequences of failure.
- Estimated player power increase.

Compare at least two failure models, such as:

1. Failure consumes materials but preserves the current level.
2. Failure has a chance to reduce the upgrade level.

Consider whether high upgrade levels should have a guaranteed-success alternative with significantly higher costs.

Make assumptions explicit. If exact costs are not yet known, propose a tunable baseline rather than presenting invented numbers as established facts.

#### Upgrade visual progression

Design an equipment visual progression inspired by MU Online's escalating glow.

Specify the appearance of:

- +0 to +2: minimal or no additional glow.
- +3 to +5: subtle glow.
- +6 to +7: clearly visible enhancement.
- +8: strong glow and additional visual effects.
- +9: distinctive high-tier glow and particles.

These are starting suggestions, not mandatory thresholds.

Define how the system should work in Three.js:

- Material emissive properties.
- Shader or post-processing considerations.
- Particle effects.
- Weapon-specific visual effects.
- Performance limits.
- Visibility settings.
- Accessibility options.
- Network synchronization requirements.
- Whether the effect should depend on the item, the equipped model, or both.

Do not require expensive real-time effects for every weapon. Recommend a reusable, data-driven visual system.

---

### 4.5 Player Trading and Auction House

Design the player-driven economy.

Evaluate direct player trading and a centralized auction house as separate systems with shared constraints.

#### Direct trading

Specify:

- Trade initiation and acceptance.
- Trade windows.
- Item and currency transfer.
- Confirmation and finalization.
- Inventory capacity checks.
- Item locking while a trade is pending.
- Disconnect handling.
- Trade cancellation.
- Simultaneous actions and race conditions.
- Anti-duplication safeguards.
- Audit logs.
- Restrictions on equipped, bound, or protected items.

Both players must explicitly confirm the final transaction state. Any change to either offer must invalidate the previous confirmation.

The server must execute the final transaction atomically.

#### Auction house

Specify:

- Listing fees.
- Sale taxes.
- Listing duration.
- Buyout prices.
- Optional bidding.
- Search and filtering.
- Item comparisons.
- Expired listings.
- Unsold item returns.
- Offline sales.
- Storage and claim limits.
- Market history.
- Price manipulation prevention.
- Duplicate listings.
- Listing and cancellation abuse.
- High-value transaction auditing.

Evaluate whether the auction house should initially support:

- All tradable items.
- Equipment only.
- Consumables and materials.
- Selected categories.

Do not introduce unnecessary restrictions without a clear economic or gameplay reason.

#### Bound items and progression

Analyze whether any items should be:

- Fully tradable.
- Tradable until equipped.
- Bound to the character.
- Bound to the account.
- Untradable but salvageable.

Explain how each choice affects progression, social interaction, and the economy.

Recommend a coherent policy that avoids turning every valuable item into an unrestricted commodity while preserving the importance of trading.

#### Required output

Provide a complete economy flow diagram, transaction state machine, and example database entities or schemas for listings, trades, item ownership, currency transfers, and transaction logs.

---

### 4.6 Boss Raids and Instanced Dungeons

Design group content suitable for a persistent MMORPG.

Distinguish between open-world bosses, instanced dungeons, and instanced boss encounters.

For each type, define:

- Recommended party size.
- Entry requirements.
- Level or power requirements.
- Encounter duration.
- Boss mechanics.
- Reward structure.
- Loot eligibility.
- Death and resurrection rules.
- Disconnect and reconnection handling.
- Instance lifetime.
- Reset rules.
- Lockouts, if needed.
- Difficulty scaling.
- Solo and group viability.
- Repeatability.
- Anti-exploit rules.
- Rewards for players who join late or leave early.

Use the original game's monsters, areas, abilities, and environmental identity wherever appropriate.

Do not invent specific original bosses or mechanics without evidence. Label new encounter mechanics as proposals.

#### Instanced dungeon design

Compare:

1. One instance per party.
2. One instance per leader.
3. Matchmaking-generated instances.
4. Publicly accessible encounters with personal loot.

Explain how each approach affects server load, social gameplay, competition, and reward abuse.

#### Boss encounter design

Design encounter mechanics that require more than simply maximizing damage.

Consider:

- Telegraphs and dodging.
- Adds and priority targets.
- Elemental resistances.
- Interruptible attacks.
- Environmental hazards.
- Positioning.
- Defensive and support roles.
- Enrage timers.
- Phase transitions.
- Reward scaling based on encounter difficulty.

Avoid requiring rigid MMO roles unless the existing combat system can support them.

---

### 4.7 RuneScape-Style Soft Skills

Design a collection of secondary skills inspired by RuneScape's non-combat progression.

These systems should complement combat and the equipment economy rather than becoming mandatory chores.

Investigate appropriate options, including:

- Gathering.
- Mining.
- Herbalism.
- Fishing.
- Cooking.
- Smithing.
- Alchemy.
- Enchanting.
- Crafting.
- Repair.
- Scavenging.
- Other skills justified by the game's setting.

Do not implement every skill merely because it exists in RuneScape.

Select skills based on the original game's world, available resources, item systems, and the practical scope of the project.

For each recommended skill, define:

- Purpose.
- Level range.
- Experience formula.
- Unlock progression.
- Required tools.
- Resource acquisition.
- Resource respawn rules.
- Output items.
- Success and failure conditions.
- Economic role.
- Interactions with combat and equipment.
- Multiplayer competition.
- AFK and bot resistance.
- Progression rewards.
- Relevant NPCs, locations, or world activities.

#### Skill progression

Compare several progression models:

- Independent levels for each skill.
- A shared character level with skill-specific progression.
- Skill caps based on character level.
- Soft skill specializations.
- Account-wide versus character-specific progression.

Recommend a model and explain the consequences.

#### Economic integration

Soft skills should create meaningful relationships with:

- Equipment upgrading.
- Consumables.
- Trading.
- Auction house supply.
- Dungeon rewards.
- Monster drops.
- Repair or maintenance.
- Resource scarcity.

Avoid designing gathering and crafting systems that flood the economy with worthless materials or allow automated farming to dominate all progression.

---

## 5. Additional Systems You Must Evaluate

Do not limit the analysis to the explicitly requested systems.

Identify other mechanics that become necessary because the game is transitioning from single-player to MMORPG.

Evaluate, at minimum:

### Character progression
- Experience and leveling.
- Level caps and progression pacing.
- Death penalties.
- Character stats and respecs.
- New-player catch-up.
- Veteran-player advantages.

### Combat balance
- Damage formulas.
- Damage categories and resistances.
- Attack speed and casting speed.
- Buff and debuff stacking.
- Crowd control.
- PvE balance.
- PvP implications, even if PvP is not initially planned.
- Power creep.

### World design
- Shared versus private areas.
- Monster population and respawn rules.
- Resource competition.
- Safe zones.
- NPC interactions.
- Fast travel and movement.
- World events.
- Population density and server capacity.

### Social systems
- Parties.
- Guilds.
- Friend lists.
- Communication.
- Shared progression.
- Group reward rules.
- Guild monopolization of bosses and resources.

### Persistence and security
- Server-authoritative combat.
- Inventory consistency.
- Transaction atomicity.
- Save and reconnect behavior.
- Idempotent reward claims.
- Anti-duplication controls.
- Server-side validation.
- Audit logs.
- Rate limiting.
- Abuse detection.

### Long-term retention
- Daily and weekly activities.
- Repeatable content.
- Collection goals.
- Rare item chase.
- Endgame progression.
- Economic goals.
- Optional seasonal content.

Avoid automatically adding daily login rewards, energy systems, mandatory chores, or artificial time gates. Justify each retention mechanic by its contribution to player experience.

---

## 6. Balance Framework and Mathematical Validation

Do not design each system in isolation.

Create a shared balance framework that identifies how all the proposed mechanics interact.

### 6.1 Item power

Define a framework for estimating equipment power from:

- Base item statistics.
- Rarity.
- Affixes.
- Upgrade level.
- Item level.
- Special named-item effects.
- Character attributes.
- Skill bonuses.

The formula does not need to reduce all item power to a single universal number. If a scalar power score is useful for matchmaking or comparison, explain its limitations.

### 6.2 Progression curves

Propose initial progression curves for:

- Character experience.
- Monster health and damage.
- Item level.
- Affix ranges.
- Upgrade costs.
- Monster reward values.
- Dungeon difficulty.
- Soft skill experience.

Use tunable formulas and configuration tables instead of hardcoded values whenever practical.

### 6.3 Quantitative scenarios

Simulate or calculate representative scenarios.

At minimum:

1. A low-level player attacks a monster alongside a much stronger player.
2. Several players deal damage to the same monster.
3. A high-damage character kills a monster before other players can react.
4. A player receives a Legendary item and upgrades it to +9.
5. A group repeatedly farms a boss for rare equipment.
6. A large number of players list the same item on the auction house.
7. A player uses multiple accounts to farm resources.
8. A crafter generates equipment faster than the economy can consume it.

For each scenario, explain how the proposed rules behave and identify any incentives for exploitation.

Where sufficient data exists, use scripts or simple simulations to validate probability distributions, expected costs, reward rates, and progression curves. Store reusable assumptions and formulas in the documentation.

Do not fabricate simulation results. Distinguish calculations, estimates, and untested hypotheses.

---

## 7. Mandatory Decision Analysis

For every major design decision, include:

1. The problem being solved.
2. The candidate approaches.
3. The recommended approach.
4. Why it is preferable.
5. Advantages and disadvantages.
6. Exploits or failure modes.
7. Dependencies on other systems.
8. Technical implementation implications.
9. Tunable parameters.
10. Open questions and validation requirements.

When there are legitimate alternatives, compare them in a decision table.

Do not simply list every possible solution and leave all decisions to the developer. Make a recommendation, explain the trade-offs, and record alternatives worth preserving.

Avoid false precision. Unknown values should be documented as initial tuning proposals with the evidence or reasoning behind them.

---

## 8. Required Markdown Deliverables

Create a dedicated documentation directory following the existing repository conventions. If no suitable directory exists, use:

`docs/game-design/mmo/`

Produce the following documents.

### `README.md`
The design index.

Include:
- Project scope.
- Design principles.
- Document navigation.
- System dependencies.
- Status of major decisions.
- Recommended reading order.

### `01-mmo-design-pillars.md`
- Core MMO experience.
- Design principles.
- Intended player experience.
- Differences from the original single-player game.
- Constraints and non-goals.

### `02-loot-and-reward-distribution.md`
- Shared monster combat.
- Contribution tracking.
- Solo and party eligibility.
- Personal versus shared loot.
- Rare and named item distribution.
- Anti-AFK and multiboxing.
- Reward lifecycle.
- Edge cases and pseudocode.

### `03-item-rarity-and-affixes.md`
- Rarity tiers.
- Probability calculations.
- Named item identity.
- Affix definitions.
- Roll ranges.
- Stat scaling.
- Modifier stacking.
- Example item generation.
- Data structures.

### `04-equipment-upgrading.md`
- +0 to +9 progression.
- Success and failure probabilities.
- Costs and materials.
- Expected expenditure.
- Power scaling.
- Upgrade protection.
- Glow progression.
- Three.js visual implementation requirements.

### `05-player-trading-and-economy.md`
- Direct trading.
- Auction house.
- Tradability rules.
- Transaction lifecycle.
- Currency faucets and sinks.
- Market manipulation.
- Economic monitoring.

### `06-bosses-dungeons-and-instances.md`
- Open-world bosses.
- Instance models.
- Group sizes.
- Encounter design.
- Reward eligibility.
- Reset and lockout rules.
- Reconnection and failure handling.

### `07-soft-skills-and-crafting.md`
- Skill selection.
- Progression.
- Gathering.
- Crafting.
- Resource distribution.
- Economic integration.
- Anti-bot considerations.

### `08-progression-and-combat-balance.md`
- Character progression.
- Damage calculations.
- Item power.
- Level scaling.
- Defensive mechanics.
- Power creep.
- PvE and future PvP implications.

### `09-world-social-and-persistence.md`
- Shared world rules.
- Parties and guilds.
- Spawn management.
- Server-authoritative state.
- Persistence.
- Inventory consistency.
- Security and exploit prevention.

### `10-economy-and-balance-scenarios.md`
- Quantitative scenarios.
- Probability analysis.
- Upgrade simulations.
- Loot rate analysis.
- Inflation risks.
- Exploit scenarios.
- Suggested metrics.

### `11-implementation-roadmap.md`
- Recommended implementation order.
- Dependencies.
- Milestones.
- Testing requirements.
- Acceptance criteria.
- Initial playable MMO scope.
- Deferred features.

### `12-open-decisions-and-risk-register.md`
- Unresolved decisions.
- Evidence required.
- High-risk assumptions.
- Exploit risks.
- Balance risks.
- Technical risks.
- Questions requiring developer approval.

You may create additional Markdown files when a subject needs more detailed treatment. Avoid duplicating the same specifications across multiple documents; use cross-references.

If an existing project already contains relevant design documents, update or reference them rather than creating redundant alternatives.

---

## 9. Documentation Quality Requirements

All documents must be detailed enough that another coding agent can implement the system without having to reinvent its fundamental rules.

Use:

- Clear headings.
- Tables for configuration and comparison.
- Mathematical formulas.
- Concrete examples.
- State machines.
- Mermaid diagrams when useful.
- Pseudocode.
- Example data structures.
- Explicit assumptions.
- Acceptance criteria.
- Cross-references to related systems.

For formulas, define every variable and unit.

For percentages, specify whether they are additive or multiplicative.

For loot probabilities, show how the configured values translate into final probabilities.

For costs and progression, explain whether figures are examples, initial defaults, or validated values.

For database and network requirements, distinguish required behavior from implementation-specific examples.

Keep original game mechanics separate from new MMO design decisions.

Do not generate enormous documents filled with generic MMO advice. Every recommendation must be relevant to this project or explicitly justify why a general MMO mechanic is needed.

---

## 10. Implementation Roadmap

Create a staged roadmap that minimizes rework and enables early testing.

Consider the following dependency order, adjusting it to the actual repository:

**Stage 1 — Design foundations**
- Verify existing combat and item mechanics.
- Establish shared terminology.
- Define authoritative server responsibilities.
- Define item identity, rarity, modifiers, and ownership.

**Stage 2 — Multiplayer combat foundations**
- Shared monster state.
- Spawn and respawn behavior.
- Combat eligibility.
- Contribution tracking.
- Reward resolution.
- Persistence and reconnect handling.

**Stage 3 — Equipment and progression**
- Item generation.
- Rarity and affixes.
- Character progression.
- Equipment upgrading.
- Power and combat balance.

**Stage 4 — Multiplayer economy**
- Inventory ownership guarantees.
- Direct trading.
- Currency transactions.
- Auction house.
- Economic telemetry.

**Stage 5 — Group content**
- Parties.
- Instanced dungeons.
- Boss encounters.
- Group reward rules.

**Stage 6 — Soft skills and long-term progression**
- Gathering.
- Crafting.
- Resource economy.
- Additional progression systems.
- Endgame content.

This is a provisional order. Reorder systems when repository dependencies or technical constraints justify it.

For every milestone, define:
- Prerequisites.
- Deliverables.
- Test cases.
- Acceptance criteria.
- Known limitations.
- Dependencies on earlier milestones.

Prioritize a small but coherent playable MMO over implementing every feature at once.

---

## 11. Testing and Acceptance Criteria

The documentation itself must include tests that can later be translated into automated tests.

At minimum, cover:

### Loot
- Multiple players attacking the same monster.
- A monster dying in one hit.
- A low-level player participating in a high-level encounter.
- Players joining immediately before death.
- AFK players near a monster.
- Multiple characters controlled by one player.
- Disconnects during reward resolution.
- Duplicate reward requests.
- Monster death during a server restart.

### Items
- Correct rarity probabilities.
- Correct affix eligibility.
- Correct stat ranges.
- No invalid duplicate affixes.
- Correct handling of negative base stats.
- Correct named-item identity.
- Correct modifier stacking.
- Valid item serialization and deserialization.

### Upgrades
- Every upgrade transition from +0 to +9.
- Failed upgrades.
- Resource consumption.
- Concurrent upgrade requests.
- Disconnects during upgrades.
- Protection item behavior.
- Expected expenditure calculations.

### Trading and auction house
- Simultaneous trades.
- Inventory capacity failures.
- Currency validation.
- Duplicate transaction requests.
- Listing and cancellation races.
- Expiration and item return.
- Server restart during settlement.
- Item duplication prevention.

### Dungeons and soft skills
- Invalid entry attempts.
- Party membership changes.
- Disconnects and reconnects.
- Reward eligibility.
- Instance resets.
- Resource competition.
- Skill experience exploits.
- Automated repetitive actions.

Use acceptance criteria that describe observable behavior rather than vague statements such as "works correctly."

---

## 12. Execution Instructions

Execute this task in the following order.

1. Inspect the repository and identify existing architecture, source-of-truth documentation, mechanics, and constraints.
2. Build an internal dependency map for the proposed systems.
3. Identify contradictions between the existing game implementation and the desired MMO design.
4. Establish a consistent set of initial design assumptions.
5. Analyze the loot system first because it affects combat, economy, parties, and progression.
6. Design item identity, rarity, affixes, and upgrading as a unified equipment system.
7. Design trading, the auction house, and economic controls.
8. Design dungeons, bosses, soft skills, and long-term progression.
9. Validate interactions between the systems using quantitative examples.
10. Produce the required Markdown documents.
11. Review all documents for contradictions, missing edge cases, duplicated specifications, and unsupported claims.
12. Produce a final implementation roadmap and prioritized list of decisions requiring developer approval.

Create and edit the actual `.md` files in the repository if filesystem tools are available. Do not merely print their proposed contents in the chat.

Do not modify unrelated source code, original game files, binaries, or assets as part of this design task.

If the environment does not permit filesystem changes, provide the complete contents of the proposed Markdown files in a clearly organized form.

Do not stop after creating the README or a high-level outline. Complete the requested documents to the extent permitted by the available evidence and tools.

---

## 13. Final Report

After creating the documents, provide a concise report containing:

- Files created or updated.
- The recommended shared-monster loot model.
- The recommended rarity and affix architecture.
- The recommended +0 to +9 upgrade model.
- The recommended trading and auction house architecture.
- The proposed dungeon and soft-skill models.
- The most important balance and exploit risks.
- The recommended implementation sequence.
- The unresolved decisions that require developer input.
- Any assumptions that could not be verified against the repository.

Clearly distinguish implemented documentation from features that still need coding.

**Final instruction:** Optimize for a coherent, fair, exploit-resistant MMORPG that preserves the identity of *Crusaders of Might and Magic*. Make defensible recommendations, validate their mathematical implications, document their trade-offs, and ensure that the resulting systems can eventually be implemented and tested by coding agents.
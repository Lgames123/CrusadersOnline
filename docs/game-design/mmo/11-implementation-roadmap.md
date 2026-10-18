# 11 — Staged Implementation Roadmap & Acceptance Testing

## 1. Roadmap Strategy: Minimizing Rework & Maximizing Playability

Transforming *Crusaders of Might and Magic Online* into a sustainable MMORPG requires a strict dependency-driven delivery pipeline. Attempting to build trading or auction houses before inventory authority and loot generation are locked leads to catastrophic refactors and security flaws.

The development roadmap is structured into **6 sequential stages**, moving from core simulation authority to complex multiplayer meta-systems.

```mermaid
graph LR
    S1[Stage 1: Core Authority & Data Models] --> S2[Stage 2: Shared Combat & Loot Lifecycle]
    S2 --> S3[Stage 3: Rarity, Affixes & Upgrades]
    S3 --> S4[Stage 4: Player Economy & Trade 2PC]
    S4 --> S5[Stage 5: Dungeons & Group Bosses]
    S5 --> S6[Stage 6: Soft Skills & Endgame Loops]
```

---

## 2. Detailed Milestone Specifications

### Stage 1: Foundations, Item Identity & Server Authority
- **Objective:** Establish unshakeable server authority over character state, item definitions, and inventory grid storage.
- **Prerequisites:** Existing PostgreSQL schema (`001_initial_schema.sql`), Three.js client bootstrap.
- **Deliverables:**
  - `shared/src/game/items.ts`: Item definition catalog with 4-tier rarity metadata.
  - `server/src/persistence/migrations/005_item_instances.sql`: Transition to UUID item instances with JSONB affix payloads.
  - `server/src/simulation/inventory_authority.ts`: Row-level locked inventory mutators.
- **Automated Tests:**
  - `test_inventory_atomic_swap`: Validates that moving items between slots executes under row lock.
  - `test_double_equip_prevention`: Rejects concurrent duplicate equip packets.
- **Acceptance Criteria:** A client can pick up, equip, and drop items with $100\%$ authoritative rollback on simulated packet drops.

---

### Stage 2: Multiplayer Combat & Shared Loot Lifecycle
- **Objective:** Enable multiple players to attack the same monster with deterministic threat, contribution tracking, and instanced reward drops.
- **Prerequisites:** Stage 1 complete; 20 Hz zone worker loop running.
- **Deliverables:**
  - `server/src/simulation/contribution_tracker.ts`: Tracks damage, absorbed hits, healing, and CC.
  - `server/src/simulation/loot_generator.ts`: Resolves individual instanced drops based on $\ge 5\%$ threshold.
  - `client/src/ui/combat_hud.ts`: Damage numbers, target health bars, and instanced loot markers.
- **Automated Tests:**
  - `test_low_level_kill_steal_protection`: Simulates Level 10 + Level 50 contention; verifies Level 10 gets full loot.
  - `test_anti_afk_timeout`: Verifies that characters with no inputs for $> 12\text{ s}$ receive zero loot.
- **Acceptance Criteria:** Three players can attack a single Skeleton Warrior; all qualifying players see their own independent loot drop appear at the corpse without ninja-looting risks.

---

### Stage 3: Equipment Rarity, Affixes & +0 to +10 Upgrading
- **Objective:** Deploy the full equipment progression system, Failstack pity refinement loop (3 material tiers), and Three.js visual glow shaders.
- **Prerequisites:** Stage 2 complete.
- **Deliverables:**
  - `server/src/simulation/refine_service.ts`: Handles $+0 \to +10$ rolls, zero degradation, failstack accumulation ($\Delta P$), and 3-tier material consumption (Common 1-4, Intermediate 5-8, Rare 9-10).
  - `client/src/render/weapon_glow.ts`: Selective emissive shaders and Three.js particle emitters for $+3 \dots +10$ items.
  - `shared/src/game/affix_engine.ts`: Generates prefixes/suffixes using the cumulative CDF algorithm; rolls dynamic rarity on world pickups and chests.
- **Automated Tests:**
  - `test_failstack_refinement_distribution`: Simulates 100,000 upgrade attempts; verifies expected cost curve and pity guarantees.
  - `test_stat_pipeline_stacking`: Asserts that Legendary multipliers, $+10$ upgrades, and affixes stack additively, avoiding exponential explosions.
  - `test_world_pickup_rarity_roll`: Asserts that claiming level pickups and chests triggers the CDF rarity roll.
- **Acceptance Criteria:** A player can refine a Long Sword from $+0$ to $+10$ at an anvil without fear of item loss or regression, accumulating failstacks upon failure, and observing the transcendent chromatic aura at $+10$ in the 3D viewport.

---

### Stage 4: Player Economy, Direct Trade & Centralized Auction House
- **Objective:** Provide a completely secure, exploit-resistant player-to-player trading and auction system.
- **Prerequisites:** Stage 3 complete; durable PostgreSQL persistence.
- **Deliverables:**
  - `server/src/simulation/trade_session.ts`: Two-Phase Commit trade window with dual-affirmation.
  - `server/src/persistence/migrations/006_economy_tables.sql`: Tables for `auction_listings`, `player_mailbox`, and `audit_log`.
  - `client/src/ui/auction_house_window.ts`: Search, filter, listing creation, and buyout UI.
- **Automated Tests:**
  - `test_trade_cancellation_race`: Sends concurrent Cancel and Finalize packets; asserts zero item duplication.
  - `test_auction_escrow_atomicity`: Verifies that listed items cannot be equipped or dropped from inventory.
- **Acceptance Criteria:** Two players can execute a direct trade of items and gold; items are transferred atomically with row-level locks and logged to the audit table.

---

### Stage 5: Instanced Dungeons & Group Boss Encounters
- **Objective:** Launch dedicated multi-room group instances with telegraph-driven boss mechanics.
- **Prerequisites:** Stage 4 complete; party system in place.
- **Deliverables:**
  - `server/src/simulation/instance_manager.ts`: Provisions ephemeral zone worker threads for party leases.
  - `client/src/render/boss_telegraphs.ts`: Renders ground decal cones and circles for incoming boss attacks.
  - `server/src/content/boss_crypt_overlord.ts`: Scripted 3-phase boss encounter with adds and interrupts.
- **Automated Tests:**
  - `test_dungeon_worker_isolation`: Verifies that a crash in an instance worker does not affect the main world zone.
  - `test_keystone_lockout_enforcement`: Rejects party entry if required weekly keystones are exhausted.
- **Acceptance Criteria:** A 4-player party can enter the Catacombs Crypt instance, fight through trash mobs, defeat the multi-phase Crypt Overlord, and claim instanced Keystone loot.

---

### Stage 6: Soft Skills, Resource Gathering & Refining
- **Objective:** Complete the economic loop with RuneScape-style Mining, Herbalism, Smithing, and Salvaging.
- **Prerequisites:** Stage 5 complete.
- **Deliverables:**
  - `server/src/simulation/resource_nodes.ts`: Multi-tap dynamic ore veins and herb patches.
  - `server/src/simulation/crafting_service.ts`: Recipe validation and XP awards (Levels 1–100).
  - `client/src/ui/crafting_window.ts`: Profession progress sheets and recipe books.
- **Automated Tests:**
  - `test_multi_tap_node_concurrency`: Verifies that 3 players harvesting the same vein deplete charges correctly without race conditions.
  - `test_salvage_yield_rates`: Asserts that dissolving gear yields the intended Magic Dust and Celestial Shard quantities.
- **Acceptance Criteria:** A player can mine iron ore in the wild, smelt it into ingots at a forge, craft a sword, or salvage unwanted loot into refinement dust.

---

## 3. Initial Playable Scope (MVP) vs. Deferred Features

| System / Feature | In Scope for Initial Playable MMO (MVP) | Deferred to Post-Launch Expansions |
|---|---|---|
| **Combat** | Melee combo chain, directional shield blocks, 11 spells. | Dual-wielding, archery / bows, mounted combat. |
| **Classes / Roles** | Open build (attributes + equipment define archetype). | Strict class trees or locked profession specializations. |
| **World Zones** | Citadel Town (Hub), Catacombs Depth (Dungeon), Duskwood Clearing. | Large seamless continents, naval travel, player housing. |
| **Economy** | Direct Trade, Centralized AH, $+0 \to +9$ Refinement, Salvaging. | Cross-server auctions, stock markets, guild land tax. |
| **Group Content** | 5-player party instances, 1 open-world roaming boss. | 25-player multi-wing raid dungeons, competitive battlegrounds. |
| **PvP** | Optional 1v1 dueling in town arenas with damage dampening. | Open-world faction warfare, castle sieges. |
| **Soft Skills** | Mining, Smithing, Salvaging, Alchemy (Levels 1–100). | Farming, Carpentry, Sailing, Animal Husbandry. |

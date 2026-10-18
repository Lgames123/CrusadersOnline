# 12 — Open Decisions & Systemic Risk Register

## 1. Unresolved Decisions Requiring Developer Sign-Off

The following design decisions represent trade-offs between player friction, economic durability, and development complexity. They are documented here with recommended options awaiting final lead developer approval:

| Decision ID | System & Context | Candidate Options | Adopted Resolution | Trade-offs & Consequences |
|---|---|---|---|---|
| **DEC-001** | **Equipment Refinement (+0 to +10) & Failure Rules** | 1. Hard destruction.<br>2. Level degradation (-1).<br>3. Zero destruction / zero regression with failstack pity. | **RESOLVED: Option 3 (Zero Destruction, Zero Regression, Cumulative Failstack Pity)** | Upgrades capped at $+10$. An attempt never breaks or lowers item level. Failure accumulates a success chance bonus ($\Delta P$) until success. Materials structured across 3 tiers (1-4 Common, 5-8 Intermediate, 9-10 Rare). |
| **DEC-002** | **Currency Unit Taxonomy** | 1. Single Gold Integer (e.g. `14,500 gold`).<br>2. Multi-tier Copper/Silver/Gold. | **Option 1: Single Gold Integer (Recommended)** | Eliminates conversion bugs, fractional division errors, and complex UI formatting. Storage uses standard 64-bit integer (`BIGINT`) in PostgreSQL. |
| **DEC-003** | **Dungeon Entry Limiter** | 1. Fixed Daily Lockout (1 run/day).<br>2. Consumable Keystones (3 Seals/week).<br>3. Diminishing Yields (unlimited runs). | **Option 2: Consumable Keystones (Recommended)** | Daily lockouts alienate weekend players; diminishing yields allow extreme 18-hour grinders to dominate. Keystones grant flexible scheduling. |
| **DEC-004** | **Named Drops & Map Spawn Rarity** | 1. 100% fixed drops & static pickups.<br>2. Probabilistic drops & dynamic chest/pickup rarity. | **RESOLVED: Option 2 (Probabilistic Named Drops & Dynamic World Pickup Rarity)** | Boss drops (e.g., Thunderous Hammer) are not guaranteed 100%; they follow percentage drop rates. All fixed world ground pickups and unique chests execute standard CDF rarity rolls on character claim. |
| **DEC-005** | **Soft Skill Scope** | 1. Character-bound progression.<br>2. Account-wide progression pool. | **Option 1: Character-Bound (Recommended)** | Fosters character identity, promotes alternative character (alt) leveling, and prevents single accounts from instantly dominating all professions. |
| **DEC-006** | **World Zone Level Distribution (1 to 50)** | 1. Uniform world scaling.<br>2. Geographic brackets across existing maps. | **RESOLVED: Option 2 (Zonal Progression 1 to 50 with Sanctuary Safe Zones)** | Levels 1–50 mapped to original maps (`train`, `Cs1a/b`, `Ca`, `Du`, `Ws`, `Gl`, `Ci/Co`). Areas without aggressive monsters (`Ci1b`, `Cs1b-Inn`) are designated Safe Zone Sanctuaries (combat locked, double regen, trade hubs). |

---

## 2. Technical & Performance Risk Register

| Risk ID | Severity | Category | Risk Description | Failure Mode | Mitigation Architecture |
|---|---|---|---|---|---|
| **TR-001** | **HIGH** | Client WebGL | Heavy Three.js draw-call overhead when $> 30$ glowing players gather in town. | Frame rates plummet below 20 FPS on integrated GPUs. | Dynamic LOD: weapon particles and pulsating bloom shaders disable beyond $25\text{ m}$; distant weapons render flat low-poly meshes. |
| **TR-002** | **HIGH** | Server Sim | 20 Hz tick loop overrun during intense 20-player AoE melee combat. | Simulation ticks exceed $50\text{ ms}$; movement prediction falls out of sync. | Spatial hash grid ($32\text{m} \times 32\text{m}$) caps broadphase queries; forward cone sweeps execute on broadphase pairs only. |
| **TR-003** | **MED** | Database | High concurrency lock contention on `inventory_items` during world boss death. | PostgreSQL transaction timeouts and pool exhaustion. | Instanced loot is generated in zone memory first; DB writes occur lazily when a player interacts with their personal loot container. |
| **TR-004** | **MED** | Memory | Spawning dozens of ephemeral zone workers for dungeon instances exhausts RAM. | Node.js host runs out of memory and crashes gateway. | Hard cap of 30 concurrent instance workers; inactive instances teardown after $5\text{ minutes}$ of zero active player presence. |

---

## 3. Exploit & Abuse Risk Register

| Risk ID | Severity | Threat Vector | Exploit Mechanism | Intended Attacker Gain | Authoritative Defense |
|---|---|---|---|---|---|
| **EX-001** | **CRITICAL** | Item Duplication | Rapid concurrent trade acceptance combined with forced socket termination. | Generating cloned high-value $+9$ items. | Strict Two-Phase Commit with PostgreSQL `SELECT ... FOR UPDATE` row locks; transactions commit atomically or roll back completely. |
| **EX-002** | **HIGH** | Combat Logging | Alt+F4 / closing browser tab while stunned or on low HP to evade death penalty. | Avoiding durability damage and death sickness. | Disconnecting in combat leaves the player avatar in the simulation for **$30\text{ seconds}$**, taking normal damage. |
| **EX-003** | **HIGH** | Market Cornering | Wealthy cartels buying out all raw iron and relisting at $1,000\%$ markup. | Monopolizing refinement materials; price gouging. | Non-refundable $5\%$ listing fee burns massive gold on relisting; NPC blacksmiths sell baseline materials at a static price ceiling. |
| **EX-004** | **MED** | Multi-Box Leeching | Running 5 background tabs following a main character to siphon group XP and loot. | Automated passive farming. | Active input verification ($< 12\text{ s}$); individual contribution threshold ($5\%$ minimum); max 2 concurrent sessions per public IP. |
| **EX-005** | **MED** | Terrain Kiting | Pulling melee bosses into broken geometry where pathfinding cannot reach the player. | Effortless solo boss kills. | If a monster cannot path to its target for $> 6\text{ seconds}$, it enters Reset state, gaining full invulnerability and returning to spawn. |

---

## 4. Economic Balance & Inflation Risk Register

| Risk ID | Severity | Category | Economic Threat | Symptoms & Early Indicators | Automated Corrective Lever |
|---|---|---|---|---|---|
| **EC-001** | **CRITICAL** | Inflation | Monster gold faucets outpace gold destroyed by repairs and refinement. | AH prices of mundane items skyrocketing; gold value plummeting. | Dynamic Tax Adjuster: if gold supply increases by $> 5\%$ weekly, Auction House tax scales from $10\% \to 15\%$ automatically. |
| **EC-002** | **HIGH** | Gear Saturation | High-tier drops are too frequent; veteran players have no upgrade goals. | Tempered and Legendary items selling at vendor floor prices. | Elevate salvage yields for high-tier gear, increasing the demand for breaking down surplus items for dust. |
| **EC-003** | **MED** | Newbie Exclusion | Veteran inflation makes entry-level gear unaffordable for Level 1–10 players. | New player retention drops below $20\%$ after Day 1. | Quest rewards grant Bind-on-Pickup starter equipment sets; basic weapons sold by NPC merchants at fixed non-inflationary prices. |
| **EC-004** | **MED** | Crafting Stagnation | Dropped mob gear is so powerful that blacksmithing becomes obsolete. | Zero activity on Smithing anvils; ore prices crash. | Exclusive Refinement Reagents: high-tier upgrades ($+7 \dots +9$) **require master-crafted ingots** that only Level 75+ Blacksmiths can produce. |

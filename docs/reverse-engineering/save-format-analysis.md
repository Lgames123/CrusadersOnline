# Save Format Analysis & State Persistence Mapping

## 1. Overview & Forensic Baseline

In the original PC release of *Crusaders of Might and Magic*, save files are created in the `Gamers/` directory upon user saving at in-game shrines or checkpoints.
- A clean GOG installation contains an empty `Gamers/` directory by default.
- Original slot format: Binary records storing player position, health, inventory arrays, active quest flags, and zone identifiers.

---

## 2. Re-architecting Persistence for a Persistent MMORPG

In a single-player game, save state is a localized snapshot written to disk whenever the player chooses. In a persistent MMORPG:
1. **No Client Save Files:** State is never saved by the client; doing so would allow save-state rollbacks and item duplication.
2. **Transactional Database Persistence:** Player state (level, XP, gold, health, mana, equipped items, inventory grid, quest progress) is persisted to PostgreSQL tables.
3. **Dirty-State Auto-Save:** The game server flushes character states to PostgreSQL:
   - Periodically (every 60 seconds).
   - Immediately upon zone transitions.
   - Immediately upon item transfers, trades, or bank deposits.
   - Synchronously upon player disconnect.

---

## 3. Character State Schema Mapping

| Original Game State | Single-Player Save Representation | MMORPG Relational Schema (`characters` table) |
|---|---|---|
| **Character Identity** | Save Slot Index (0..9) | `id UUID PRIMARY KEY`, `account_id UUID REFERENCES accounts` |
| **Name** | "Drake" (Fixed) | `name VARCHAR(32) UNIQUE` |
| **Attributes** | Might, Intellect, Endurance, Speed | `might INT`, `intellect INT`, `endurance INT`, `speed INT` |
| **Vitals** | Current HP, Current Mana | `current_hp INT`, `max_hp INT`, `current_mana INT`, `max_mana INT` |
| **Progression** | Level, XP | `level INT DEFAULT 1`, `experience_points BIGINT DEFAULT 0` |
| **Currency** | Gold count | `gold INT DEFAULT 0` |
| **Current World Location** | Zone ID, Vector3 (X, Y, Z, Yaw) | `zone_id VARCHAR(32)`, `pos_x FLOAT`, `pos_y FLOAT`, `pos_z FLOAT`, `yaw FLOAT` |
| **Equipment** | Weapon ID, Shield ID, Armor ID | `equipment JSONB` (or normalized `character_equipment` table) |
| **Inventory** | Item ID array + counts | `inventory_items` table with foreign key `character_id` |

---

## 4. Disaster Recovery & Crash Protection

To prevent loss of player progress during unexpected server restarts:
1. **PostgreSQL WAL (Write-Ahead Logging):** Guarantees zero data corruption on sudden system shutdown.
2. **Graceful Shutdown Hook:** The Node.js server listens for `SIGINT` and `SIGTERM`, suspends the network gateway, runs a parallel `Promise.all` flushing all connected player memory states to PostgreSQL, and then exits cleanly.

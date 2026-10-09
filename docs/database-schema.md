# Database Schema: PostgreSQL Relational Models & Migrations

## 1. Relational Topology & Constraints

The database engine is PostgreSQL 18 (17 minimum), accessed through Kysely (ADR-007). In development and tests the same schema runs on PGlite (embedded PostgreSQL 18). The authoritative schema is `server/src/persistence/migrations/001_initial_schema.sql`; the listing below is the original design (the migration uses built-in `gen_random_uuid()`, case-insensitive unique indexes on `lower(username)` / `lower(name)`, a nullable `email`, and nullable `pos_*` for never-placed characters). The schema enforces strict referential integrity, foreign key cascading, and row-level locks for transaction safety.

```sql
-- Migration 001_initial_schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Accounts Table
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(32) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sessions Table (ADR-008: opaque, revocable server-side sessions)
CREATE TABLE sessions (
    id BYTEA PRIMARY KEY,                -- SHA-256 of the random session token (token itself never stored)
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE
);

-- Characters Table
CREATE TABLE characters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(32) UNIQUE NOT NULL,
    level INT NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 50),
    experience_points BIGINT NOT NULL DEFAULT 0,
    current_hp INT NOT NULL DEFAULT 100,
    max_hp INT NOT NULL DEFAULT 100,
    current_mana INT NOT NULL DEFAULT 50,
    max_mana INT NOT NULL DEFAULT 50,
    might INT NOT NULL DEFAULT 20,
    intelligence INT NOT NULL DEFAULT 15,
    endurance INT NOT NULL DEFAULT 25,
    speed INT NOT NULL DEFAULT 15,
    gold INT NOT NULL DEFAULT 0 CHECK (gold >= 0),
    zone_id VARCHAR(32) NOT NULL DEFAULT 'test_arena',
    pos_x FLOAT NOT NULL DEFAULT 0.0,
    pos_y FLOAT NOT NULL DEFAULT 0.0,
    pos_z FLOAT NOT NULL DEFAULT 0.0,
    yaw FLOAT NOT NULL DEFAULT 0.0,
    last_saved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Inventory & Equipment Items Table
CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL,
    slot_index INT NOT NULL CHECK (slot_index >= 0 AND slot_index <= 31),
    is_equipped BOOLEAN NOT NULL DEFAULT FALSE,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    durability INT NOT NULL DEFAULT 100,
    UNIQUE (character_id, slot_index)
);

-- Indexes for performance
CREATE INDEX idx_characters_account ON characters(account_id);
CREATE INDEX idx_inventory_character ON inventory_items(character_id);
CREATE INDEX idx_sessions_account ON sessions(account_id);
```

---

## 2. Migration Execution in Node.js

The server connects via `pg` + Kysely. Migrations are plain `.sql` files applied in order by the Kysely `Migrator` with a small SQL-file provider (`pnpm db:migrate`; also run at startup in development). Applied migrations are tracked in Kysely's migration table, so each file runs exactly once:
```typescript
import { Kysely, Migrator, PostgresDialect, sql, type Migration, type MigrationProvider } from 'kysely';
import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

class SqlFileMigrationProvider implements MigrationProvider {
  constructor(private dir: string) {}
  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.sql')).sort();
    const out: Record<string, Migration> = {};
    for (const f of files) {
      const text = await readFile(path.join(this.dir, f), 'utf-8');
      out[f] = { up: async (db) => { await sql.raw(text).execute(db); } };
    }
    return out;
  }
}

export async function runMigrations(db: Kysely<unknown>): Promise<void> {
  const migrator = new Migrator({ db, provider: new SqlFileMigrationProvider(path.join(import.meta.dirname, 'migrations')) });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
}
```

Inventory mutations use explicit transactions with row locks:
```typescript
await db.transaction().execute(async (trx) => {
  const item = await trx.selectFrom('inventory_items').selectAll()
    .where('id', '=', itemId).where('character_id', '=', characterId)
    .forUpdate().executeTakeFirstOrThrow();
  // ... validate and mutate within the same transaction
});
```

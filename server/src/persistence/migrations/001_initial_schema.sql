-- 001_initial_schema.sql — accounts, sessions, characters, inventory (database-schema.md)
-- gen_random_uuid() is built into PostgreSQL 13+; no extension required.

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_username_lower ON accounts (lower(username));
CREATE UNIQUE INDEX accounts_email_lower ON accounts (lower(email)) WHERE email IS NOT NULL;

-- ADR-008: opaque, revocable server-side sessions. Only the SHA-256 of the token is stored.
CREATE TABLE sessions (
    id BYTEA PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_sessions_account ON sessions(account_id);

CREATE TABLE characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(20) NOT NULL,
    level INT NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 50),
    experience_points BIGINT NOT NULL DEFAULT 0 CHECK (experience_points >= 0),
    current_hp INT NOT NULL DEFAULT 100,
    max_hp INT NOT NULL DEFAULT 100,
    current_mana INT NOT NULL DEFAULT 50,
    max_mana INT NOT NULL DEFAULT 50,
    might INT NOT NULL DEFAULT 20,
    intelligence INT NOT NULL DEFAULT 15,
    endurance INT NOT NULL DEFAULT 25,
    speed INT NOT NULL DEFAULT 15,
    gold INT NOT NULL DEFAULT 0 CHECK (gold >= 0),
    zone_id VARCHAR(32) NOT NULL DEFAULT 'arena-1',
    pos_x DOUBLE PRECISION,
    pos_y DOUBLE PRECISION,
    pos_z DOUBLE PRECISION,
    yaw INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX characters_name_lower ON characters (lower(name));
CREATE INDEX idx_characters_account ON characters(account_id);

CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL,
    slot_index INT NOT NULL CHECK (slot_index >= 0 AND slot_index <= 31),
    is_equipped BOOLEAN NOT NULL DEFAULT FALSE,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    durability INT NOT NULL DEFAULT 100,
    UNIQUE (character_id, slot_index)
);
CREATE INDEX idx_inventory_character ON inventory_items(character_id);

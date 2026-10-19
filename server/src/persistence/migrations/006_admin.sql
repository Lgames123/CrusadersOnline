-- 006_admin.sql — admin panel: moderation on accounts, world events, audit log.
ALTER TABLE accounts ADD COLUMN banned_until TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN ban_reason VARCHAR(200);
ALTER TABLE accounts ADD COLUMN muted_until TIMESTAMPTZ;

-- Rate events (XP / gold / drops / respawn multipliers) with a start and an end.
CREATE TABLE admin_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(60) NOT NULL,
    rates TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    announce BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(20) NOT NULL,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_events_ends ON admin_events(ends_at);

-- Every admin action (who, what, on whom).
CREATE TABLE admin_actions (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    admin VARCHAR(20) NOT NULL,
    action VARCHAR(32) NOT NULL,
    target VARCHAR(64),
    detail TEXT
);
CREATE INDEX idx_admin_actions_at ON admin_actions(at);

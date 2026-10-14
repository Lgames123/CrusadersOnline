-- 004_play_time.sql — the character screen's played time and last session.
ALTER TABLE characters ADD COLUMN play_seconds BIGINT NOT NULL DEFAULT 0 CHECK (play_seconds >= 0);
ALTER TABLE characters ADD COLUMN last_played_at TIMESTAMPTZ;

-- 009_skills.sql — MMO Stage 6: a character's soft skills (mining, smithing, salvaging) as XP.
ALTER TABLE characters ADD COLUMN skills JSONB NOT NULL DEFAULT '{}'::jsonb;

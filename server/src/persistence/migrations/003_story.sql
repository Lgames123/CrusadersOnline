-- 003_story.sql — story progress: triggers fired and the quest book (story.ts StoryState, JSON).
ALTER TABLE characters ADD COLUMN story TEXT NOT NULL DEFAULT '{}';

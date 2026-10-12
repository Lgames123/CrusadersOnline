-- 002_spells.sql — Drake's known spells and the selected one (spells.ts encodeSpells format).
ALTER TABLE characters ADD COLUMN spells VARCHAR(512) NOT NULL DEFAULT '';
ALTER TABLE characters ADD COLUMN selected_spell VARCHAR(32);

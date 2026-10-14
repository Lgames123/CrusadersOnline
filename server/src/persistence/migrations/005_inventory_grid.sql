-- 005_inventory_grid.sql — nullable origins preserve all legacy 0..47 slot records.
ALTER TABLE inventory_items ADD COLUMN grid_x INT CHECK (grid_x IS NULL OR (grid_x >= 0 AND grid_x <= 7));
ALTER TABLE inventory_items ADD COLUMN grid_y INT CHECK (grid_y IS NULL OR (grid_y >= 0 AND grid_y <= 5));

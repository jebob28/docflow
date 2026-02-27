DROP INDEX IF EXISTS idx_folders_sector_id;
ALTER TABLE folders DROP COLUMN IF EXISTS sector_id;

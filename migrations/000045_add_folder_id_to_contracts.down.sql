DROP INDEX IF EXISTS idx_contracts_folder_id;
ALTER TABLE contracts DROP COLUMN IF EXISTS folder_id;

-- Reverter Soft Delete (Lixeira)
ALTER TABLE documents DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE folders DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS idx_documents_deleted_at;
DROP INDEX IF EXISTS idx_folders_deleted_at;

-- Remover coluna folder_id e restrição
ALTER TABLE document_links DROP CONSTRAINT IF EXISTS check_link_target;
ALTER TABLE document_links DROP COLUMN IF EXISTS folder_id;
ALTER TABLE document_links ALTER COLUMN document_id SET NOT NULL;
DROP INDEX IF EXISTS idx_document_links_folder_id;

DROP INDEX IF EXISTS idx_documents_ocr_text;
DROP INDEX IF EXISTS idx_documents_contract_expires_at;

ALTER TABLE documents DROP COLUMN IF EXISTS ocr_text;
ALTER TABLE documents DROP COLUMN IF EXISTS ocr_processed_at;
ALTER TABLE documents DROP COLUMN IF EXISTS contract_expires_at;

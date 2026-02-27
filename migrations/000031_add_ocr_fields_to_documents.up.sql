ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_text TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_processed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS contract_expires_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_documents_contract_expires_at ON documents(contract_expires_at);
CREATE INDEX IF NOT EXISTS idx_documents_ocr_text ON documents USING GIN (to_tsvector('simple', COALESCE(ocr_text, '')));

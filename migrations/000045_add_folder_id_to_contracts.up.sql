ALTER TABLE contracts ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_folder_id ON contracts(folder_id);

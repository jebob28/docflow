ALTER TABLE folders ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_folders_sector_id ON folders(sector_id);

-- Migração para adicionar Soft Delete (Lixeira) em Documentos e Pastas
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Índices para melhorar a performance das consultas filtrando por deletados
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);
CREATE INDEX IF NOT EXISTS idx_folders_deleted_at ON folders(deleted_at);

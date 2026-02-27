-- Tabela de Setores
CREATE TABLE IF NOT EXISTS sectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
);

-- Adicionar coluna sector_id em users
ALTER TABLE users ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL;

-- Adicionar coluna sector_id em documents (Opcional, mas útil para permissões por setor)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL;

-- Índices
CREATE INDEX IF NOT EXISTS idx_sectors_tenant_id ON sectors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_sector_id ON users(sector_id);
CREATE INDEX IF NOT EXISTS idx_documents_sector_id ON documents(sector_id);

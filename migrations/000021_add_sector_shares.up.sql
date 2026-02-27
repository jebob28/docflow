-- Tabela para Compartilhamento com Setores
CREATE TABLE IF NOT EXISTS document_sector_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    permission_type VARCHAR(20) NOT NULL, -- 'READ', 'WRITE'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Garante que um setor só tenha uma regra por documento/pasta
    CONSTRAINT unique_sector_document_share UNIQUE (sector_id, document_id),
    CONSTRAINT unique_sector_folder_share UNIQUE (sector_id, folder_id),
    
    -- Garante que ou é documento ou é pasta, não ambos
    CONSTRAINT check_sector_share_target CHECK (
        (document_id IS NOT NULL AND folder_id IS NULL) OR
        (document_id IS NULL AND folder_id IS NOT NULL)
    )
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_document_sector_shares_sector_id ON document_sector_shares(sector_id);
CREATE INDEX IF NOT EXISTS idx_document_sector_shares_tenant_id ON document_sector_shares(tenant_id);

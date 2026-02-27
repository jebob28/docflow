-- Tabela para Metadados Customizados de Documentos (Campos dinâmicos para busca avançada)
CREATE TABLE IF NOT EXISTS document_metadata (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Chave e Valor do Metadado (ex: "CPF", "123.456.789-00")
    key VARCHAR(100) NOT NULL,
    value TEXT NOT NULL,
    
    -- Tipo do dado para facilitar busca e validação (ex: 'string', 'number', 'date', 'boolean')
    data_type VARCHAR(20) DEFAULT 'string',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Garante que o mesmo documento não tenha chaves duplicadas
    UNIQUE(document_id, key)
);

-- Tabela para Tags (Palavras-chave de busca rápida)
CREATE TABLE IF NOT EXISTS document_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(20) DEFAULT '#007BFF',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
);

-- Tabela de Relacionamento Documentos <-> Tags
CREATE TABLE IF NOT EXISTS document_tag_assignments (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES document_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);

-- Índices para performance de busca por metadados e tags
CREATE INDEX IF NOT EXISTS idx_metadata_key_value ON document_metadata(key, value);
CREATE INDEX IF NOT EXISTS idx_metadata_tenant_id ON document_metadata(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tags_tenant_id ON document_tags(tenant_id);

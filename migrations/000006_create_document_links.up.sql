-- Tabela para Links de Visualização Externa (Temporários)
CREATE TABLE IF NOT EXISTS document_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    
    -- Segurança e Expiração
    access_token TEXT NOT NULL UNIQUE, -- Token aleatório para a URL
    password_hash TEXT, -- Opcional: senha para acessar o link
    
    max_views INTEGER DEFAULT NULL, -- Nulo significa visualizações ilimitadas
    view_count INTEGER DEFAULT 0, -- Contador de quantas vezes foi aberto
    
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL, -- Data/Hora que o link para de funcionar
    
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índice para busca rápida de tokens válidos
CREATE INDEX IF NOT EXISTS idx_document_links_token ON document_links(access_token) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_document_links_expires_at ON document_links(expires_at);
CREATE INDEX IF NOT EXISTS idx_document_links_tenant_id ON document_links(tenant_id);

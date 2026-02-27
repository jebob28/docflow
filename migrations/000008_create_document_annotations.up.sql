-- Tabela para Anotações (Post-its Digitais) em Documentos
CREATE TABLE IF NOT EXISTS document_annotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Localização e Visualização no PDF
    page_number INTEGER NOT NULL DEFAULT 1,
    pos_x DECIMAL(10, 2) NOT NULL, -- Posição horizontal (pode ser % ou coordenadas)
    pos_y DECIMAL(10, 2) NOT NULL, -- Posição vertical
    width DECIMAL(10, 2), -- Largura do post-it
    height DECIMAL(10, 2), -- Altura do post-it
    
    -- Conteúdo do Post-it
    content TEXT NOT NULL,
    color VARCHAR(20) DEFAULT '#FFFF00', -- Amarelo padrão de post-it
    
    -- Configurações de Privacidade e Segurança
    is_private BOOLEAN DEFAULT FALSE, -- Se TRUE, apenas o criador pode ver
    is_encrypted BOOLEAN DEFAULT FALSE, -- Indica se o conteúdo do post-it foi criptografado
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_annotations_document_id ON document_annotations(document_id);
CREATE INDEX IF NOT EXISTS idx_annotations_tenant_id ON document_annotations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_annotations_user_id ON document_annotations(user_id);

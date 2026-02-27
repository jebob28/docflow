-- Alterar tabela document_links para suportar pastas
ALTER TABLE document_links ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE document_links ADD COLUMN folder_id UUID REFERENCES folders(id) ON DELETE CASCADE;

-- Adicionar restrição para garantir que ou é documento ou é pasta
ALTER TABLE document_links ADD CONSTRAINT check_link_target CHECK (
    (document_id IS NOT NULL AND folder_id IS NULL) OR
    (document_id IS NULL AND folder_id IS NOT NULL)
);

-- Índices adicionais
CREATE INDEX IF NOT EXISTS idx_document_links_folder_id ON document_links(folder_id);

-- Tabela de Relacionamento Pastas <-> Tags
CREATE TABLE IF NOT EXISTS folder_tag_assignments (
    folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES document_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_tag_assignments_folder_id ON folder_tag_assignments(folder_id);

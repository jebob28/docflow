-- Remover colunas adicionadas
ALTER TABLE documents DROP COLUMN IF EXISTS sector_id;
ALTER TABLE users DROP COLUMN IF EXISTS sector_id;

-- Remover tabela de setores
DROP TABLE IF EXISTS sectors;

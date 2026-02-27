-- Tabela de Relacionamento Usuário <-> Setor com Permissão
CREATE TABLE IF NOT EXISTS user_sectors (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    permission_type VARCHAR(20) NOT NULL DEFAULT 'VIEWER', -- 'GESTOR' or 'VIEWER'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, sector_id)
);

-- Migrar dados existentes de users.sector_id para user_sectors
INSERT INTO user_sectors (user_id, sector_id, permission_type)
SELECT id, sector_id, 'GESTOR' -- Assume GESTOR para os atuais vínculos
FROM users 
WHERE sector_id IS NOT NULL;

-- Remover coluna sector_id da tabela users (após migrar os dados)
-- ALTER TABLE users DROP COLUMN sector_id;
-- Comentado por segurança, removeremos em uma migração futura ou após verificação.

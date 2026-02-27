-- Remover constraint e coluna tenant_id
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_tenant;
ALTER TABLE users DROP COLUMN IF EXISTS tenant_id;

-- Remover tabela tenants
DROP TABLE IF EXISTS tenants;

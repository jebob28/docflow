-- Remover coluna role_id de users
ALTER TABLE users DROP COLUMN IF EXISTS role_id;

-- Remover tabelas
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;

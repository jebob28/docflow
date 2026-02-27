-- Adicionar cor do menu lateral no tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sidebar_color VARCHAR(20) DEFAULT '#ffffff';

-- Adicionar permissão MANAGE_SYSTEM
INSERT INTO permissions (name, description)
VALUES ('MANAGE_SYSTEM', 'Permissão para gerenciar configurações do sistema/tenant')
ON CONFLICT (name) DO NOTHING;

-- Vincular permissão aos papéis ADMIN e MASTER
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('ADMIN', 'MASTER') AND p.name = 'MANAGE_SYSTEM'
ON CONFLICT (role_id, permission_id) DO NOTHING;

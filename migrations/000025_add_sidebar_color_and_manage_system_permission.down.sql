-- Reverter permissão MANAGE_SYSTEM
DELETE FROM role_permissions
WHERE permission_id = (SELECT id FROM permissions WHERE name = 'MANAGE_SYSTEM');

DELETE FROM permissions WHERE name = 'MANAGE_SYSTEM';

-- Remover coluna de cor do menu lateral
ALTER TABLE tenants DROP COLUMN IF EXISTS sidebar_color;

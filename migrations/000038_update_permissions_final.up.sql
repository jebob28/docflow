-- Adicionar novas permissões se não existirem
INSERT INTO permissions (name, description) VALUES 
('MANAGE_SECTORS', 'Permissão para criar e gerenciar setores'),
('SHARE', 'Permissão para compartilhar documentos e pastas')
ON CONFLICT (name) DO NOTHING;

-- Limpar permissões atuais para redefinir conforme solicitado
DELETE FROM role_permissions;

-- 1. ADMIN (SaaS Admin): Tudo
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'ADMIN';

-- 2. MASTER (Dono do Tenant): Tudo
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'MASTER';

-- 3. GESTOR: Pode criar usuários, gerenciar documentos e ver perfil/conta
-- Permissões: READ, WRITE, DELETE, MANAGE_USERS, SHARE
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'GESTOR' AND p.name IN ('READ', 'WRITE', 'DELETE', 'MANAGE_USERS', 'SHARE');

-- 4. USER: Apenas documentos, sem usuários, setores, config ou compartilhamento
-- Permissões: READ, WRITE, DELETE
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'USER' AND p.name IN ('READ', 'WRITE', 'DELETE');

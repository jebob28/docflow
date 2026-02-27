-- Garantir que as permissões WRITE e DELETE existam
INSERT INTO permissions (name, description) 
VALUES ('WRITE', 'Permissão para criar e editar documentos'),
       ('DELETE', 'Permissão para excluir documentos')
ON CONFLICT (name) DO NOTHING;

-- Garantir que os papéis tenham as permissões corretas
-- ADMIN (Tenant Admin/SaaS Admin): Todas as permissões
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- MASTER (Dono do Tenant): Todas as permissões (exceto gerenciar outros tenants se for o caso)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'MASTER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- GESTOR: READ, WRITE, DELETE
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'GESTOR' AND p.name IN ('READ', 'WRITE', 'DELETE')
ON CONFLICT (role_id, permission_id) DO NOTHING;

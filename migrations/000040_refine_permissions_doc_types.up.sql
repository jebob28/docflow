-- Adicionar nova permissão para tipos de documentos
INSERT INTO permissions (name, description) VALUES 
('MANAGE_DOCUMENT_TYPES', 'Permissão para criar e gerenciar tipos de documentos')
ON CONFLICT (name) DO NOTHING;

-- Atribuir MANAGE_DOCUMENT_TYPES para ADMIN e MASTER
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name IN ('ADMIN', 'MASTER') AND p.name = 'MANAGE_DOCUMENT_TYPES'
ON CONFLICT DO NOTHING;

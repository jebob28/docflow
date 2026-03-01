-- Adicionar permissão de compartilhamento para o papel USER
-- Requisito: "upload de arquivo faz e compartilha arquivos menos confidencial"

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'USER' AND p.name = 'SHARE'
ON CONFLICT DO NOTHING;

-- Tabela de Roles (Papéis)
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE, -- ADMIN, MASTER, GESTOR, USER
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Permissões
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE, -- READ, WRITE, DELETE, MANAGE_USERS, MANAGE_TENANTS
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Relacionamento Role <-> Permission
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Adicionar role_id na tabela users
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id);

-- Inserir Roles Padrão
INSERT INTO roles (name, description) VALUES 
('ADMIN', 'Dono do SaaS - Acesso total a todos os tenants e configurações do sistema'),
('MASTER', 'Dono do Tenant - Acesso total aos dados e usuários do seu próprio tenant'),
('GESTOR', 'Gestor do Tenant - Pode criar, editar e atualizar documentos e pastas específicas'),
('USER', 'Usuário do Tenant - Acesso limitado conforme permissões atribuídas');

-- Inserir Permissões Padrão
INSERT INTO permissions (name, description) VALUES 
('READ', 'Permissão apenas para visualizar documentos e pastas'),
('WRITE', 'Permissão para criar e editar documentos'),
('DELETE', 'Permissão para excluir documentos'),
('MANAGE_USERS', 'Permissão para criar e gerenciar usuários dentro do tenant'),
('MANAGE_TENANTS', 'Permissão para gerenciar tenants (Exclusivo ADMIN)');

-- Vincular Permissões às Roles (Configuração inicial sugerida)
-- ADMIN: Tudo
INSERT INTO role_permissions (role_id, permission_id) 
SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'ADMIN';

-- MASTER: Tudo exceto MANAGE_TENANTS
INSERT INTO role_permissions (role_id, permission_id) 
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'MASTER' AND p.name != 'MANAGE_TENANTS';

-- GESTOR: READ, WRITE, DELETE
INSERT INTO role_permissions (role_id, permission_id) 
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'GESTOR' AND p.name IN ('READ', 'WRITE', 'DELETE');

-- USER: READ (Padrão, pode ser expandido)
INSERT INTO role_permissions (role_id, permission_id) 
SELECT r.id, p.id FROM roles r, permissions p 
WHERE r.name = 'USER' AND p.name = 'READ';

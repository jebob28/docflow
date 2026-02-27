-- Migração para suporte ao Painel Administrativo do SaaS e CRM

-- 1. Tabela de Administradores do SaaS (Donos/Funcionários do SaaS)
CREATE TABLE saas_admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    role VARCHAR(50) DEFAULT 'ADMIN', -- ADMIN, SALES, SUPPORT
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabela de Leads (CRM)
CREATE TABLE crm_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    status VARCHAR(50) DEFAULT 'NEW', -- NEW, CONTACTED, PROPOSAL, CLOSED, LOST
    source VARCHAR(100), -- ADS, INDICATION, DIRECT
    estimated_value DECIMAL(15, 2),
    notes TEXT,
    assigned_to UUID REFERENCES saas_admins(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabela de Contratos/Assinaturas (Financeiro)
CREATE TABLE tenant_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    plan_name VARCHAR(100) NOT NULL,
    storage_limit_gb INTEGER NOT NULL,
    user_limit INTEGER NOT NULL,
    monthly_price DECIMAL(15, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, CANCELLED
    start_date DATE NOT NULL,
    next_billing_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Adicionar colunas extras na tabela de tenants para controle administrativo
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ACTIVE';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- 5. Inserir o primeiro administrador (Dono)
-- Senha: Edvk4l12402@# (o hash será gerado via código, aqui colocamos um placeholder)
-- Nota: O backend deve rodar um script inicial para atualizar este hash
INSERT INTO saas_admins (email, password_hash, full_name, role) 
VALUES ('jefferson@procedere.com.br', '$2a$10$PlaceholderHashForInitialAdminPassword', 'Jefferson Tadeu', 'ADMIN')
ON CONFLICT (email) DO NOTHING;

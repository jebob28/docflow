-- Habilitar extensão para gerar UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    document VARCHAR(20) NOT NULL UNIQUE, -- CNPJ da Empresa
    
    -- Dados de Contrato / Comercial
    storage_limit_gb INTEGER NOT NULL DEFAULT 5, -- Limite de GB contratado
    contract_value DECIMAL(10,2), -- Valor do contrato
    plan_type VARCHAR(50) DEFAULT 'basic', -- Ex: basic, pro, enterprise
    
    -- Dados LGPD / Conformidade
    data_protection_officer_name VARCHAR(255), -- Nome do encarregado de dados (DPO)
    data_protection_officer_email VARCHAR(255),
    privacy_policy_accepted BOOLEAN DEFAULT FALSE,
    privacy_policy_accepted_at TIMESTAMP WITH TIME ZONE,

    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Adicionar tenant_id na tabela users
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL;

-- Criar chave estrangeira
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_tenant') THEN
        ALTER TABLE users 
        ADD CONSTRAINT fk_users_tenant 
        FOREIGN KEY (tenant_id) 
        REFERENCES tenants(id) 
        ON DELETE CASCADE;
    END IF;
END $$;

-- Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);

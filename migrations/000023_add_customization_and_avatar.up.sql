-- Adicionar colunas de personalização para o Tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_color VARCHAR(20) DEFAULT '#1a355b';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(20) DEFAULT '#f8fafc';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_settings JSONB DEFAULT '{}';

-- Adicionar coluna de avatar para o Usuário
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

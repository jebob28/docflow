-- Atualização de Perfil do Usuário
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{"email": true, "browser": true, "system": true}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_settings JSONB DEFAULT '{"two_factor": false, "session_timeout": 30}';

-- Atualização de Dados do Tenant (Conta)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS corporate_email VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS account_settings JSONB DEFAULT '{"language": "pt-BR", "timezone": "America/Sao_Paulo"}';

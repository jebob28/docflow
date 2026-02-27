-- Adicionar Campos de Segurança Avançada e Retenção na Tabela de Documentos
ALTER TABLE documents 
    ADD COLUMN IF NOT EXISTS confidentiality_level VARCHAR(50) DEFAULT 'internal', -- public, internal, confidential, top_secret
    ADD COLUMN IF NOT EXISTS integrity_hash CHAR(64), -- SHA-256 do arquivo original para validar se não foi alterado
    ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT TRUE, -- Indica se o arquivo está criptografado no MinIO
    ADD COLUMN IF NOT EXISTS encryption_key_id UUID, -- Referência para a chave de criptografia (pode ser gerada por Tenant)
    
    -- Campos de Retenção e Descarte (LGPD/Compliance)
    ADD COLUMN IF NOT EXISTS retention_period_days INTEGER, -- Quantos dias o arquivo deve ser guardado
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE, -- Data exata de expiração para descarte automático
    ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN DEFAULT FALSE, -- Se TRUE, o arquivo NÃO pode ser deletado mesmo após expirar (investigação judicial)
    
    -- Metadados de Auditoria de Acesso
    ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS last_accessed_by INTEGER REFERENCES users(id);

-- Tabela de Chaves de Criptografia por Tenant (KMS Simplificado)
-- Em um cenário real, as chaves reais ficariam em um cofre (Vault), aqui guardamos o ID e metadados.
CREATE TABLE IF NOT EXISTS tenant_encryption_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_alias VARCHAR(100) NOT NULL, -- Ex: 'main-storage-key'
    algorithm VARCHAR(50) DEFAULT 'AES-256-GCM',
    active BOOLEAN DEFAULT TRUE,
    rotated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, key_alias)
);

-- Índices para automação de descarte e segurança
CREATE INDEX IF NOT EXISTS idx_documents_expires_at ON documents(expires_at) WHERE legal_hold = FALSE;
CREATE INDEX IF NOT EXISTS idx_documents_confidentiality ON documents(confidentiality_level);
CREATE INDEX IF NOT EXISTS idx_tenant_encryption_keys_tenant ON tenant_encryption_keys(tenant_id);

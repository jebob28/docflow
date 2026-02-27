-- Reverter mudanças de segurança e retenção
ALTER TABLE documents 
    DROP COLUMN IF EXISTS confidentiality_level,
    DROP COLUMN IF EXISTS integrity_hash,
    DROP COLUMN IF EXISTS is_encrypted,
    DROP COLUMN IF EXISTS encryption_key_id,
    DROP COLUMN IF EXISTS retention_period_days,
    DROP COLUMN IF EXISTS expires_at,
    DROP COLUMN IF EXISTS legal_hold,
    DROP COLUMN IF EXISTS last_accessed_at,
    DROP COLUMN IF EXISTS last_accessed_by;

DROP TABLE IF EXISTS tenant_encryption_keys;

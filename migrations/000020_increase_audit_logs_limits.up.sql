-- Migração para aumentar o limite de caracteres nos logs de auditoria (NIST)
ALTER TABLE audit_logs 
    ALTER COLUMN action TYPE VARCHAR(255),
    ALTER COLUMN entity_id TYPE VARCHAR(255);

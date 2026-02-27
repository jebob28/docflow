-- Reverter aumento do limite de caracteres nos logs de auditoria
-- Nota: Isso pode falhar se houver dados maiores que 50 caracteres já inseridos.
ALTER TABLE audit_logs 
    ALTER COLUMN action TYPE VARCHAR(50),
    ALTER COLUMN entity_id TYPE VARCHAR(50);

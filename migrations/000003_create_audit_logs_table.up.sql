CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL para eventos GLOBAIS do sistema
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    audit_level VARCHAR(20) DEFAULT 'tenancy', -- 'tenancy' ou 'global'
    severity VARCHAR(20) DEFAULT 'info', -- 'info', 'warning', 'critical'
    action VARCHAR(50) NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    entity_id VARCHAR(50),
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices atualizados
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_level ON audit_logs(tenant_id, audit_level);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_name, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

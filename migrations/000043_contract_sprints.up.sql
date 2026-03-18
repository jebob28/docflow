CREATE TABLE IF NOT EXISTS contract_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    html_content TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_templates_tenant_id ON contract_templates(tenant_id);

CREATE TABLE IF NOT EXISTS contract_template_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    template_id UUID REFERENCES contract_templates(id) ON DELETE SET NULL,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    version_number INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_template_versions_contract ON contract_template_versions(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_template_versions_template ON contract_template_versions(template_id);

CREATE TABLE IF NOT EXISTS contract_workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    contract_type VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_workflows_tenant_id ON contract_workflows(tenant_id);

CREATE TABLE IF NOT EXISTS contract_workflow_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES contract_workflows(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    approver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approver_role VARCHAR(50),
    sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL,
    is_parallel BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_workflow_steps_workflow ON contract_workflow_steps(workflow_id);

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES contract_workflows(id) ON DELETE SET NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT false;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewal_notice_days INTEGER DEFAULT 30;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewal_period_months INTEGER DEFAULT 12;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewed_until DATE;

CREATE INDEX IF NOT EXISTS idx_contracts_workflow_id ON contracts(workflow_id);
CREATE INDEX IF NOT EXISTS idx_contracts_auto_renew ON contracts(auto_renew);

CREATE TABLE IF NOT EXISTS contract_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES contract_workflow_steps(id) ON DELETE CASCADE,
    approver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(30) DEFAULT 'PENDING',
    comments TEXT,
    decided_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_approvals_contract ON contract_approvals(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_approvals_user ON contract_approvals(approver_user_id);

CREATE TABLE IF NOT EXISTS contract_obligations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    obligation_type VARCHAR(50) DEFAULT 'GENERAL',
    due_date DATE,
    status VARCHAR(30) DEFAULT 'PENDING',
    amount DECIMAL(15, 2),
    currency VARCHAR(10) DEFAULT 'BRL',
    reminder_days INTEGER DEFAULT 15,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_obligations_contract ON contract_obligations(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_obligations_due_date ON contract_obligations(due_date);

CREATE TABLE IF NOT EXISTS contract_signatures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    signer_name VARCHAR(255),
    signer_email VARCHAR(255),
    external_id VARCHAR(255),
    signing_url TEXT,
    status VARCHAR(30) DEFAULT 'PENDING',
    signed_at TIMESTAMP WITH TIME ZONE,
    signed_hash VARCHAR(128),
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contract_signatures_contract ON contract_signatures(contract_id);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    link TEXT,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

INSERT INTO permissions (name, description) VALUES
('MANAGE_CONTRACT_TEMPLATES', 'Permissão para criar e gerenciar templates de contrato'),
('MANAGE_CONTRACT_WORKFLOWS', 'Permissão para configurar workflows de contratos'),
('APPROVE_CONTRACTS', 'Permissão para aprovar contratos'),
('MANAGE_CONTRACT_OBLIGATIONS', 'Permissão para gerenciar obrigações de contratos'),
('MANAGE_CONTRACT_SIGNATURES', 'Permissão para gerenciar assinaturas de contratos'),
('VIEW_CONTRACT_ANALYTICS', 'Permissão para visualizar analytics de contratos')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('ADMIN', 'MASTER') AND p.name IN (
    'MANAGE_CONTRACT_TEMPLATES',
    'MANAGE_CONTRACT_WORKFLOWS',
    'APPROVE_CONTRACTS',
    'MANAGE_CONTRACT_OBLIGATIONS',
    'MANAGE_CONTRACT_SIGNATURES',
    'VIEW_CONTRACT_ANALYTICS'
)
ON CONFLICT DO NOTHING;

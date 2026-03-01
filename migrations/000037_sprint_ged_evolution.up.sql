-- Migration: Create document versions and retention tables
-- 000037_sprint_ged_evolution.up.sql

-- 1. Versionamento de Documentos
CREATE TABLE IF NOT EXISTS document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    minio_key TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    change_summary TEXT,
    UNIQUE(document_id, version_number)
);

-- 2. Tabela de Temporalidade (Configuração por Tipo de Documento)
CREATE TABLE IF NOT EXISTS document_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    retention_years INTEGER DEFAULT 5, -- Tempo de guarda (ex: 5 anos)
    final_destination TEXT DEFAULT 'EXPURGO', -- EXPURGO ou PERMANENTE
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
);

-- 3. Adicionar campos ao documento original
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS current_version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS document_type_id UUID REFERENCES document_types(id),
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE', -- ACTIVE, ARCHIVED, EXPIRED, PENDING_APPROVAL
ADD COLUMN IF NOT EXISTS retention_date TIMESTAMP WITH TIME ZONE;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_doc_versions_doc_id ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_docs_retention ON documents(retention_date);

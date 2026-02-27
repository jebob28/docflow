-- Migração para adicionar campos extras nas anotações
ALTER TABLE document_annotations 
ADD COLUMN IF NOT EXISTS font_family VARCHAR(50) DEFAULT 'Inter',
ADD COLUMN IF NOT EXISTS annotation_type VARCHAR(20) DEFAULT 'post-it';

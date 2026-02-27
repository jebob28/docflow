-- Migração para remover campos extras nas anotações
ALTER TABLE document_annotations 
DROP COLUMN IF EXISTS font_family,
DROP COLUMN IF EXISTS annotation_type;

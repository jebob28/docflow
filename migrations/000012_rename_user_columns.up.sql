-- Renomear colunas na tabela users para consistência com o painel administrativo
ALTER TABLE users RENAME COLUMN username TO full_name;
ALTER TABLE users RENAME COLUMN active TO is_active;

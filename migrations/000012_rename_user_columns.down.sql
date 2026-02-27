-- Reverter renomeação de colunas na tabela users
ALTER TABLE users RENAME COLUMN full_name TO username;
ALTER TABLE users RENAME COLUMN is_active TO active;

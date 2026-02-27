ALTER TABLE tenants ADD COLUMN IF NOT EXISTS confidential_password_hash TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS confidential_required BOOLEAN DEFAULT FALSE;

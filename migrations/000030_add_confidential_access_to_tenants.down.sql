ALTER TABLE tenants DROP COLUMN IF EXISTS confidential_password_hash;
ALTER TABLE tenants DROP COLUMN IF EXISTS confidential_required;

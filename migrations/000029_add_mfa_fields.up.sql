ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMP WITH TIME ZONE;
UPDATE users SET security_settings = jsonb_set(COALESCE(security_settings, '{}'::jsonb), '{two_factor}', to_jsonb(COALESCE(mfa_enabled, false)), true);

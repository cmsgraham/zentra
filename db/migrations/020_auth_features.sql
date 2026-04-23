-- Migration 020: auth features (email verification, TOTP 2FA, Google OAuth)

-- Email verification: null = unverified. Soft enforcement in app.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- 6-digit code + expiry. Code is stored as SHA-256 hash (hex) so it's never
-- plaintext at rest. Consumed/cleared on successful verification.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

-- TOTP 2FA. Secret stored encrypted (AES-256-GCM, key derived from JWT_SECRET).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;

-- One-time recovery codes for 2FA. Each stored as bcrypt hash. JSONB array.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Google OAuth linkage. One Google account -> one user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;

-- password_hash becomes nullable so a user can exist with Google only.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;

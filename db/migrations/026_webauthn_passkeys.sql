-- 026_webauthn_passkeys.sql
-- Stores WebAuthn / Passkey credentials registered by users.
-- Enables Face ID / Touch ID / Windows Hello / hardware key sign-in.

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The credential ID returned by the authenticator. Base64url-encoded string.
  credential_id   TEXT NOT NULL UNIQUE,
  -- The COSE-encoded public key, base64url-encoded.
  public_key      TEXT NOT NULL,
  -- Signature counter for replay-attack detection.
  counter         BIGINT NOT NULL DEFAULT 0,
  -- Comma-separated transports hint (e.g. "internal,hybrid"). Optional.
  transports      TEXT,
  -- Whether this credential lives on a platform authenticator (Face ID, Touch ID,
  -- Windows Hello) or a roaming one (hardware key, phone via QR).
  device_type     TEXT NOT NULL DEFAULT 'platform' CHECK (device_type IN ('platform','cross-platform')),
  -- Backed-up / synced flag (e.g. iCloud Keychain, Google Password Manager).
  backed_up       BOOLEAN NOT NULL DEFAULT false,
  -- Friendly label the user can edit ("iPhone 15", "Work laptop").
  nickname        TEXT NOT NULL DEFAULT 'Passkey',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user
  ON webauthn_credentials(user_id);

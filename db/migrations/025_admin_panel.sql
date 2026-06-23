-- Migration 025: Admin panel foundation
-- Adds platform-level role + status to users, audit log, login attempts,
-- feature flags, and broadcasts. Privacy-first: admins never see user content
-- (intentions, echoes, spaces, notes). Only counts and metadata.

-- Platform-level role (separate from per-workspace role).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_role') THEN
    CREATE TYPE platform_role AS ENUM ('user', 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role platform_role NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS status user_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'email', -- 'email' | 'google'
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role) WHERE role <> 'user';
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);

-- Audit log of admin actions
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_email  TEXT NOT NULL,
  action       TEXT NOT NULL,        -- e.g. 'user.suspend', 'user.delete', 'flag.set'
  target_type  TEXT,                 -- 'user' | 'workspace' | 'flag' | 'broadcast'
  target_id    TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log (created_at DESC);

-- Login attempts (success + failure) for security dashboard
CREATE TABLE IF NOT EXISTS login_attempts (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  success     BOOLEAN NOT NULL,
  provider    TEXT NOT NULL,         -- 'email' | 'google'
  failure_reason TEXT,                -- 'invalid_password' | 'no_user' | 'locked' | 'oauth_error'
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_success ON login_attempts (success, created_at DESC);

-- Feature flags (server-side kill switches and rollouts)
CREATE TABLE IF NOT EXISTS feature_flags (
  key         TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  rollout_pct INT NOT NULL DEFAULT 0 CHECK (rollout_pct >= 0 AND rollout_pct <= 100),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Broadcasts (in-app announcements)
CREATE TABLE IF NOT EXISTS broadcasts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info', -- 'info' | 'warning' | 'critical'
  active      BOOLEAN NOT NULL DEFAULT true,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_active ON broadcasts (active, starts_at DESC);

-- Track per-user broadcast dismissals
CREATE TABLE IF NOT EXISTS broadcast_reads (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, broadcast_id)
);

-- AI usage tracking (token counts, no prompt content)
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  feature     TEXT NOT NULL,         -- 'import-text' | 'import-image' | 'suggestions' | etc.
  model       TEXT,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  ok          BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON ai_usage_events (feature, created_at DESC);

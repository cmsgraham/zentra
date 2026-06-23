-- 030_huddle_shares.sql
-- Public, link-based sharing of a closed huddle's summary (decisions, intentions,
-- follow-ups, notes). The host generates a token; anyone with the link can view
-- a read-only summary at /huddles/share/:token. Tokens can be revoked.

CREATE TABLE IF NOT EXISTS huddle_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_huddle_shares_huddle
  ON huddle_shares(huddle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_huddle_shares_token
  ON huddle_shares(token)
  WHERE revoked_at IS NULL;

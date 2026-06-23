-- Migration 021: support tickets
-- Lets a signed-in user open a ticket from inside Zentra. Staff can later
-- update status/response out-of-band. Kept deliberately minimal.

CREATE TABLE IF NOT EXISTS support_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,              -- 'question' | 'bug' | 'feedback' | 'account' | 'other'
  subject       TEXT NOT NULL,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open', -- 'open' | 'in_progress' | 'resolved' | 'closed'
  priority      TEXT NOT NULL DEFAULT 'normal', -- 'low' | 'normal' | 'high'
  user_agent    TEXT,
  app_url       TEXT,
  staff_response TEXT,
  responded_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status  ON support_tickets (status, created_at DESC);

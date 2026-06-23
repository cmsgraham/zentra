-- Monthly planning: tag spaces to roll up + lightweight income/deduction entries.

ALTER TABLE budget_spaces
  ADD COLUMN IF NOT EXISTS include_in_monthly BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS monthly_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  kind TEXT NOT NULL CHECK (kind IN ('income', 'deduction')),
  label TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  recurring BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monthly_entries_user_period
  ON monthly_entries (user_id, year, month);

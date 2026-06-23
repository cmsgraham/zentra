-- Monthly budget snapshots: an end-of-month freeze of the user's monthly
-- planning page for reporting purposes. Stores the summary plus a JSON
-- payload of entries and spaces as they existed at snapshot time.
CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  income_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction_total   NUMERIC(14,2) NOT NULL DEFAULT 0,
  expense_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
  leftover          NUMERIC(14,2) NOT NULL DEFAULT 0,
  payload       JSONB NOT NULL,
  auto          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_user_period
  ON monthly_snapshots (user_id, year DESC, month DESC, created_at DESC);

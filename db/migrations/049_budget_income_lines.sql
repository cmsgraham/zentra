-- Budget: income as a first-class line type inside a period.
-- planned_expenses now holds both expenses and income; `kind` distinguishes them.
-- Income lines: kind = 'income' (paid = received). Net of a period = income - expenses.

ALTER TABLE planned_expenses
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'expense'
    CHECK (kind IN ('expense', 'income'));

CREATE INDEX IF NOT EXISTS idx_planned_expenses_period_kind
  ON planned_expenses (period_id, kind);

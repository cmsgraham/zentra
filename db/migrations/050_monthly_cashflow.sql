-- Monthly cash-flow control per quincena (half-month pay period).
--
-- pay_period on monthly_entries: which quincena a given income/deduction hits
--   the bank. 1 = first quincena, 2 = second quincena, NULL = spans both
--   (split evenly across the two halves for the per-quincena cash-flow view).
--   Existing rows default to NULL so monthly totals are unchanged.
ALTER TABLE monthly_entries
  ADD COLUMN IF NOT EXISTS pay_period SMALLINT NULL CHECK (pay_period IN (1, 2));

-- Actual bank balances the user reconciles against the expected (computed)
-- balance, so any drift between planned and real cash is visible per quincena.
--   opening_balance: cash in the bank before the first quincena of the month.
--   actual_q1 / actual_q2: real bank balance observed at the end of each half.
CREATE TABLE IF NOT EXISTS monthly_cashflow (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  opening_balance NUMERIC(14, 2),
  actual_q1 NUMERIC(14, 2),
  actual_q2 NUMERIC(14, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year, month)
);

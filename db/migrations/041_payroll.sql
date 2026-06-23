-- Payroll deductions library.
-- Per-user catalog of reusable deductions that can be applied to a gross amount
-- to produce a net paycheck. Supports three kinds:
--   percentage  -> rate (e.g. 0.0983 = 9.83% of gross)
--   fixed       -> amount (flat colones)
--   progressive -> brackets (marginal tax table, JSONB)
--
-- brackets shape:
--   [{ "min": 0,        "max": 918000,  "rate": 0 },
--    { "min": 918000,   "max": 1347000, "rate": 0.10 },
--    { "min": 1347000,  "max": 2364000, "rate": 0.15 },
--    { "min": 2364000,  "max": 4727000, "rate": 0.20 },
--    { "min": 4727000,  "max": null,    "rate": 0.25 }]
-- max=null means "and up".

CREATE TABLE IF NOT EXISTS payroll_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percentage', 'fixed', 'progressive')),
  rate NUMERIC(8, 6),
  amount NUMERIC(14, 2),
  brackets JSONB,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payroll_deductions_kind_fields CHECK (
    (kind = 'percentage'  AND rate IS NOT NULL) OR
    (kind = 'fixed'       AND amount IS NOT NULL) OR
    (kind = 'progressive' AND brackets IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_payroll_deductions_user
  ON payroll_deductions (user_id, sort_order, lower(name));

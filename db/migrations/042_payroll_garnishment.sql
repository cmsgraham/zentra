-- Adds a 'garnishment' deduction kind for Costa Rica salary garnishment
-- (Embargo Judicial). Garnishment is computed on NET salary (gross minus
-- non-garnishment deductions like CCSS + Renta), then applied as tiered
-- bands relative to a minimum non-garnishable salary.
--
-- config shape for kind='garnishment':
--   {
--     "minimumSalary": 268731.31,
--     "protectedMultiplier": 1,     -- 0% band ends at min * this
--     "upperMultiplier": 4,         -- mid band ends at min * this
--     "midRate": 0.125,             -- garnishable rate inside mid band
--     "topRate": 0.25               -- garnishable rate above upper band
--   }

ALTER TABLE payroll_deductions
  ADD COLUMN IF NOT EXISTS config JSONB;

ALTER TABLE payroll_deductions
  DROP CONSTRAINT IF EXISTS payroll_deductions_kind_check;

ALTER TABLE payroll_deductions
  ADD CONSTRAINT payroll_deductions_kind_check
  CHECK (kind IN ('percentage', 'fixed', 'progressive', 'garnishment'));

ALTER TABLE payroll_deductions
  DROP CONSTRAINT IF EXISTS payroll_deductions_kind_fields;

ALTER TABLE payroll_deductions
  ADD CONSTRAINT payroll_deductions_kind_fields CHECK (
    (kind = 'percentage'  AND rate IS NOT NULL) OR
    (kind = 'fixed'       AND amount IS NOT NULL) OR
    (kind = 'progressive' AND brackets IS NOT NULL) OR
    (kind = 'garnishment' AND config IS NOT NULL)
  );

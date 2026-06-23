-- Link monthly_entries to a library deduction so the amount can be
-- recomputed against the current month's income instead of stored statically.

ALTER TABLE monthly_entries
  ADD COLUMN IF NOT EXISTS library_deduction_id UUID
  REFERENCES payroll_deductions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_monthly_entries_library_deduction
  ON monthly_entries (library_deduction_id)
  WHERE library_deduction_id IS NOT NULL;

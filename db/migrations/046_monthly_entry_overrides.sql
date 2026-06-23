-- Monthly planning: per-entry flags to control deduction math.
--
-- subject_to_deductions: for income entries, whether they should be included in
--   the gross used to compute library-linked deductions (percentage, progressive,
--   garnishment base). Defaults to true so existing rows keep current behaviour.
--   Bank deposits and other non-payroll income can be flipped to false.
--
-- amount_overridden: for deduction entries linked to a library deduction, marks
--   the amount as manually set by the user. When true, the monthly endpoint
--   stops recomputing the value on every GET so edits persist.

ALTER TABLE monthly_entries
  ADD COLUMN IF NOT EXISTS subject_to_deductions BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE monthly_entries
  ADD COLUMN IF NOT EXISTS amount_overridden BOOLEAN NOT NULL DEFAULT false;

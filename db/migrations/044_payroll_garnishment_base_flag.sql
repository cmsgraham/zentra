-- 044: Track which deductions reduce the judicial-garnishment base.
-- Only statutory deductions (CCSS, Operadora de Pensiones, Impuesto de Renta)
-- should reduce the net salary used to compute embargo judicial.

ALTER TABLE payroll_deductions
  ADD COLUMN IF NOT EXISTS affects_garnishment_base BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: mark known statutory rows for existing users.
UPDATE payroll_deductions
   SET affects_garnishment_base = TRUE
 WHERE kind <> 'garnishment'
   AND (
        lower(name) LIKE '%ccss%'
     OR lower(name) LIKE '%oper%pen%'
     OR lower(name) LIKE '%renta%'
   );

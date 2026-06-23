DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'budget_spaces'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%cadence%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE budget_spaces DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE budget_spaces
  ADD CONSTRAINT budget_spaces_cadence_check
  CHECK (cadence IN ('monthly', 'semi_monthly', 'none'));
-- Zentra Budget MVP schema
-- Calm, list-first model: spaces, periods, reusable expense library, and period items.

CREATE TABLE IF NOT EXISTS budget_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'semi_monthly' CHECK (cadence IN ('monthly', 'semi_monthly', 'none')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budget_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES budget_spaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  period_index INTEGER NULL CHECK (period_index IN (1, 2)),
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);

CREATE TABLE IF NOT EXISTS expense_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES budget_spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  default_amount NUMERIC(12, 2) NOT NULL CHECK (default_amount >= 0),
  recurrence TEXT NOT NULL DEFAULT 'manual' CHECK (recurrence IN ('monthly', 'weekly', 'biweekly', 'manual')),
  default_period_slot TEXT NOT NULL DEFAULT 'manual' CHECK (default_period_slot IN ('first', 'second', 'both', 'manual')),
  due_day INTEGER NULL CHECK (due_day BETWEEN 1 AND 31),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planned_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE,
  template_id UUID NULL REFERENCES expense_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  paid BOOLEAN NOT NULL DEFAULT false,
  entry_type TEXT NOT NULL DEFAULT 'planned' CHECK (entry_type IN ('planned', 'unplanned')),
  due_day INTEGER NULL CHECK (due_day BETWEEN 1 AND 31),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_spaces_owner ON budget_spaces(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_budget_periods_space ON budget_periods(space_id);
CREATE INDEX IF NOT EXISTS idx_budget_periods_current ON budget_periods(space_id, is_current);
CREATE INDEX IF NOT EXISTS idx_budget_periods_lookup ON budget_periods(space_id, year, month, period_index);
CREATE INDEX IF NOT EXISTS idx_expense_templates_space ON expense_templates(space_id, active);
CREATE INDEX IF NOT EXISTS idx_planned_expenses_period ON planned_expenses(period_id, entry_type, paid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_period_unique_slot
  ON budget_periods(space_id, year, month, period_index)
  WHERE period_index IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_period_unique_monthly
  ON budget_periods(space_id, year, month)
  WHERE period_index IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_period_current_per_space
  ON budget_periods(space_id)
  WHERE is_current = true;

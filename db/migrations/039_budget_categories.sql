-- Persistent subsections (categories) for budget spaces.
-- Each space owns an ordered list of category names.
-- Templates and period items carry an optional category (free-text, soft-linked by name).

CREATE TABLE IF NOT EXISTS budget_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES budget_spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_budget_categories_space_name UNIQUE (space_id, name)
);

CREATE INDEX IF NOT EXISTS idx_budget_categories_space ON budget_categories(space_id, sort_order);

ALTER TABLE expense_templates
  ADD COLUMN IF NOT EXISTS category TEXT NULL;

ALTER TABLE planned_expenses
  ADD COLUMN IF NOT EXISTS category TEXT NULL;

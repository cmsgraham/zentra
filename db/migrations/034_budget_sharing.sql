-- Budget space sharing
-- Mirrors shopping list sharing: owners can add friend editors; editors can work inside the shared space.

CREATE TABLE IF NOT EXISTS budget_space_members (
  space_id UUID NOT NULL REFERENCES budget_spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_space_members_user ON budget_space_members(user_id);

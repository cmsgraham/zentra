-- Planner layout preferences per user
-- Stores widget order, visibility, and size overrides as a JSON blob  
CREATE TABLE IF NOT EXISTS planner_layouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layout_data JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_planner_layout_user UNIQUE (user_id)
);

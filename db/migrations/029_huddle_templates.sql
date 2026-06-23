-- 029_huddle_templates.sql
-- Reusable presets for recurring huddles.
-- A template captures a name, type, default title/intention, default participants,
-- and a default agenda (topics). Used to start a fresh huddle with one click.

CREATE TABLE IF NOT EXISTS huddle_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('team', 'personal')),
  default_title TEXT NOT NULL,
  default_intention TEXT,
  default_participant_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_huddle_templates_owner
  ON huddle_templates(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_huddle_templates_workspace
  ON huddle_templates(workspace_id, created_at DESC);

-- 015_zentra_core.sql
-- Adds Zentra anti-procrastination data model on top of existing inkflow schema

-- ─────────────────────────────────────────────
-- A. Extend tasks with next_action + priority
-- ─────────────────────────────────────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS next_action TEXT,
  ADD COLUMN IF NOT EXISTS next_action_state TEXT
    NOT NULL DEFAULT 'unclear'
    CHECK (next_action_state IN ('unclear', 'set', 'done')),
  ADD COLUMN IF NOT EXISTS priority_for_date DATE,
  ADD COLUMN IF NOT EXISTS priority_for_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_priority_for
  ON tasks(priority_for_user_id, priority_for_date)
  WHERE priority_for_date IS NOT NULL;

-- Enforce one priority per user per day
CREATE UNIQUE INDEX IF NOT EXISTS uniq_priority_per_user_per_day
  ON tasks(priority_for_user_id, priority_for_date)
  WHERE priority_for_date IS NOT NULL;

-- ─────────────────────────────────────────────
-- B. Focus sessions
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS focus_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  next_action_snapshot TEXT,
  planned_minutes INT NOT NULL DEFAULT 25 CHECK (planned_minutes IN (15, 25, 50)),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN ('completed', 'abandoned', 'extended', NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_started
  ON focus_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_task
  ON focus_sessions(task_id);

-- ─────────────────────────────────────────────
-- C. Stuck events
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stuck_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  resolved_by TEXT CHECK (resolved_by IN ('broke_it_down', 'changed_task', 'took_a_break', 'just_started', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_stuck_events_user ON stuck_events(user_id, created_at DESC);

-- ─────────────────────────────────────────────
-- D. Reflections
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reflection_date DATE NOT NULL,
  completed_count INT NOT NULL DEFAULT 0,
  avoided_text TEXT,
  feeling_text TEXT,
  tomorrow_priority_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  tomorrow_priority_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, reflection_date)
);
CREATE INDEX IF NOT EXISTS idx_reflections_user_date
  ON reflections(user_id, reflection_date DESC);

-- ─────────────────────────────────────────────
-- E. AI decomposition cache
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_decompositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  input_text TEXT NOT NULL,
  micro_steps JSONB NOT NULL,
  model_used TEXT NOT NULL,
  tokens_used INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_decomp_user ON ai_decompositions(user_id, created_at DESC);

-- ─────────────────────────────────────────────
-- F. Zentra user preferences + onboarding flag
-- ─────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS zentra_dnd_start TIME,
  ADD COLUMN IF NOT EXISTS zentra_dnd_end TIME,
  ADD COLUMN IF NOT EXISTS zentra_default_session_minutes INT DEFAULT 25
    CHECK (zentra_default_session_minutes IN (15, 25, 50)),
  ADD COLUMN IF NOT EXISTS zentra_end_of_day_time TIME DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS zentra_ai_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zentra_plus_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

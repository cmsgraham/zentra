-- Migration 002: Appointments, Daily Planner, Calendar support

-- New enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
    CREATE TYPE appointment_status AS ENUM ('scheduled', 'cancelled', 'completed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_goal_status') THEN
    CREATE TYPE plan_goal_status AS ENUM ('pending', 'done', 'skipped');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'followup_type') THEN
    CREATE TYPE followup_type AS ENUM ('call', 'email', 'followup', 'other');
  END IF;
END $$;

-- ============================================================
-- Appointments
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  location TEXT,
  notes TEXT,
  status appointment_status NOT NULL DEFAULT 'scheduled',
  color TEXT,
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT appointments_ends_after_starts
    CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS idx_appointments_owner_starts
  ON appointments(owner_user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_workspace_starts
  ON appointments(workspace_id, starts_at) WHERE workspace_id IS NOT NULL;

-- ============================================================
-- Daily Plans
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  mood TEXT,
  reminder_text TEXT,
  top_priority_text TEXT,
  notes TEXT,
  reflection TEXT,
  tomorrow_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniqueness: one plan per user per workspace per date
-- Need two indexes because NULL != NULL in SQL unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_plans_user_ws_date
  ON daily_plans(user_id, workspace_id, plan_date) WHERE workspace_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_plans_user_date_personal
  ON daily_plans(user_id, plan_date) WHERE workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_plans_user_date
  ON daily_plans(user_id, plan_date);

-- ============================================================
-- Daily Plan Goals
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_plan_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status plan_goal_status NOT NULL DEFAULT 'pending',
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_plan_goals_plan
  ON daily_plan_goals(daily_plan_id, sort_order);

-- ============================================================
-- Daily Plan Follow-ups
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_plan_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type followup_type NOT NULL DEFAULT 'other',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_plan_followups_plan
  ON daily_plan_followups(daily_plan_id, sort_order);

-- ============================================================
-- updated_at triggers for new tables
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_appointments_updated_at') THEN
    CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON appointments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_daily_plans_updated_at') THEN
    CREATE TRIGGER trg_daily_plans_updated_at BEFORE UPDATE ON daily_plans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_daily_plan_goals_updated_at') THEN
    CREATE TRIGGER trg_daily_plan_goals_updated_at BEFORE UPDATE ON daily_plan_goals
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_daily_plan_followups_updated_at') THEN
    CREATE TRIGGER trg_daily_plan_followups_updated_at BEFORE UPDATE ON daily_plan_followups
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

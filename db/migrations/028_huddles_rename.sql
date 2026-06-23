-- 028_huddles_rename.sql
-- Rename "Flows" module → "Huddles" to remove confusion with the existing
-- Flow (today/focus) concept. Idempotent: safe on fresh DBs (027 may not have
-- run, in which case nothing happens) and on prod where 027 already created
-- the flows.* tables.

-- ─────────────────────────────────────────────
-- A. Rename tables
-- ─────────────────────────────────────────────
ALTER TABLE IF EXISTS flows              RENAME TO huddles;
ALTER TABLE IF EXISTS flow_participants  RENAME TO huddle_participants;
ALTER TABLE IF EXISTS flow_signals       RENAME TO huddle_signals;
ALTER TABLE IF EXISTS flow_topics        RENAME TO huddle_topics;
ALTER TABLE IF EXISTS flow_decisions     RENAME TO huddle_decisions;
ALTER TABLE IF EXISTS flow_intentions    RENAME TO huddle_intentions;
ALTER TABLE IF EXISTS flow_followups     RENAME TO huddle_followups;
ALTER TABLE IF EXISTS flow_notes         RENAME TO huddle_notes;

-- ─────────────────────────────────────────────
-- B. Rename FK columns
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'huddle_participants' AND column_name = 'flow_id') THEN
    ALTER TABLE huddle_participants RENAME COLUMN flow_id TO huddle_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'huddle_signals' AND column_name = 'flow_id') THEN
    ALTER TABLE huddle_signals RENAME COLUMN flow_id TO huddle_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'huddle_topics' AND column_name = 'flow_id') THEN
    ALTER TABLE huddle_topics RENAME COLUMN flow_id TO huddle_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'huddle_decisions' AND column_name = 'flow_topic_id') THEN
    ALTER TABLE huddle_decisions RENAME COLUMN flow_topic_id TO huddle_topic_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'huddle_intentions' AND column_name = 'flow_id') THEN
    ALTER TABLE huddle_intentions RENAME COLUMN flow_id TO huddle_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'huddle_followups' AND column_name = 'flow_id') THEN
    ALTER TABLE huddle_followups RENAME COLUMN flow_id TO huddle_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'huddle_followups' AND column_name = 'carried_from_flow_id') THEN
    ALTER TABLE huddle_followups RENAME COLUMN carried_from_flow_id TO carried_from_huddle_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'huddle_notes' AND column_name = 'flow_id') THEN
    ALTER TABLE huddle_notes RENAME COLUMN flow_id TO huddle_id;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- C. Rename indexes (best-effort; PG auto-renames most when table renames)
-- ─────────────────────────────────────────────
ALTER INDEX IF EXISTS idx_flows_workspace          RENAME TO idx_huddles_workspace;
ALTER INDEX IF EXISTS idx_flows_host               RENAME TO idx_huddles_host;
ALTER INDEX IF EXISTS idx_flow_participants_user   RENAME TO idx_huddle_participants_user;
ALTER INDEX IF EXISTS idx_flow_signals_flow        RENAME TO idx_huddle_signals_huddle;
ALTER INDEX IF EXISTS idx_flow_topics_flow         RENAME TO idx_huddle_topics_huddle;
ALTER INDEX IF EXISTS idx_flow_decisions_topic     RENAME TO idx_huddle_decisions_topic;
ALTER INDEX IF EXISTS idx_flow_intentions_flow     RENAME TO idx_huddle_intentions_huddle;
ALTER INDEX IF EXISTS idx_flow_intentions_owner    RENAME TO idx_huddle_intentions_owner;
ALTER INDEX IF EXISTS idx_flow_followups_flow      RENAME TO idx_huddle_followups_huddle;
ALTER INDEX IF EXISTS idx_flow_followups_owner     RENAME TO idx_huddle_followups_owner;
ALTER INDEX IF EXISTS idx_flow_notes_flow          RENAME TO idx_huddle_notes_huddle;

-- ─────────────────────────────────────────────
-- D. Fresh-install safety net: if 027 never ran (e.g. clean DB applying 028
-- before/after a future merged migration), create the tables under the new
-- names. All idempotent.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS huddles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('team', 'personal')),
  title TEXT NOT NULL,
  intention TEXT,
  host_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddles_workspace ON huddles(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_huddles_host ON huddles(host_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS huddle_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('host', 'participant')),
  attendance_status TEXT NOT NULL DEFAULT 'invited'
    CHECK (attendance_status IN ('invited', 'present', 'late', 'virtual', 'excused')),
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (huddle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_huddle_participants_user ON huddle_participants(user_id);

CREATE TABLE IF NOT EXISTS huddle_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  why_it_matters TEXT,
  promoted_to_topic BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddle_signals_huddle ON huddle_signals(huddle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS huddle_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  context TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided', 'parked')),
  source_signal_id UUID REFERENCES huddle_signals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddle_topics_huddle ON huddle_topics(huddle_id, sort_order);

CREATE TABLE IF NOT EXISTS huddle_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_topic_id UUID NOT NULL REFERENCES huddle_topics(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  decision_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddle_decisions_topic ON huddle_decisions(huddle_topic_id);

CREATE TABLE IF NOT EXISTS huddle_intentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  soft_due_text TEXT,
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddle_intentions_huddle ON huddle_intentions(huddle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_huddle_intentions_owner ON huddle_intentions(owner_user_id, status);

CREATE TABLE IF NOT EXISTS huddle_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'carried_forward')),
  carried_from_huddle_id UUID REFERENCES huddles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddle_followups_huddle ON huddle_followups(huddle_id);
CREATE INDEX IF NOT EXISTS idx_huddle_followups_owner ON huddle_followups(owner_user_id, status);

CREATE TABLE IF NOT EXISTS huddle_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddle_notes_huddle ON huddle_notes(huddle_id, created_at DESC);

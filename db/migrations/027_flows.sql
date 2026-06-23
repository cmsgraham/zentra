-- 027_flows.sql
-- Zentra Flows: structured conversations that turn discussion into progress.
-- Replaces traditional "meetings". Two types: team & personal.

-- ─────────────────────────────────────────────
-- A. Flows (the session itself)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flows (
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
CREATE INDEX IF NOT EXISTS idx_flows_workspace ON flows(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flows_host ON flows(host_user_id, created_at DESC);

-- ─────────────────────────────────────────────
-- B. Participants
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('host', 'participant')),
  attendance_status TEXT NOT NULL DEFAULT 'invited'
    CHECK (attendance_status IN ('invited', 'present', 'late', 'virtual', 'excused')),
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flow_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_flow_participants_user ON flow_participants(user_id);

-- ─────────────────────────────────────────────
-- C. Signals (quick updates / status before discussion)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  why_it_matters TEXT,
  promoted_to_topic BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_signals_flow ON flow_signals(flow_id, created_at DESC);

-- ─────────────────────────────────────────────
-- D. Topics (focus discussion items)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  context TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided', 'parked')),
  source_signal_id UUID REFERENCES flow_signals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_topics_flow ON flow_topics(flow_id, sort_order);

-- ─────────────────────────────────────────────
-- E. Decisions (outcomes from topics)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_topic_id UUID NOT NULL REFERENCES flow_topics(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  decision_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_decisions_topic ON flow_decisions(flow_topic_id);

-- ─────────────────────────────────────────────
-- F. Intentions (next steps; convertible to tasks)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_intentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  soft_due_text TEXT,
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_intentions_flow ON flow_intentions(flow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_intentions_owner ON flow_intentions(owner_user_id, status);

-- ─────────────────────────────────────────────
-- G. Follow-ups (carry-forward items)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'carried_forward')),
  carried_from_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_followups_flow ON flow_followups(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_followups_owner ON flow_followups(owner_user_id, status);

-- ─────────────────────────────────────────────
-- H. Notes (free-form during the flow)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_notes_flow ON flow_notes(flow_id, created_at DESC);

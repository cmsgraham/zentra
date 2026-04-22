-- Task segments: breaking large tasks into schedulable work units
CREATE TABLE IF NOT EXISTS task_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sequence_number SMALLINT NOT NULL,
  total_segments SMALLINT NOT NULL,
  estimated_minutes INTEGER,
  status task_status NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(parent_task_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_task_segments_parent ON task_segments(parent_task_id);

-- Flag on parent tasks so queries can quickly filter
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS has_segments BOOLEAN NOT NULL DEFAULT false;

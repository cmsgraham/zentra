-- Migration 003: Task status history tracking

CREATE TABLE IF NOT EXISTS task_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  old_status task_status,
  new_status task_status NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_status_history_task
  ON task_status_history(task_id, changed_at);

-- Seed initial history row for every existing task
INSERT INTO task_status_history (task_id, old_status, new_status, changed_at)
  SELECT id, NULL, status, created_at FROM tasks
  ON CONFLICT DO NOTHING;

-- Trigger function: auto-log status changes
CREATE OR REPLACE FUNCTION log_task_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO task_status_history (task_id, old_status, new_status, changed_at)
    VALUES (NEW.id, OLD.status, NEW.status, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_status_history') THEN
    CREATE TRIGGER trg_task_status_history
      AFTER UPDATE ON tasks
      FOR EACH ROW
      EXECUTE FUNCTION log_task_status_change();
  END IF;
END $$;

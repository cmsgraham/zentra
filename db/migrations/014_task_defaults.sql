ALTER TABLE users ADD COLUMN IF NOT EXISTS task_default_priority TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE users ADD COLUMN IF NOT EXISTS task_default_complexity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS task_default_estimated_minutes INTEGER;

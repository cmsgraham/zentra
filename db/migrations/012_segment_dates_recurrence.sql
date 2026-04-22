-- Add due_date to task segments so each part can be scheduled on a specific day
ALTER TABLE task_segments ADD COLUMN IF NOT EXISTS due_date DATE;

-- Add recurrence columns to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_type TEXT;        -- 'daily', 'weekly', 'monthly'
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_interval SMALLINT DEFAULT 1;  -- every N units
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_end_date DATE;    -- optional end date (null = forever)

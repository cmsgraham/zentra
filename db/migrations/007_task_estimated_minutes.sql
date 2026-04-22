-- Add estimated_minutes column to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;

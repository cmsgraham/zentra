-- 016_brain_dump.sql
-- Adds brain_dump scratch field to tasks for in-session note-taking

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS brain_dump TEXT;

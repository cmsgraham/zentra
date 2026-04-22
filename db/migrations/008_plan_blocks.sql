-- Add plan_blocks JSONB column to daily_plans to persist AI-generated time blocks
ALTER TABLE daily_plans ADD COLUMN IF NOT EXISTS plan_blocks JSONB DEFAULT NULL;

COMMENT ON COLUMN daily_plans.plan_blocks IS 'AI-generated time-blocked plan stored as JSON array of {start, end, type, tasks[]}';

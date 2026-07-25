-- 051_huddle_signal_intention_sort_order.sql
-- Adds sort_order to huddle_signals and huddle_intentions so users can
-- drag-to-reorder cards within a huddle column (topics already had this).

ALTER TABLE huddle_signals    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE huddle_intentions ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- Backfill existing rows to their current creation order per huddle.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY huddle_id ORDER BY created_at ASC) - 1 AS rn
  FROM huddle_signals
)
UPDATE huddle_signals s SET sort_order = ranked.rn
FROM ranked WHERE ranked.id = s.id;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY huddle_id ORDER BY created_at ASC) - 1 AS rn
  FROM huddle_intentions
)
UPDATE huddle_intentions i SET sort_order = ranked.rn
FROM ranked WHERE ranked.id = i.id;

CREATE INDEX IF NOT EXISTS idx_huddle_signals_sort ON huddle_signals(huddle_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_huddle_intentions_sort ON huddle_intentions(huddle_id, sort_order);

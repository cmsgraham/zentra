-- 053_huddle_intention_task_link.sql
-- Action items belong in the task tracker, with the huddle holding only a
-- reference. Two additions make that possible:
--
--   topic_id  — ties an action item back to the discussion that produced it,
--               so a series report can trace outcomes to topics. Nullable:
--               freestanding "quick" intentions with no topic stay valid.
--   due_date  — a real date. soft_due_text is freeform ("by Friday") and could
--               never be mapped onto tasks.due_date, so due dates were lost the
--               moment an action item became a task. soft_due_text is kept for
--               display of existing rows; new UI writes due_date.

ALTER TABLE huddle_intentions
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES huddle_topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date DATE;

CREATE INDEX IF NOT EXISTS idx_huddle_intentions_topic ON huddle_intentions(topic_id);
CREATE INDEX IF NOT EXISTS idx_huddle_intentions_task  ON huddle_intentions(linked_task_id);

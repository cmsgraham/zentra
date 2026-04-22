-- Migration 017: "Move on" self-justification fields for focus sessions.
-- When a user ends a session without completing the task (formerly "Abandon",
-- now "Move on"), they can optionally tell themselves why and leave a note.
-- The outcome stays as 'abandoned' internally; these fields add the reflection.

ALTER TABLE focus_sessions
  ADD COLUMN IF NOT EXISTS move_on_reason TEXT
    CHECK (move_on_reason IS NULL OR move_on_reason IN (
      'ran_out_of_time',
      'lost_focus',
      'blocked',
      'priority_shift',
      'too_big',
      'not_worth_it'
    )),
  ADD COLUMN IF NOT EXISTS move_on_note TEXT;

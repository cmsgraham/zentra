-- Add start-of-day time to user preferences.
-- Pairs with zentra_end_of_day_time (added in 015_zentra_core.sql) so the
-- planner / today view can render a working-hours urgency band.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS zentra_start_of_day_time TIME DEFAULT '09:00';

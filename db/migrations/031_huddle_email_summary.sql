-- 031_huddle_email_summary.sql
-- Adds the option to email the huddle summary to participants when the huddle
-- is closed. Configurable per-template (default for huddles started from it)
-- and per-huddle (overridable on the actual instance).

ALTER TABLE huddle_templates
  ADD COLUMN IF NOT EXISTS email_summary_to_participants BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE huddles
  ADD COLUMN IF NOT EXISTS email_summary_on_close BOOLEAN NOT NULL DEFAULT false;

-- Track when the auto-email was last sent for a huddle, so closing a huddle
-- twice (idempotency) won't re-spam participants.
ALTER TABLE huddles
  ADD COLUMN IF NOT EXISTS summary_emailed_at TIMESTAMPTZ;

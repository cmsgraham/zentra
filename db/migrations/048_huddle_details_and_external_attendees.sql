-- 048_huddle_details_and_external_attendees.sql
-- Extends huddles to support:
--   • Per-item free-form details/notes on signals, topics, decisions, intentions.
--   • External (non-app) attendees on participants, optionally persisted on
--     templates so future huddles from the same template pre-populate them.

ALTER TABLE huddle_signals     ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE huddle_topics      ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE huddle_decisions   ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE huddle_intentions  ADD COLUMN IF NOT EXISTS details TEXT;

-- External attendee support on participants. The legacy schema enforced
-- (user_id NOT NULL) and UNIQUE (huddle_id, user_id). We relax both so a row
-- can represent a manually-added person with no app account.
ALTER TABLE huddle_participants
  ADD COLUMN IF NOT EXISTS external_name  TEXT,
  ADD COLUMN IF NOT EXISTS external_email TEXT,
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'huddle_participants_huddle_id_user_id_key'
  ) THEN
    ALTER TABLE huddle_participants
      DROP CONSTRAINT huddle_participants_huddle_id_user_id_key;
  END IF;
END $$;

-- Replacement uniqueness: only enforced for in-app users.
CREATE UNIQUE INDEX IF NOT EXISTS idx_huddle_participants_user_unique
  ON huddle_participants(huddle_id, user_id)
  WHERE user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_huddle_participants_identity'
  ) THEN
    ALTER TABLE huddle_participants
      ADD CONSTRAINT chk_huddle_participants_identity
      CHECK (user_id IS NOT NULL OR (external_name IS NOT NULL AND length(trim(external_name)) > 0));
  END IF;
END $$;

-- Templates persist a default set of external attendees so they auto-populate
-- on future huddles started from the same template.
ALTER TABLE huddle_templates
  ADD COLUMN IF NOT EXISTS default_external_attendees JSONB NOT NULL DEFAULT '[]'::jsonb;

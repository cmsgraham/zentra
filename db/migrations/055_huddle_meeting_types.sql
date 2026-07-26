-- 055_huddle_meeting_types.sql
--
-- Phase 2b + 2d: meetings get a type with a default shape, a duration, and a
-- pre-read; attendees get required/decider flags; decisions get rationale,
-- reversibility and supersession.
--
-- Duration is the missing input for two metrics that could not be answered
-- before: decisions per meeting hour, and estimated cost per meeting.

-- ─────────────────────────────────────────────
-- A. Meeting type, duration, pre-read
-- ─────────────────────────────────────────────
-- huddles.type (team|personal) stays: it selects which board renders. This is
-- the orthogonal question of what KIND of meeting it is.
ALTER TABLE huddles
  ADD COLUMN IF NOT EXISTS meeting_type            TEXT,
  ADD COLUMN IF NOT EXISTS planned_duration_minutes INT,
  ADD COLUMN IF NOT EXISTS pre_read_url            TEXT;

-- A 1:1 is the personal board; everything else defaults to weekly tactical,
-- which is the closest shape to how team huddles have been used so far.
UPDATE huddles
   SET meeting_type = CASE WHEN type = 'personal' THEN 'one_on_one' ELSE 'tactical' END
 WHERE meeting_type IS NULL;

UPDATE huddles
   SET planned_duration_minutes = CASE meeting_type
         WHEN 'standup'    THEN 15
         WHEN 'tactical'   THEN 90
         WHEN 'strategic'  THEN 180
         WHEN 'one_on_one' THEN 30
         ELSE 30
       END
 WHERE planned_duration_minutes IS NULL;

ALTER TABLE huddles ALTER COLUMN meeting_type SET DEFAULT 'tactical';
ALTER TABLE huddles ALTER COLUMN meeting_type SET NOT NULL;

ALTER TABLE huddles
  ADD CONSTRAINT huddles_meeting_type_check
  CHECK (meeting_type IN ('standup','tactical','strategic','adhoc','one_on_one'));

-- Templates carry the shape forward to every huddle started from them.
ALTER TABLE huddle_templates
  ADD COLUMN IF NOT EXISTS default_meeting_type     TEXT,
  ADD COLUMN IF NOT EXISTS default_duration_minutes INT,
  ADD COLUMN IF NOT EXISTS default_pre_read_url     TEXT;

UPDATE huddle_templates
   SET default_meeting_type = CASE WHEN type = 'personal' THEN 'one_on_one' ELSE 'tactical' END
 WHERE default_meeting_type IS NULL;

ALTER TABLE huddle_templates
  ADD CONSTRAINT huddle_templates_meeting_type_check
  CHECK (default_meeting_type IS NULL
         OR default_meeting_type IN ('standup','tactical','strategic','adhoc','one_on_one'));

-- ─────────────────────────────────────────────
-- B. Attendee expectations
-- ─────────────────────────────────────────────
-- Optional attendees are how a meeting stops growing; deciders are who can
-- actually call a 'decide' topic in the room.
ALTER TABLE huddle_participants
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_decider  BOOLEAN NOT NULL DEFAULT false;

-- The host is a decider by default; someone has to be able to call things.
UPDATE huddle_participants SET is_decider = true WHERE role = 'host';

-- ─────────────────────────────────────────────
-- C. Decisions: rationale, reversibility, supersession
-- ─────────────────────────────────────────────
-- Kept editable rather than immutable, per the product call — supersession is
-- an option for recording a genuine change of mind, not the only way to edit.
ALTER TABLE huddle_decisions
  ADD COLUMN IF NOT EXISTS rationale        TEXT,
  ADD COLUMN IF NOT EXISTS decision_type    TEXT,
  ADD COLUMN IF NOT EXISTS affected_parties TEXT,
  ADD COLUMN IF NOT EXISTS supersedes_decision_id UUID
      REFERENCES huddle_decisions(id) ON DELETE SET NULL;

ALTER TABLE huddle_decisions
  ADD CONSTRAINT huddle_decisions_type_check
  CHECK (decision_type IS NULL OR decision_type IN ('reversible','irreversible'));

CREATE INDEX IF NOT EXISTS idx_huddle_decisions_supersedes
  ON huddle_decisions(supersedes_decision_id);

-- ─────────────────────────────────────────────
-- D. Loaded hourly rate for meeting cost
-- ─────────────────────────────────────────────
-- Follows the existing convention of per-account settings living on users.
-- Optional: cost is simply not reported when it is unset.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS huddle_loaded_hourly_rate NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_huddles_meeting_type ON huddles(meeting_type);

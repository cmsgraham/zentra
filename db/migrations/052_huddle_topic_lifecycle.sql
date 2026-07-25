-- 052_huddle_topic_lifecycle.sql
-- Turns huddle topics into persistent records that survive a meeting series,
-- rather than discussion moments scoped to one huddle.
--
-- Status model changes:
--   'decided' -> 'closed'   (a non-empty decision log now drives the "Decided"
--                            label, so "closed with no decision recorded" —
--                            discussed, aligned, nothing to log — is expressible)
--   'parked'  -> 'open' + open_reason='deferred'  (parked was a dead end that
--                            never came back; deferred re-enters the loop)
--   new       -> 'cancelled' (no longer relevant; distinct from closed)
--
-- open_reason is NULL for a freshly raised topic (not yet triaged) and set
-- explicitly to 'deferred' or 'needs_decision' when the team triages it.

-- ─────────────────────────────────────────────
-- A. Link a huddle back to the template it was started from.
--    Only captures huddles created after this ships — existing huddles can't
--    be back-linked reliably, so series reporting accumulates from here on.
-- ─────────────────────────────────────────────
ALTER TABLE huddles
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES huddle_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_huddles_template ON huddles(template_id, created_at DESC);

-- ─────────────────────────────────────────────
-- B. Topic record fields
--    owner_user_id    — the driver: who is pushing this forward
--    approver_user_id — the decision-maker (DACI "approver"); a topic stuck in
--                       needs_decision usually has an owner and lacks this
--    parent_topic_id  — subtopics; lets a parent close while children live on
--    carried_from_topic_id — the carry-forward chain across huddles
--    defer_count      — how many times this has re-entered the loop unresolved
--    horizon          — short_term rides the weekly loop; long_term is parked
--                       out of the rotation for a slower review cadence
-- ─────────────────────────────────────────────
ALTER TABLE huddle_topics
  ADD COLUMN IF NOT EXISTS owner_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_topic_id       UUID REFERENCES huddle_topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS carried_from_topic_id UUID REFERENCES huddle_topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS defer_count           INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_reason           TEXT,
  ADD COLUMN IF NOT EXISTS horizon               TEXT NOT NULL DEFAULT 'short_term',
  ADD COLUMN IF NOT EXISTS closed_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by_user_id     UUID REFERENCES users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────
-- C. Drop the old status CHECK by lookup rather than by name.
--    On any database where 027_flows.sql ran first, this constraint is still
--    named flow_topics_status_check: 028's ALTER TABLE ... RENAME TO renames
--    the table but NOT its constraints. Dropping by the expected name would
--    silently no-op and then section E would fail.
-- ─────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'huddle_topics'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE huddle_topics DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────
-- D. Migrate existing rows to the new status model
-- ─────────────────────────────────────────────
UPDATE huddle_topics
   SET closed_at = COALESCE(updated_at, created_at)
 WHERE status = 'decided' AND closed_at IS NULL;

UPDATE huddle_topics
   SET status = 'closed'
 WHERE status = 'decided';

-- Parked topics were explicitly set aside, so they carry 'deferred'. Plain
-- open topics stay untriaged (open_reason NULL).
UPDATE huddle_topics
   SET status = 'open',
       open_reason = COALESCE(open_reason, 'deferred')
 WHERE status = 'parked';

-- ─────────────────────────────────────────────
-- E. New constraints
-- ─────────────────────────────────────────────
ALTER TABLE huddle_topics
  ADD CONSTRAINT huddle_topics_status_check
  CHECK (status IN ('open', 'closed', 'cancelled'));

ALTER TABLE huddle_topics
  ADD CONSTRAINT huddle_topics_open_reason_check
  CHECK (open_reason IS NULL OR open_reason IN ('deferred', 'needs_decision'));

ALTER TABLE huddle_topics
  ADD CONSTRAINT huddle_topics_horizon_check
  CHECK (horizon IN ('short_term', 'long_term'));

CREATE INDEX IF NOT EXISTS idx_huddle_topics_carried ON huddle_topics(carried_from_topic_id);
CREATE INDEX IF NOT EXISTS idx_huddle_topics_parent  ON huddle_topics(parent_topic_id);
CREATE INDEX IF NOT EXISTS idx_huddle_topics_loop    ON huddle_topics(huddle_id, status, horizon);

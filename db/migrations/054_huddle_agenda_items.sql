-- 054_huddle_agenda_items.sql
--
-- Path A: a topic becomes independent of any one huddle, and huddle_agenda_items
-- joins topics to the meetings they appear on.
--
-- Until now carry-forward COPIED a topic row into each new huddle, so one
-- long-running topic existed as N rows. That forced the series report to filter
-- to the "live head" of each chain, made a topic's true age a recursive query,
-- and made "% of agenda items that reached a decision" awkward to express.
--
-- This collapses each carry chain onto its ORIGIN row (which holds the true
-- first-raised date) while copying the HEAD's current state onto it, and turns
-- each former copy into an agenda item carrying the state that copy left its
-- meeting in. Per-meeting history is preserved in agenda_items.outcome_state
-- rather than in duplicate topic rows.
--
-- Also expands topic status to the seven named states and retires open_reason.

-- ─────────────────────────────────────────────
-- A. New topic fields
-- ─────────────────────────────────────────────
ALTER TABLE huddle_topics
  ADD COLUMN IF NOT EXISTS purpose            TEXT NOT NULL DEFAULT 'discuss',
  ADD COLUMN IF NOT EXISTS framing_question   TEXT,
  ADD COLUMN IF NOT EXISTS timebox_minutes    INT,
  ADD COLUMN IF NOT EXISTS first_discussed_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────
-- A2. Decisions record which meeting they were made at
-- ─────────────────────────────────────────────
-- Previously the meeting was inferred through the topic. Once a topic spans
-- several meetings that inference is gone, and "decisions per meeting hour"
-- needs it. Backfilled BEFORE the chain collapse below, while each decision is
-- still attached to the specific copy that recorded it — afterwards every
-- decision would appear to have happened at the origin meeting.
ALTER TABLE huddle_decisions
  ADD COLUMN IF NOT EXISTS huddle_id UUID REFERENCES huddles(id) ON DELETE CASCADE;

UPDATE huddle_decisions d
   SET huddle_id = t.huddle_id
  FROM huddle_topics t
 WHERE t.id = d.huddle_topic_id AND d.huddle_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_huddle_decisions_huddle ON huddle_decisions(huddle_id);

-- ─────────────────────────────────────────────
-- B. The agenda join
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS huddle_agenda_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id       UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  topic_id        UUID NOT NULL REFERENCES huddle_topics(id) ON DELETE CASCADE,
  sort_order      INT NOT NULL DEFAULT 0,
  timebox_minutes INT,
  -- Free-text note of what actually happened with this item at this meeting.
  outcome         TEXT,
  -- The state the topic was left in when this meeting ended. This is what
  -- preserves the old "each huddle is a snapshot" behaviour after collapsing.
  outcome_state   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- C. One agenda item per existing topic row
-- ─────────────────────────────────────────────
INSERT INTO huddle_agenda_items (huddle_id, topic_id, sort_order, outcome_state, created_at)
SELECT t.huddle_id, t.id, t.sort_order,
       CASE
         WHEN t.status = 'closed'
              AND EXISTS (SELECT 1 FROM huddle_decisions d WHERE d.huddle_topic_id = t.id)
           THEN 'decided'
         WHEN t.status = 'closed'                  THEN 'closed'
         WHEN t.status = 'cancelled'               THEN 'cancelled'
         WHEN t.open_reason = 'needs_decision'     THEN 'awaiting_decision'
         WHEN t.open_reason = 'deferred'           THEN 'deferred'
         ELSE 'carried'
       END,
       t.created_at
  FROM huddle_topics t
 WHERE NOT EXISTS (
   SELECT 1 FROM huddle_agenda_items a
    WHERE a.topic_id = t.id AND a.huddle_id = t.huddle_id
 );

-- ─────────────────────────────────────────────
-- D. Collapse carry chains onto their origin row
-- ─────────────────────────────────────────────
-- Plain TEMP (not ON COMMIT DROP): psql autocommits per statement while the
-- production runner sends the file as one implicit transaction, and this works
-- identically under both.
CREATE TEMP TABLE _root AS
WITH RECURSIVE r AS (
  SELECT id AS topic_id, id AS node, carried_from_topic_id AS parent
    FROM huddle_topics
  UNION ALL
  SELECT r.topic_id, p.id, p.carried_from_topic_id
    FROM r JOIN huddle_topics p ON p.id = r.parent
)
SELECT topic_id, node AS root_id FROM r WHERE parent IS NULL;

-- The head of a chain is the copy nothing else carried forward from; it holds
-- the topic's current state.
CREATE TEMP TABLE _head AS
SELECT r.root_id, t.*
  FROM _root r
  JOIN huddle_topics t ON t.id = r.topic_id
 WHERE NOT EXISTS (
   SELECT 1 FROM huddle_topics n WHERE n.carried_from_topic_id = t.id
 );

-- Re-point every dependent BEFORE deleting anything. huddle_decisions cascades
-- on topic delete, so skipping this would silently destroy decision history.
UPDATE huddle_decisions d SET huddle_topic_id = r.root_id
  FROM _root r WHERE d.huddle_topic_id = r.topic_id AND r.root_id <> r.topic_id;

UPDATE huddle_intentions i SET topic_id = r.root_id
  FROM _root r WHERE i.topic_id = r.topic_id AND r.root_id <> r.topic_id;

UPDATE huddle_agenda_items a SET topic_id = r.root_id
  FROM _root r WHERE a.topic_id = r.topic_id AND r.root_id <> r.topic_id;

UPDATE huddle_topics t SET parent_topic_id = r.root_id
  FROM _root r WHERE t.parent_topic_id = r.topic_id AND r.root_id <> r.topic_id;

-- Carry the head's live state back onto the surviving origin row.
UPDATE huddle_topics t
   SET status            = h.status,
       open_reason       = h.open_reason,
       horizon           = h.horizon,
       defer_count       = h.defer_count,
       closed_at         = h.closed_at,
       closed_by_user_id = h.closed_by_user_id,
       owner_user_id     = COALESCE(h.owner_user_id, t.owner_user_id),
       approver_user_id  = COALESCE(h.approver_user_id, t.approver_user_id),
       context           = COALESCE(h.context, t.context),
       details           = COALESCE(h.details, t.details),
       updated_at        = now()
  FROM _head h
 WHERE t.id = h.root_id AND h.root_id <> h.id;

DELETE FROM huddle_topics t USING _root r
 WHERE t.id = r.topic_id AND r.root_id <> r.topic_id;

-- Two agenda items in one huddle pointing at the same topic can only arise from
-- malformed data, but dedupe before the unique index so the migration cannot
-- fail on it.
DELETE FROM huddle_agenda_items a
 USING huddle_agenda_items b
 WHERE a.huddle_id = b.huddle_id
   AND a.topic_id  = b.topic_id
   AND a.ctid > b.ctid;

DROP TABLE _root;
DROP TABLE _head;

-- ─────────────────────────────────────────────
-- E. Seven named statuses; open_reason retires
-- ─────────────────────────────────────────────
-- Drop by lookup: constraint names differ by database depending on whether the
-- table arrived via 027's CREATE or 028's RENAME (see 052 for the same trap).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'huddle_topics'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ~ '(status|open_reason)'
  LOOP
    EXECUTE format('ALTER TABLE huddle_topics DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

UPDATE huddle_topics
   SET status = CASE
     WHEN status = 'open' AND open_reason = 'needs_decision' THEN 'awaiting_decision'
     WHEN status = 'open' AND open_reason = 'deferred'       THEN 'deferred'
     WHEN status = 'open'                                    THEN 'scheduled'
     ELSE status
   END;

ALTER TABLE huddle_topics DROP COLUMN IF EXISTS open_reason;

ALTER TABLE huddle_topics
  ADD CONSTRAINT huddle_topics_status_check
  CHECK (status IN ('proposed','scheduled','in_discussion',
                    'awaiting_decision','deferred','closed','cancelled'));

ALTER TABLE huddle_topics
  ADD CONSTRAINT huddle_topics_purpose_check
  CHECK (purpose IN ('decide','discuss','inform'));

-- True first-discussed date is the earliest meeting the topic appeared on.
UPDATE huddle_topics t
   SET first_discussed_at = a.first_seen
  FROM (SELECT topic_id, MIN(created_at) AS first_seen
          FROM huddle_agenda_items GROUP BY topic_id) a
 WHERE a.topic_id = t.id AND t.first_discussed_at IS NULL;

-- ─────────────────────────────────────────────
-- F. Signal category replaces the "@wins" prefix hack
-- ─────────────────────────────────────────────
ALTER TABLE huddle_signals ADD COLUMN IF NOT EXISTS category TEXT;

UPDATE huddle_signals
   SET category       = substring(why_it_matters from '^@([a-z_]+)'),
       why_it_matters = NULLIF(btrim(regexp_replace(why_it_matters, '^@[a-z_]+', '')), '')
 WHERE why_it_matters LIKE '@%';

ALTER TABLE huddle_signals
  ADD CONSTRAINT huddle_signals_category_check
  CHECK (category IS NULL OR category IN ('wins','friction','growth','support'));

-- ─────────────────────────────────────────────
-- G. huddle_id becomes origin_huddle_id
-- ─────────────────────────────────────────────
-- Renamed rather than dropped so the origin is still recorded, and so any query
-- still selecting huddle_id fails loudly instead of quietly returning the wrong
-- rows now that a topic can appear on several agendas.
ALTER TABLE huddle_topics RENAME COLUMN huddle_id TO origin_huddle_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_unique
  ON huddle_agenda_items(huddle_id, topic_id);
CREATE INDEX IF NOT EXISTS idx_agenda_huddle ON huddle_agenda_items(huddle_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_agenda_topic  ON huddle_agenda_items(topic_id);

import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../lib/errors.js';
import { sendMail, huddleSummaryEmail, huddleInviteEmail } from '../../lib/mailer.js';
import { getEnv } from '../../lib/env.js';

// ─── Schemas ──────────────────────────────────────────────────────────────

// Default shape per meeting type. Standups are blockers-only and deliberately
// have no topic list; strategic meetings expect a pre-read.
const MEETING_TYPES = ['standup', 'tactical', 'strategic', 'adhoc', 'one_on_one'] as const;
const meetingTypeSchema = z.enum(MEETING_TYPES);
export const MEETING_DEFAULTS: Record<string, { minutes: number; wantsPreRead: boolean; topics: boolean }> = {
  standup:    { minutes: 15,  wantsPreRead: false, topics: false },
  tactical:   { minutes: 90,  wantsPreRead: false, topics: true  },
  strategic:  { minutes: 180, wantsPreRead: true,  topics: true  },
  adhoc:      { minutes: 30,  wantsPreRead: false, topics: true  },
  one_on_one: { minutes: 30,  wantsPreRead: false, topics: true  },
};

const externalAttendeeSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(254).nullable().optional(),
});

const createHuddleSchema = z.object({
  type: z.enum(['team', 'personal']),
  title: z.string().min(1).max(200),
  intention: z.string().max(1000).optional().nullable(),
  workspaceId: z.string().uuid().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  participantUserIds: z.array(z.string().uuid()).optional().default([]),
  externalAttendees: z.array(externalAttendeeSchema).optional().default([]),
  // Records which template this huddle was started from, so a recurring
  // meeting can be reported on as a series.
  templateId: z.string().uuid().optional().nullable(),
  meetingType: meetingTypeSchema.optional(),
  plannedDurationMinutes: z.number().int().min(5).max(480).optional().nullable(),
  preReadUrl: z.string().max(2000).optional().nullable(),
});

const updateHuddleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  meetingType: meetingTypeSchema.optional(),
  plannedDurationMinutes: z.number().int().min(5).max(480).nullable().optional(),
  preReadUrl: z.string().max(2000).nullable().optional(),
  intention: z.string().max(1000).nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  status: z.enum(['draft', 'active', 'closed']).optional(),
  emailSummaryOnClose: z.boolean().optional(),
});

const closeHuddleSchema = z.object({
  summary: z.string().max(4000).optional().nullable(),
  emailSummaryToParticipants: z.boolean().optional(),
});

const addParticipantSchema = z.union([
  z.object({
    userId: z.string().uuid(),
    role: z.enum(['host', 'participant']).optional().default('participant'),
  }),
  z.object({
    externalName: z.string().min(1).max(120),
    externalEmail: z.string().email().max(254).optional().nullable(),
    role: z.enum(['host', 'participant']).optional().default('participant'),
  }),
]);

const updateParticipantSchema = z.object({
  role: z.enum(['host', 'participant']).optional(),
  attendanceStatus: z.enum(['invited', 'present', 'late', 'virtual', 'excused']).optional(),
  isRequired: z.boolean().optional(),
  isDecider: z.boolean().optional(),
});

const detailsField = z.string().max(8000).nullable().optional();

const createSignalSchema = z.object({
  text: z.string().min(1).max(1000),
  whyItMatters: z.string().max(1000).optional().nullable(),
  details: detailsField,
});

const updateSignalSchema = z.object({
  text: z.string().min(1).max(1000).optional(),
  whyItMatters: z.string().max(1000).nullable().optional(),
  details: detailsField,
});

const updateDecisionSchema = z.object({
  decisionText: z.string().min(1).max(1000).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  rationale: z.string().max(2000).nullable().optional(),
  decisionType: z.enum(['reversible', 'irreversible']).nullable().optional(),
  affectedParties: z.string().max(1000).nullable().optional(),
  details: detailsField,
});

// A topic is "live" in any of these; the rest are terminal.
const TOPIC_LIVE = ['proposed', 'scheduled', 'in_discussion', 'awaiting_decision', 'deferred'] as const;
const topicStatus = z.enum([...TOPIC_LIVE, 'closed', 'cancelled']);
const topicPurpose = z.enum(['decide', 'discuss', 'inform']);
const topicHorizon = z.enum(['short_term', 'long_term']);

const createTopicSchema = z.object({
  title: z.string().min(1).max(300),
  context: z.string().max(2000).optional().nullable(),
  sourceSignalId: z.string().uuid().optional().nullable(),
  parentTopicId: z.string().uuid().optional().nullable(),
  ownerUserId: z.string().uuid().optional().nullable(),
  approverUserId: z.string().uuid().optional().nullable(),
  purpose: topicPurpose.optional(),
  framingQuestion: z.string().max(500).nullable().optional(),
  timeboxMinutes: z.number().int().min(1).max(480).nullable().optional(),
  details: detailsField,
});

const updateTopicSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  context: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  status: topicStatus.optional(),
  purpose: topicPurpose.optional(),
  framingQuestion: z.string().max(500).nullable().optional(),
  timeboxMinutes: z.number().int().min(1).max(480).nullable().optional(),
  horizon: topicHorizon.optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  approverUserId: z.string().uuid().nullable().optional(),
  parentTopicId: z.string().uuid().nullable().optional(),
  details: detailsField,
});

// Body for the explicit lifecycle transitions below.
const deferTopicSchema = z.object({
  horizon: topicHorizon.optional(),
}).optional().default({});

const needsDecisionSchema = z.object({
  approverUserId: z.string().uuid().nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
}).optional().default({});

const closeTopicSchema = z.object({
  // 'cancelled' = no longer relevant, distinct from resolved.
  outcome: z.enum(['closed', 'cancelled']).optional().default('closed'),
}).optional().default({});

const decideTopicSchema = z.object({
  decisionText: z.string().min(1).max(1000),
  ownerUserId: z.string().uuid().nullable().optional(),
  rationale: z.string().max(2000).nullable().optional(),
  decisionType: z.enum(['reversible', 'irreversible']).nullable().optional(),
  affectedParties: z.string().max(1000).nullable().optional(),
  // Recording a change of mind rather than editing history away.
  supersedesDecisionId: z.string().uuid().nullable().optional(),
  details: detailsField,
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createIntentionSchema = z.object({
  text: z.string().min(1).max(500),
  ownerUserId: z.string().uuid().optional(), // defaults to current user
  softDueText: z.string().max(120).optional().nullable(),
  dueDate: isoDate.nullable().optional(),
  topicId: z.string().uuid().nullable().optional(),
  details: detailsField,
});

const updateIntentionSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  ownerUserId: z.string().uuid().optional(),
  softDueText: z.string().max(120).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  topicId: z.string().uuid().nullable().optional(),
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  details: detailsField,
});

const convertIntentionSchema = z.object({
  workspaceId: z.string().uuid(),
  priorityForToday: z.boolean().optional().default(false),
});

const createFollowupSchema = z.object({
  text: z.string().min(1).max(500),
  ownerUserId: z.string().uuid().optional(),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const updateFollowupSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['open', 'done', 'carried_forward']).optional(),
});

const createNoteSchema = z.object({
  text: z.string().min(1).max(4000),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

// ─── Formatters ───────────────────────────────────────────────────────────

function formatHuddle(r: any) {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    type: r.type,
    title: r.title,
    intention: r.intention,
    hostUserId: r.host_user_id,
    status: r.status,
    scheduledAt: r.scheduled_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    summary: r.summary,
    meetingType: r.meeting_type ?? 'tactical',
    plannedDurationMinutes: r.planned_duration_minutes ?? null,
    preReadUrl: r.pre_read_url ?? null,
    templateId: r.template_id ?? null,
    templateName: r.template_name ?? null,
    emailSummaryOnClose: r.email_summary_on_close ?? false,
    summaryEmailedAt: r.summary_emailed_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hostName: r.host_name ?? undefined,
  };
}
function formatParticipant(r: any) {
  return {
    id: r.id,
    huddleId: r.huddle_id,
    userId: r.user_id ?? null,
    role: r.role,
    attendanceStatus: r.attendance_status,
    isRequired: r.is_required ?? true,
    isDecider: r.is_decider ?? false,
    checkedInAt: r.checked_in_at,
    userName: r.user_name ?? undefined,
    userEmail: r.user_email ?? undefined,
    userAvatarUrl: r.user_avatar_url ?? null,
    externalName: r.external_name ?? null,
    externalEmail: r.external_email ?? null,
  };
}
function formatSignal(r: any) {
  return {
    id: r.id,
    huddleId: r.huddle_id,
    authorUserId: r.author_user_id,
    text: r.text,
    whyItMatters: r.why_it_matters,
    details: r.details ?? null,
    promotedToTopic: r.promoted_to_topic,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
    authorName: r.author_name ?? undefined,
  };
}
function formatTopic(r: any) {
  return {
    id: r.id,
    // Where the topic was first raised. Which meetings it appears on now comes
    // from huddle_agenda_items, so a board must read agenda fields, not this.
    originHuddleId: r.origin_huddle_id,
    // Kept so callers rendering one huddle's board keep working; resolves to
    // the agenda's huddle when the row came through the agenda join.
    huddleId: r.agenda_huddle_id ?? r.origin_huddle_id,
    agendaItemId: r.agenda_item_id ?? null,
    title: r.title,
    context: r.context,
    details: r.details ?? null,
    purpose: r.purpose ?? 'discuss',
    framingQuestion: r.framing_question ?? null,
    // Agenda timebox wins when present: the same topic can get a different
    // allocation at different meetings.
    timeboxMinutes: r.agenda_timebox ?? r.timebox_minutes ?? null,
    outcome: r.outcome ?? null,
    outcomeState: r.outcome_state ?? null,
    firstDiscussedAt: r.first_discussed_at ?? null,
    sortOrder: r.sort_order ?? 0,
    status: r.status,
    horizon: r.horizon ?? 'short_term',
    deferCount: r.defer_count ?? 0,
    ownerUserId: r.owner_user_id ?? null,
    ownerName: r.owner_name ?? null,
    approverUserId: r.approver_user_id ?? null,
    approverName: r.approver_name ?? null,
    parentTopicId: r.parent_topic_id ?? null,
    carriedFromTopicId: r.carried_from_topic_id ?? null,
    closedAt: r.closed_at ?? null,
    closedByUserId: r.closed_by_user_id ?? null,
    sourceSignalId: r.source_signal_id,
    createdAt: r.created_at,
  };
}
function formatDecision(r: any) {
  return {
    id: r.id,
    huddleTopicId: r.huddle_topic_id,
    ownerUserId: r.owner_user_id,
    decisionText: r.decision_text,
    rationale: r.rationale ?? null,
    decisionType: r.decision_type ?? null,
    affectedParties: r.affected_parties ?? null,
    supersedesDecisionId: r.supersedes_decision_id ?? null,
    huddleId: r.huddle_id ?? null,
    details: r.details ?? null,
    createdAt: r.created_at,
    ownerName: r.owner_name ?? null,
  };
}
function formatIntention(r: any) {
  return {
    id: r.id,
    huddleId: r.huddle_id,
    text: r.text,
    ownerUserId: r.owner_user_id,
    softDueText: r.soft_due_text,
    dueDate: r.due_date ?? null,
    topicId: r.topic_id ?? null,
    details: r.details ?? null,
    linkedTaskId: r.linked_task_id,
    // Live state of the linked task, so the huddle shows a reference rather
    // than a second copy of the truth that can drift.
    linkedTaskStatus: r.linked_task_status ?? null,
    linkedTaskDueDate: r.linked_task_due_date ?? null,
    status: r.status,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
    ownerName: r.owner_name ?? undefined,
  };
}
function formatFollowup(r: any) {
  return {
    id: r.id,
    huddleId: r.huddle_id,
    text: r.text,
    ownerUserId: r.owner_user_id,
    reviewDate: r.review_date,
    status: r.status,
    carriedFromHuddleId: r.carried_from_huddle_id,
    createdAt: r.created_at,
    ownerName: r.owner_name ?? undefined,
  };
}
function formatNote(r: any) {
  return {
    id: r.id,
    huddleId: r.huddle_id,
    authorUserId: r.author_user_id,
    text: r.text,
    createdAt: r.created_at,
    authorName: r.author_name ?? undefined,
  };
}

// ─── Access helpers ───────────────────────────────────────────────────────

async function loadHuddleOrThrow(app: FastifyInstance, huddleId: string, userId: string) {
  const r = await app.pg.query('SELECT * FROM huddles WHERE id = $1', [huddleId]);
  if (r.rows.length === 0) throw new NotFoundError('Huddle not found');
  const huddle = r.rows[0];

  // Access rules:
  // - Host always has access
  // - Listed participant has access
  // - For workspace huddles, any workspace member has access (read)
  if (huddle.host_user_id === userId) return huddle;

  const part = await app.pg.query(
    'SELECT 1 FROM huddle_participants WHERE huddle_id = $1 AND user_id = $2',
    [huddleId, userId],
  );
  if (part.rows.length > 0) return huddle;

  if (huddle.workspace_id) {
    const m = await app.pg.query(
      'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [huddle.workspace_id, userId],
    );
    if (m.rows.length > 0) return huddle;
  }
  throw new ForbiddenError('You do not have access to this huddle');
}

// ─── Agenda reads ─────────────────────────────────────────────────────────
// One place that knows how a topic is joined to a meeting, so the shape stays
// consistent across the board, the export, the share view and the summary mail.
const AGENDA_SELECT = `
  SELECT t.*,
         a.id         AS agenda_item_id,
         a.huddle_id  AS agenda_huddle_id,
         a.sort_order AS sort_order,
         a.timebox_minutes AS agenda_timebox,
         a.outcome, a.outcome_state,
         uo.name AS owner_name, ua.name AS approver_name
    FROM huddle_agenda_items a
    JOIN huddle_topics t ON t.id = a.topic_id
    LEFT JOIN users uo ON uo.id = t.owner_user_id
    LEFT JOIN users ua ON ua.id = t.approver_user_id`;

/** Every topic on one huddle's agenda, in agenda order. */
async function agendaForHuddle(db: any, huddleId: string) {
  const r = await db.query(
    `${AGENDA_SELECT} WHERE a.huddle_id = $1 ORDER BY a.sort_order ASC, t.created_at ASC`,
    [huddleId],
  );
  return r.rows;
}

/** A single topic as it appears on a given huddle's agenda. */
async function agendaTopic(db: any, huddleId: string, topicId: string) {
  const r = await db.query(
    `${AGENDA_SELECT} WHERE a.huddle_id = $1 AND a.topic_id = $2`,
    [huddleId, topicId],
  );
  if (r.rows.length === 0) throw new NotFoundError('Topic not found on this agenda');
  return r.rows[0];
}

/** Puts an existing topic on a huddle's agenda, at the end. Idempotent. */
async function addToAgenda(
  db: any, huddleId: string, topicId: string, timeboxMinutes: number | null = null,
) {
  const ord = await db.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM huddle_agenda_items WHERE huddle_id = $1`,
    [huddleId],
  );
  const r = await db.query(
    `INSERT INTO huddle_agenda_items (huddle_id, topic_id, sort_order, timebox_minutes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (huddle_id, topic_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [huddleId, topicId, ord.rows[0].next, timeboxMinutes],
  );
  return r.rows[0].id;
}

// ─── Carry-forward ────────────────────────────────────────────────────────
// Copies unresolved topics from the previous huddle in the same series into a
// newly created one. Every huddle keeps its own row, so a topic's state in an
// earlier huddle stays an accurate record of what was true at that meeting —
// closing a carried copy never rewrites history. carried_from_topic_id is
// lineage only; nothing reads back through it to mutate the source.
async function carryForwardTopics(client: any, newHuddleId: string, huddle: any) {
  // Series identity, most specific first: the template it was started from,
  // else the workspace+type pairing, else the host (personal huddles).
  let sql: string;
  let params: any[];
  // Source must be a closed huddle: a topic only counts as unresolved once the
  // meeting actually ended. Pulling from a draft/active one would duplicate
  // work still live on another board.
  if (huddle.template_id) {
    sql = `SELECT id FROM huddles WHERE template_id = $1 AND id <> $2 AND status = 'closed'
           ORDER BY COALESCE(ended_at, scheduled_at, created_at) DESC LIMIT 1`;
    params = [huddle.template_id, newHuddleId];
  } else if (huddle.workspace_id) {
    sql = `SELECT id FROM huddles
            WHERE workspace_id = $1 AND type = $2 AND id <> $3 AND status = 'closed'
            ORDER BY COALESCE(ended_at, scheduled_at, created_at) DESC LIMIT 1`;
    params = [huddle.workspace_id, huddle.type, newHuddleId];
  } else {
    sql = `SELECT id FROM huddles
            WHERE host_user_id = $1 AND type = $2 AND workspace_id IS NULL
              AND id <> $3 AND status = 'closed'
            ORDER BY COALESCE(ended_at, scheduled_at, created_at) DESC LIMIT 1`;
    params = [huddle.host_user_id, huddle.type, newHuddleId];
  }

  // Only the immediately-previous huddle, never the whole history — otherwise a
  // topic open since week one would be copied once per past meeting.
  const prev = await client.query(sql, params);
  if (prev.rows.length === 0) return 0;

  // Only short_term rides the loop. long_term was deliberately moved out of the
  // weekly rotation and should not keep reappearing.
  const unresolved = await client.query(
    `SELECT t.id, t.status, t.defer_count, a.sort_order
       FROM huddle_agenda_items a
       JOIN huddle_topics t ON t.id = a.topic_id
      WHERE a.huddle_id = $1
        AND t.status IN ('proposed','scheduled','in_discussion','awaiting_decision','deferred')
        AND t.horizon = 'short_term'
      ORDER BY a.sort_order ASC`,
    [prev.rows[0].id],
  );
  if (unresolved.rows.length === 0) return 0;

  // Sit carried items after anything already seeded (e.g. template topics).
  const maxRes = await client.query(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM huddle_agenda_items WHERE huddle_id = $1`,
    [newHuddleId],
  );
  let order = Number(maxRes.rows[0].m) + 1;

  let carried = 0;
  for (const t of unresolved.rows) {
    // The topic itself is not duplicated any more — it simply appears on
    // another agenda, which is what makes its age and history queryable.
    const ins = await client.query(
      `INSERT INTO huddle_agenda_items (huddle_id, topic_id, sort_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (huddle_id, topic_id) DO NOTHING
       RETURNING id`,
      [newHuddleId, t.id, order++],
    );
    if (ins.rows.length === 0) continue;  // already on this agenda

    // Surviving a meeting unresolved counts as a deferral, and an untriaged
    // topic becomes explicitly deferred.
    await client.query(
      `UPDATE huddle_topics
          SET defer_count = defer_count + 1,
              status = CASE WHEN status IN ('proposed','scheduled','in_discussion')
                            THEN 'deferred' ELSE status END,
              updated_at = now()
        WHERE id = $1`,
      [t.id],
    );
    carried++;
  }

  // Subtopics need no re-pointing now: parent_topic_id lives on the topic, and
  // the topic is no longer copied.
  return carried;
}

// Creates the workspace task that backs an action item, and links the
// intention to it. Shared by "+ Action" (which converts immediately) and the
// explicit Convert button, so the two can't drift apart.
// creator_id is NOT NULL — omitting it was why conversion used to 500.
async function createTaskForIntention(
  client: any,
  intent: any,
  workspaceId: string,
  userId: string,
  priorityForToday = false,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  // Board lanes order by lane_order with NULLs last, and new tasks normally
  // get NULL — which drops a fresh commitment into the middle of a busy
  // column, below the fold. A next step someone just committed to in a meeting
  // should be the first thing they see, so place it at the top of the lane.
  const laneRes = await client.query(
    `SELECT COALESCE(MIN(lane_order), 1024) - 1024 AS lane
       FROM tasks
      WHERE workspace_id = $1 AND status = 'pending' AND archived = false`,
    [workspaceId],
  );
  const laneOrder = laneRes.rows[0]?.lane ?? 0;

  const cols = ['workspace_id', 'title', 'status', 'priority', 'next_action',
    'next_action_state', 'creator_id', 'assignee_id', 'due_date', 'lane_order'];
  const vals = ['$1', '$2', `'pending'`, `'medium'`, '$3', `'set'`, '$4', '$5', '$6', '$7'];
  const params: any[] = [
    workspaceId, intent.text, intent.text, userId,
    intent.owner_user_id ?? null, intent.due_date ?? null, laneOrder,
  ];
  if (priorityForToday) {
    cols.push('priority_for_date', 'priority_for_user_id');
    vals.push('$8', '$9');
    params.push(today, intent.owner_user_id ?? null);
  }
  const taskRes = await client.query(
    `INSERT INTO tasks (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id`,
    params,
  );
  const taskId = taskRes.rows[0].id;
  await client.query(
    `UPDATE huddle_intentions SET linked_task_id = $1, updated_at = now() WHERE id = $2`,
    [taskId, intent.id],
  );
  return taskId;
}

function requireHost(huddle: any, userId: string) {
  if (huddle.host_user_id !== userId) throw new ForbiddenError('Only the host can perform this action');
}

async function checkWorkspaceMember(app: FastifyInstance, workspaceId: string, userId: string) {
  const r = await app.pg.query(
    'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  if (r.rows.length === 0) throw new ForbiddenError('Not a member of this workspace');
}

// ─── Markdown minute builder ──────────────────────────────────────────────
// Produces a self-contained markdown document of the huddle, suitable for
// sharing outside the app (file download or pasted into another doc).
function buildMinuteMarkdown(input: {
  title: string;
  type: string;
  hostName: string | null;
  intention: string | null;
  scheduledAt: any;
  startedAt: any;
  endedAt: any;
  participants: any[];
  signals: any[];
  topics: any[];
  decisionsByTopic: Map<string, any[]>;
  intentions: any[];
  followups: any[];
  notes: any[];
  hostSummary: string | null;
}): string {
  const fmtDate = (v: any) => {
    if (!v) return null;
    try { return new Date(v).toLocaleString(); } catch { return String(v); }
  };
  const ind = (s: string | null | undefined) => {
    if (!s) return '';
    return String(s)
      .split('\n')
      .map((line) => `  > ${line}`)
      .join('\n');
  };
  const lines: string[] = [];
  lines.push(`# ${input.title}`);
  const meta: string[] = [];
  meta.push(`Type: ${input.type}`);
  if (input.hostName) meta.push(`Host: ${input.hostName}`);
  if (input.scheduledAt) meta.push(`Scheduled: ${fmtDate(input.scheduledAt)}`);
  if (input.startedAt) meta.push(`Started: ${fmtDate(input.startedAt)}`);
  if (input.endedAt) meta.push(`Ended: ${fmtDate(input.endedAt)}`);
  lines.push(meta.map((m) => `_${m}_`).join('  ·  '));
  lines.push('');

  if (input.intention) {
    lines.push('## Intention');
    lines.push(input.intention);
    lines.push('');
  }

  if (input.participants.length) {
    lines.push('## Attendees');
    for (const p of input.participants) {
      const name = p.user_name ?? p.external_name ?? '—';
      const email = p.user_email ?? p.external_email ?? null;
      const tags: string[] = [];
      if (p.role === 'host') tags.push('host');
      if (!p.user_id) tags.push('external');
      if (p.attendance_status && p.attendance_status !== 'invited') tags.push(p.attendance_status);
      const suffix = tags.length ? `  _(${tags.join(', ')})_` : '';
      lines.push(`- ${name}${email ? ` <${email}>` : ''}${suffix}`);
    }
    lines.push('');
  }

  if (input.signals.length) {
    lines.push('## Signals');
    for (const s of input.signals) {
      const author = s.author_name ? ` — _${s.author_name}_` : '';
      const why = s.why_it_matters && !String(s.why_it_matters).startsWith('@')
        ? `  \n  _${s.why_it_matters}_` : '';
      lines.push(`- ${s.text}${author}${why}`);
      if (s.details) lines.push(ind(s.details));
    }
    lines.push('');
  }

  if (input.topics.length) {
    lines.push('## Focus topics & decisions');
    for (const t of input.topics) {
      const decs = input.decisionsByTopic.get(t.id) ?? [];
      const label =
        t.status === 'cancelled' ? 'cancelled'
        : t.status === 'closed' ? (decs.length > 0 ? 'decided' : 'closed')
        : t.status === 'awaiting_decision' ? 'needs a decision'
        : t.status === 'deferred' ? `deferred${t.defer_count > 1 ? ` ×${t.defer_count}` : ''}`
        : t.status === 'in_discussion' ? 'in discussion'
        : t.status === 'proposed' ? 'proposed'
        : null;
      const statusTag = label ? ` _(${label})_` : '';
      const owner = t.owner_name ? ` — _${t.owner_name}_` : '';
      lines.push(`- **${t.title}**${statusTag}${owner}`);
      if (t.context) lines.push(`  ${t.context}`);
      if (t.details) lines.push(ind(t.details));
      for (const d of decs) {
        const owner = d.owner_name ? ` — _${d.owner_name}_` : '';
        lines.push(`  - ✓ ${d.decision_text}${owner}`);
        if (d.details) lines.push(ind(d.details).replace(/^  >/gm, '    >'));
      }
    }
    lines.push('');
  }

  if (input.intentions.length) {
    lines.push('## Next intentions');
    for (const i of input.intentions) {
      const mark = i.status === 'done' ? '[x]' : '[ ]';
      const owner = i.owner_name ? ` — _${i.owner_name}_` : '';
      const due = i.soft_due_text ? ` (${i.soft_due_text})` : '';
      lines.push(`- ${mark} ${i.text}${owner}${due}`);
      if (i.details) lines.push(ind(i.details));
    }
    lines.push('');
  }

  if (input.followups.length) {
    lines.push('## Follow-ups');
    for (const f of input.followups) {
      const mark = f.status === 'done' ? '[x]' : '[ ]';
      const owner = f.owner_name ? ` — _${f.owner_name}_` : '';
      const review = f.review_date ? ` (review ${f.review_date})` : '';
      lines.push(`- ${mark} ${f.text}${owner}${review}`);
    }
    lines.push('');
  }

  if (input.notes.length) {
    lines.push('## Notes');
    for (const n of input.notes) {
      const author = n.author_name ? ` — _${n.author_name}_` : '';
      lines.push(`- ${n.text}${author}`);
    }
    lines.push('');
  }

  if (input.hostSummary) {
    lines.push('## Host summary');
    lines.push(input.hostSummary);
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

// ─── Email summary helper ─────────────────────────────────────────────────
// Builds + sends the huddle summary email to every participant who has an
// email address (skipping the host). If a non-revoked, non-expired share link
// already exists, it is reused; otherwise we mint a fresh one so recipients
// can view the read-only summary online too.
async function sendHuddleSummaryToParticipants(
  app: FastifyInstance,
  huddleId: string,
  hostUserId: string,
  opts: { includeShareLink?: boolean } = {},
): Promise<{ sentTo: string[]; skipped: string[]; shareUrl: string | null }> {
  const includeShareLink = opts.includeShareLink !== false;

  const huddleRes = await app.pg.query(
    `SELECT h.*, u.name AS host_name FROM huddles h
     LEFT JOIN users u ON u.id = h.host_user_id
     WHERE h.id = $1`,
    [huddleId],
  );
  if (huddleRes.rows.length === 0) throw new NotFoundError('Huddle not found');
  const huddle = huddleRes.rows[0];

  // Recipients: app-account participants with an email (minus the host) +
  // any external attendees with an email. The host already has the data so
  // we skip self-notifications.
  const partRes = await app.pg.query(
    `SELECT u.email AS email, u.name AS name
       FROM huddle_participants p
       JOIN users u ON u.id = p.user_id
       WHERE p.huddle_id = $1 AND p.user_id <> $2 AND COALESCE(u.email, '') <> ''
     UNION ALL
     SELECT p.external_email AS email, p.external_name AS name
       FROM huddle_participants p
       WHERE p.huddle_id = $1 AND p.user_id IS NULL
         AND COALESCE(p.external_email, '') <> ''`,
    [huddleId, hostUserId],
  );
  const recipients: { email: string; name: string | null }[] = partRes.rows.map((r: any) => ({
    email: r.email,
    name: r.name ?? null,
  }));

  // Build payload (mirrors the public-share endpoint shape).
  const [topics, decisions, intentions, followups, notes] = await Promise.all([
    app.pg.query(
      `SELECT t.id, t.title FROM huddle_agenda_items a
         JOIN huddle_topics t ON t.id = a.topic_id
        WHERE a.huddle_id = $1
        ORDER BY a.sort_order ASC, t.created_at ASC`,
      [huddleId],
    ),
    app.pg.query(
      `SELECT d.huddle_topic_id, d.decision_text, u.name AS owner_name
       FROM huddle_decisions d
       JOIN huddle_topics t ON t.id = d.huddle_topic_id
       LEFT JOIN users u ON u.id = d.owner_user_id
       WHERE d.huddle_id = $1
       ORDER BY d.created_at ASC`,
      [huddleId],
    ),
    app.pg.query(
      `SELECT i.text, i.soft_due_text, i.status, u.name AS owner_name
       FROM huddle_intentions i
       LEFT JOIN users u ON u.id = i.owner_user_id
       WHERE i.huddle_id = $1
       ORDER BY i.sort_order ASC, i.created_at ASC`,
      [huddleId],
    ),
    app.pg.query(
      `SELECT f.text, f.review_date, u.name AS owner_name
       FROM huddle_followups f
       LEFT JOIN users u ON u.id = f.owner_user_id
       WHERE f.huddle_id = $1
       ORDER BY f.created_at ASC`,
      [huddleId],
    ),
    app.pg.query(
      `SELECT n.text, u.name AS author_name
       FROM huddle_notes n
       LEFT JOIN users u ON u.id = n.author_user_id
       WHERE n.huddle_id = $1
       ORDER BY n.created_at ASC`,
      [huddleId],
    ),
  ]);

  const topicTitleById = new Map<string, string>();
  for (const t of topics.rows) topicTitleById.set(t.id, t.title);

  const decisionPayload = decisions.rows.map((d: any) => ({
    topicTitle: topicTitleById.get(d.huddle_topic_id) ?? '',
    decisionText: d.decision_text,
    ownerName: d.owner_name ?? null,
  }));

  // Reuse an active share link if one exists; otherwise create a new one so
  // the email's "View online" link works.
  let shareUrl: string | null = null;
  if (includeShareLink) {
    const existing = await app.pg.query(
      `SELECT token FROM huddle_shares
       WHERE huddle_id = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at DESC LIMIT 1`,
      [huddleId],
    );
    let token: string;
    if (existing.rows.length > 0) {
      token = existing.rows[0].token;
    } else {
      token = crypto.randomBytes(24).toString('base64url');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await app.pg.query(
        `INSERT INTO huddle_shares (huddle_id, token, created_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [huddleId, token, hostUserId, expiresAt],
      );
    }
    const base = (getEnv().APP_URL ?? '').replace(/\/$/, '');
    shareUrl = `${base}/huddles/share/${token}`;
  }

  const tpl = huddleSummaryEmail({
    huddleTitle: huddle.title,
    hostName: huddle.host_name ?? null,
    intention: huddle.intention,
    endedAt: huddle.ended_at,
    shareUrl,
    decisions: decisionPayload,
    intentions: intentions.rows.map((i: any) => ({
      text: i.text,
      ownerName: i.owner_name ?? null,
      softDueText: i.soft_due_text ?? null,
      status: i.status,
    })),
    followups: followups.rows.map((f: any) => ({
      text: f.text,
      ownerName: f.owner_name ?? null,
      reviewDate: f.review_date ? String(f.review_date) : null,
    })),
    notes: notes.rows.map((n: any) => ({
      text: n.text,
      authorName: n.author_name ?? null,
    })),
    hostSummary: huddle.summary ?? null,
  });

  const sentTo: string[] = [];
  const skipped: string[] = [];
  for (const r of recipients) {
    const ok = await sendMail(
      { to: r.email, subject: tpl.subject, text: tpl.text, html: tpl.html },
      app.log,
    );
    (ok ? sentTo : skipped).push(r.email);
  }

  await app.pg.query(
    `UPDATE huddles SET summary_emailed_at = now() WHERE id = $1`,
    [huddleId],
  );

  return { sentTo, skipped, shareUrl };
}

// ─── Routes ───────────────────────────────────────────────────────────────

export default async function huddleRoutes(app: FastifyInstance) {
  // ── List huddles (host or participant) ───────────────────────────────────
  app.get('/huddles', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const q = request.query as { status?: string; type?: string; workspaceId?: string };

    const conds: string[] = [
      `(f.host_user_id = $1 OR EXISTS (SELECT 1 FROM huddle_participants p WHERE p.huddle_id = f.id AND p.user_id = $1))`,
    ];
    const params: any[] = [userId];

    if (q.status && ['draft', 'active', 'closed'].includes(q.status)) {
      params.push(q.status);
      conds.push(`f.status = $${params.length}`);
    }
    if (q.type && ['team', 'personal'].includes(q.type)) {
      params.push(q.type);
      conds.push(`f.type = $${params.length}`);
    }
    if (q.workspaceId) {
      params.push(q.workspaceId);
      conds.push(`f.workspace_id = $${params.length}`);
    }

    const result = await app.pg.query(
      `SELECT f.*, u.name AS host_name, tpl.name AS template_name,
              (SELECT count(*)::int FROM huddle_participants p WHERE p.huddle_id = f.id) AS participant_count
       FROM huddles f
       LEFT JOIN users u ON u.id = f.host_user_id
       LEFT JOIN huddle_templates tpl ON tpl.id = f.template_id
       WHERE ${conds.join(' AND ')}
       -- Meetings are a timeline, not an index. Alphabetical ordering made
       -- repeat huddles from one template (which all share the template's
       -- default title) land in an arbitrary order, so opening "the" huddle
       -- could take you to any occurrence of it.
       ORDER BY COALESCE(f.scheduled_at, f.started_at, f.created_at) DESC
       LIMIT 200`,
      params,
    );

    return {
      huddles: result.rows.map((r) => ({
        ...formatHuddle(r),
        participantCount: r.participant_count ?? 0,
      })),
    };
  });

  // ── Create huddle ────────────────────────────────────────────────────────
  app.post('/huddles', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const body = createHuddleSchema.parse(request.body);

    if (body.workspaceId) {
      await checkWorkspaceMember(app, body.workspaceId, userId);
    }
    if (body.type === 'team' && !body.workspaceId) {
      throw new BadRequestError('Team huddles require a workspaceId');
    }

    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');

      const mType = body.meetingType ?? (body.type === 'personal' ? 'one_on_one' : 'tactical');
      const huddleRes = await client.query(
        `INSERT INTO huddles
           (workspace_id, type, title, intention, host_user_id, scheduled_at, status,
            template_id, meeting_type, planned_duration_minutes, pre_read_url)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10)
         RETURNING *`,
        [
          body.workspaceId ?? null, body.type, body.title, body.intention ?? null,
          userId, body.scheduledAt ?? null, body.templateId ?? null,
          mType,
          body.plannedDurationMinutes ?? MEETING_DEFAULTS[mType].minutes,
          body.preReadUrl ?? null,
        ],
      );
      const huddle = huddleRes.rows[0];

      // Host as participant
      await client.query(
        `INSERT INTO huddle_participants (huddle_id, user_id, role, attendance_status)
         VALUES ($1, $2, 'host', 'invited')
         ON CONFLICT DO NOTHING`,
        [huddle.id, userId],
      );
      // Other participants
      for (const pid of body.participantUserIds ?? []) {
        if (pid === userId) continue;
        await client.query(
          `INSERT INTO huddle_participants (huddle_id, user_id, role, attendance_status)
           VALUES ($1, $2, 'participant', 'invited')
           ON CONFLICT DO NOTHING`,
          [huddle.id, pid],
        );
      }

      // External (non-app) attendees
      for (const ext of body.externalAttendees ?? []) {
        if (!ext.name || !ext.name.trim()) continue;
        await client.query(
          `INSERT INTO huddle_participants
             (huddle_id, user_id, role, attendance_status, external_name, external_email)
           VALUES ($1, NULL, 'participant', 'invited', $2, $3)`,
          [huddle.id, ext.name.trim(), ext.email?.trim() || null],
        );
      }

      // Carry forward open follow-ups owned by host on prior huddles in same workspace.
      if (body.workspaceId) {
        await client.query(
          `INSERT INTO huddle_followups (huddle_id, text, owner_user_id, review_date, status, carried_from_huddle_id)
           SELECT $1, fu.text, fu.owner_user_id, fu.review_date, 'open', fu.huddle_id
           FROM huddle_followups fu
           JOIN huddles f2 ON f2.id = fu.huddle_id
           WHERE f2.workspace_id = $2
             AND f2.id <> $1
             AND fu.status = 'open'
             AND f2.type = $3
             AND fu.owner_user_id IN (
               SELECT user_id FROM huddle_participants WHERE huddle_id = $1
             )`,
          [huddle.id, body.workspaceId, body.type],
        );
      }

      // Unresolved topics from the previous huddle in this series follow it in.
      await carryForwardTopics(client, huddle.id, huddle);

      await client.query('COMMIT');
      return reply.status(201).send({ huddle: formatHuddle(huddle) });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── Get full huddle detail ───────────────────────────────────────────────
  app.get('/huddles/:id', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);

    const [hostRow, parts, signals, topics, decisions, intentions, followups, notes] = await Promise.all([
      app.pg.query('SELECT name FROM users WHERE id = $1', [huddle.host_user_id]),
      app.pg.query(
        `SELECT p.*, u.name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar_url
         FROM huddle_participants p
         LEFT JOIN users u ON u.id = p.user_id
         WHERE p.huddle_id = $1
         ORDER BY p.role DESC, COALESCE(u.name, p.external_name) ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT s.*, u.name AS author_name
         FROM huddle_signals s
         LEFT JOIN users u ON u.id = s.author_user_id
         WHERE s.huddle_id = $1
         ORDER BY s.sort_order ASC, s.created_at ASC`,
        [id],
      ),
      agendaForHuddle(app.pg, id).then((rows) => ({ rows })),
      app.pg.query(
        `SELECT d.*, u.name AS owner_name
         FROM huddle_decisions d
         JOIN huddle_topics t ON t.id = d.huddle_topic_id
         LEFT JOIN users u ON u.id = d.owner_user_id
         WHERE d.huddle_id = $1
         ORDER BY d.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT i.*, u.name AS owner_name,
                tk.status AS linked_task_status, tk.due_date AS linked_task_due_date
         FROM huddle_intentions i
         LEFT JOIN users u ON u.id = i.owner_user_id
         LEFT JOIN tasks tk ON tk.id = i.linked_task_id
         WHERE i.huddle_id = $1
         ORDER BY i.sort_order ASC, i.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT f.*, u.name AS owner_name
         FROM huddle_followups f
         LEFT JOIN users u ON u.id = f.owner_user_id
         WHERE f.huddle_id = $1
         ORDER BY f.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT n.*, u.name AS author_name
         FROM huddle_notes n
         LEFT JOIN users u ON u.id = n.author_user_id
         WHERE n.huddle_id = $1
         ORDER BY n.created_at ASC`,
        [id],
      ),
    ]);

    const topicList = topics.rows.map(formatTopic);
    const decisionsByTopic = new Map<string, any[]>();
    for (const d of decisions.rows) {
      const arr = decisionsByTopic.get(d.huddle_topic_id) ?? [];
      arr.push(formatDecision(d));
      decisionsByTopic.set(d.huddle_topic_id, arr);
    }
    for (const t of topicList) {
      (t as any).decisions = decisionsByTopic.get(t.id) ?? [];
    }

    return {
      huddle: {
        ...formatHuddle(huddle),
        hostName: hostRow.rows[0]?.name ?? null,
        participants: parts.rows.map(formatParticipant),
        signals: signals.rows.map(formatSignal),
        topics: topicList,
        intentions: intentions.rows.map(formatIntention),
        followups: followups.rows.map(formatFollowup),
        notes: notes.rows.map(formatNote),
      },
    };
  });

  // ── Update huddle ────────────────────────────────────────────────────────
  app.put('/huddles/:id', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = updateHuddleSchema.parse(request.body);
    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (body.title !== undefined) { sets.push(`title = $${i++}`); params.push(body.title); }
    if (body.meetingType !== undefined) { sets.push(`meeting_type = $${i++}`); params.push(body.meetingType); }
    if (body.plannedDurationMinutes !== undefined) { sets.push(`planned_duration_minutes = $${i++}`); params.push(body.plannedDurationMinutes); }
    if (body.preReadUrl !== undefined) { sets.push(`pre_read_url = $${i++}`); params.push(body.preReadUrl); }
    if (body.intention !== undefined) { sets.push(`intention = $${i++}`); params.push(body.intention); }
    if (body.scheduledAt !== undefined) { sets.push(`scheduled_at = $${i++}`); params.push(body.scheduledAt); }
    if (body.emailSummaryOnClose !== undefined) {
      sets.push(`email_summary_on_close = $${i++}`); params.push(!!body.emailSummaryOnClose);
    }
    if (body.status !== undefined) {
      sets.push(`status = $${i++}`); params.push(body.status);
      if (body.status === 'active') sets.push(`started_at = COALESCE(started_at, now())`);
      if (body.status === 'closed') sets.push(`ended_at = COALESCE(ended_at, now())`);
    }
    if (sets.length === 0) return { huddle: formatHuddle(huddle) };
    sets.push(`updated_at = now()`);
    params.push(id);
    const r = await app.pg.query(`UPDATE huddles SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    return { huddle: formatHuddle(r.rows[0]) };
  });

  // ── Close huddle ─────────────────────────────────────────────────────────
  app.post('/huddles/:id/close', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = closeHuddleSchema.parse(request.body ?? {});
    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);

    // Allow caller to flip the auto-email flag at close-time. Defaults to the
    // huddle's existing setting (which may have been inherited from a template).
    const sets = [
      `status = 'closed'`,
      `ended_at = COALESCE(ended_at, now())`,
      `summary = COALESCE($2, summary)`,
      `updated_at = now()`,
    ];
    const params: any[] = [id, body.summary ?? null];
    if (body.emailSummaryToParticipants !== undefined) {
      params.push(!!body.emailSummaryToParticipants);
      sets.push(`email_summary_on_close = $${params.length}`);
    }

    const r = await app.pg.query(
      `UPDATE huddles SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    const closed = r.rows[0];

    // Record what state each agenda item was left in. A topic is no longer
    // copied per meeting, so this is what keeps a past huddle an accurate
    // account of what was true when it ended.
    await app.pg.query(
      `UPDATE huddle_agenda_items a
          SET outcome_state = t.status, updated_at = now()
         FROM huddle_topics t
        WHERE t.id = a.topic_id AND a.huddle_id = $1`,
      [id],
    );

    // Fire-and-forget: if auto-email is enabled and we haven't already sent
    // for this huddle, dispatch the summary email to participants. Errors are
    // logged but do not fail the close call.
    if (closed.email_summary_on_close && !closed.summary_emailed_at) {
      sendHuddleSummaryToParticipants(app, id, userId).catch((err) => {
        app.log.error({ err: (err as Error).message, huddleId: id }, 'huddle auto-email failed');
      });
    }

    return { huddle: formatHuddle(closed) };
  });

  // ── Export meeting minutes as Markdown ─────────────────────────────────
  // Generates a self-contained markdown document for sharing the huddle
  // outside the app. Any huddle member can export. The response is returned
  // as text/markdown with a Content-Disposition header so browsers offer to
  // download it.
  app.get('/huddles/:id/export.md', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);

    const [hostRow, parts, signals, topics, decisions, intentions, followups, notes] = await Promise.all([
      app.pg.query('SELECT name FROM users WHERE id = $1', [huddle.host_user_id]),
      app.pg.query(
        `SELECT p.*, u.name AS user_name, u.email AS user_email
         FROM huddle_participants p
         LEFT JOIN users u ON u.id = p.user_id
         WHERE p.huddle_id = $1
         ORDER BY p.role DESC, COALESCE(u.name, p.external_name) ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT s.*, u.name AS author_name
         FROM huddle_signals s
         LEFT JOIN users u ON u.id = s.author_user_id
         WHERE s.huddle_id = $1
         ORDER BY s.sort_order ASC, s.created_at ASC`,
        [id],
      ),
      agendaForHuddle(app.pg, id).then((rows) => ({ rows })),
      app.pg.query(
        `SELECT d.*, u.name AS owner_name
         FROM huddle_decisions d
         JOIN huddle_topics t ON t.id = d.huddle_topic_id
         LEFT JOIN users u ON u.id = d.owner_user_id
         WHERE d.huddle_id = $1
         ORDER BY d.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT i.*, u.name AS owner_name
         FROM huddle_intentions i
         LEFT JOIN users u ON u.id = i.owner_user_id
         WHERE i.huddle_id = $1
         ORDER BY i.sort_order ASC, i.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT f.*, u.name AS owner_name
         FROM huddle_followups f
         LEFT JOIN users u ON u.id = f.owner_user_id
         WHERE f.huddle_id = $1
         ORDER BY f.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT n.*, u.name AS author_name
         FROM huddle_notes n
         LEFT JOIN users u ON u.id = n.author_user_id
         WHERE n.huddle_id = $1
         ORDER BY n.created_at ASC`,
        [id],
      ),
    ]);

    const decisionsByTopic = new Map<string, any[]>();
    for (const d of decisions.rows) {
      const arr = decisionsByTopic.get(d.huddle_topic_id) ?? [];
      arr.push(d);
      decisionsByTopic.set(d.huddle_topic_id, arr);
    }

    const md = buildMinuteMarkdown({
      title: huddle.title,
      type: huddle.type,
      hostName: hostRow.rows[0]?.name ?? null,
      intention: huddle.intention,
      scheduledAt: huddle.scheduled_at,
      startedAt: huddle.started_at,
      endedAt: huddle.ended_at,
      participants: parts.rows,
      signals: signals.rows,
      topics: topics.rows,
      decisionsByTopic,
      intentions: intentions.rows,
      followups: followups.rows,
      notes: notes.rows,
      hostSummary: huddle.summary,
    });

    const safeName = (huddle.title || 'huddle').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 80);
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${safeName}.md"`)
      .send(md);
  });

  // ── Manual email-summary endpoint ───────────────────────────────────────
  // Lets the host email the summary to participants on demand (e.g. from the
  // share modal) — even if the huddle wasn't configured to auto-email on close.
  app.post('/huddles/:id/email-summary', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = z.object({
      includeShareLink: z.boolean().optional().default(true),
    }).parse(request.body ?? {});

    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);
    if (huddle.status !== 'closed') {
      throw new BadRequestError('Close the huddle before emailing the summary.');
    }
    const result = await sendHuddleSummaryToParticipants(app, id, userId, {
      includeShareLink: body.includeShareLink,
    });
    return result;
  });

  // ── Opening review ─────────────────────────────────────────────────────
  // Every agenda should start by facing last time's commitments, so this
  // returns the previous meeting's action items with their live tracker state.
  app.get('/huddles/:id/opening-review', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);

    const prev = await app.pg.query(
      huddle.template_id
        ? `SELECT id, title FROM huddles
            WHERE template_id = $1 AND id <> $2 AND status = 'closed'
            ORDER BY COALESCE(ended_at, scheduled_at, created_at) DESC LIMIT 1`
        : `SELECT id, title FROM huddles
            WHERE COALESCE(workspace_id::text, host_user_id::text) = $1
              AND id <> $2 AND status = 'closed'
            ORDER BY COALESCE(ended_at, scheduled_at, created_at) DESC LIMIT 1`,
      [huddle.template_id ?? (huddle.workspace_id ?? huddle.host_user_id), id],
    );
    if (prev.rows.length === 0) {
      return { previousHuddle: null, actionItems: [], summary: { total: 0, done: 0, overdue: 0 } };
    }

    const today = new Date().toISOString().slice(0, 10);
    const items = await app.pg.query(
      `SELECT i.id, i.text, i.status, i.due_date, i.linked_task_id,
              tk.status AS task_status, tk.due_date AS task_due_date,
              u.name AS owner_name
         FROM huddle_intentions i
         LEFT JOIN tasks tk ON tk.id = i.linked_task_id
         LEFT JOIN users u ON u.id = i.owner_user_id
        WHERE i.huddle_id = $1
        ORDER BY i.sort_order ASC, i.created_at ASC`,
      [prev.rows[0].id],
    );

    const actionItems = items.rows.map((a: any) => {
      const due = a.task_due_date ?? a.due_date ?? null;
      const dueStr = due ? new Date(due).toISOString().slice(0, 10) : null;
      const done = a.task_status === 'done' || a.status === 'done';
      return {
        id: a.id, text: a.text, ownerName: a.owner_name ?? null,
        dueDate: dueStr, done,
        overdue: !done && !!dueStr && dueStr < today,
        tracked: !!a.linked_task_id,
        taskStatus: a.task_status ?? null,
      };
    });

    return {
      previousHuddle: { id: prev.rows[0].id, title: prev.rows[0].title },
      actionItems,
      summary: {
        total: actionItems.length,
        done: actionItems.filter((a) => a.done).length,
        overdue: actionItems.filter((a) => a.overdue).length,
      },
    };
  });

  // ── Read-back before closing ───────────────────────────────────────────
  // What the host must confirm: everything this meeting actually captured.
  app.get('/huddles/:id/read-back', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    await loadHuddleOrThrow(app, id, userId);

    const [decisions, actions, unresolved] = await Promise.all([
      app.pg.query(
        `SELECT d.decision_text, d.decision_type, t.title AS topic_title, u.name AS owner_name
           FROM huddle_decisions d
           JOIN huddle_topics t ON t.id = d.huddle_topic_id
           LEFT JOIN users u ON u.id = d.owner_user_id
          WHERE d.huddle_id = $1 ORDER BY d.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT i.text, i.due_date, i.linked_task_id, u.name AS owner_name
           FROM huddle_intentions i
           LEFT JOIN users u ON u.id = i.owner_user_id
          WHERE i.huddle_id = $1 ORDER BY i.sort_order ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT t.title, t.status, t.defer_count
           FROM huddle_agenda_items a JOIN huddle_topics t ON t.id = a.topic_id
          WHERE a.huddle_id = $1 AND t.status = ANY($2::text[])
          ORDER BY a.sort_order ASC`,
        [id, [...TOPIC_LIVE]],
      ),
    ]);

    const actionItems = actions.rows.map((a: any) => ({
      text: a.text,
      ownerName: a.owner_name ?? null,
      dueDate: a.due_date ? new Date(a.due_date).toISOString().slice(0, 10) : null,
      tracked: !!a.linked_task_id,
    }));

    return {
      decisions: decisions.rows.map((d: any) => ({
        decisionText: d.decision_text,
        decisionType: d.decision_type,
        topicTitle: d.topic_title,
        ownerName: d.owner_name ?? null,
      })),
      actionItems,
      // Surfaced so nothing silently rolls forward without being noticed.
      unresolvedTopics: unresolved.rows.map((t: any) => ({
        title: t.title, status: t.status, deferCount: t.defer_count ?? 0,
      })),
      // An action item with no owner or no date will not survive the week.
      warnings: [
        ...actionItems.filter((a) => !a.ownerName).map((a) => `"${a.text}" has no owner`),
        ...actionItems.filter((a) => !a.dueDate).map((a) => `"${a.text}" has no due date`),
      ],
    };
  });

  // ── Invites ────────────────────────────────────────────────────────────
  // Emails everyone on the huddle who has an address — app users and external
  // guests alike. Explicit rather than automatic on create: huddles start as
  // drafts and are often set up well before anyone should be told about them.
  app.post('/huddles/:id/invite', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = z.object({
      // Re-inviting is allowed; this only narrows the send when set.
      onlyExternal: z.boolean().optional().default(false),
    }).parse(request.body ?? {});

    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);

    const [hostRow, recipients, topics] = await Promise.all([
      app.pg.query('SELECT name FROM users WHERE id = $1', [huddle.host_user_id]),
      app.pg.query(
        `SELECT u.email AS email, u.name AS name, false AS is_external
           FROM huddle_participants p
           JOIN users u ON u.id = p.user_id
          WHERE p.huddle_id = $1 AND p.user_id <> $2 AND COALESCE(u.email, '') <> ''
         UNION ALL
         SELECT p.external_email AS email, p.external_name AS name, true AS is_external
           FROM huddle_participants p
          WHERE p.huddle_id = $1 AND p.user_id IS NULL
            AND COALESCE(p.external_email, '') <> ''`,
        [id, huddle.host_user_id],
      ),
      app.pg.query(
        `SELECT t.title FROM huddle_agenda_items a
           JOIN huddle_topics t ON t.id = a.topic_id
          WHERE a.huddle_id = $1
            AND t.status IN ('proposed','scheduled','in_discussion','awaiting_decision','deferred')
          ORDER BY a.sort_order ASC, t.created_at ASC LIMIT 12`,
        [id],
      ),
    ]);

    const base = (getEnv().APP_URL ?? '').replace(/\/$/, '');
    const topicTitles = topics.rows.map((t: any) => t.title);
    const sentTo: string[] = [];
    const failed: string[] = [];

    for (const r of recipients.rows) {
      if (body.onlyExternal && !r.is_external) continue;
      const tpl = huddleInviteEmail({
        huddleTitle: huddle.title,
        hostName: hostRow.rows[0]?.name ?? null,
        intention: huddle.intention,
        scheduledAt: huddle.scheduled_at,
        topics: topicTitles,
        // External guests have no account, so an app link would dead-end them.
        huddleUrl: r.is_external || !base ? null : `${base}/huddles/${id}`,
        isExternal: !!r.is_external,
      });
      const ok = await sendMail(
        { to: r.email, subject: tpl.subject, text: tpl.text, html: tpl.html },
        app.log,
      );
      (ok ? sentTo : failed).push(r.email);
    }

    return { sentTo, failed, total: sentTo.length + failed.length };
  });

  // ── Participants ───────────────────────────────────────────────────────
  app.post('/huddles/:id/participants', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = addParticipantSchema.parse(request.body);
    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);

    if ('userId' in body) {
      const r = await app.pg.query(
        `INSERT INTO huddle_participants (huddle_id, user_id, role, attendance_status)
         VALUES ($1, $2, $3, 'invited')
         ON CONFLICT (huddle_id, user_id) WHERE user_id IS NOT NULL
         DO UPDATE SET role = EXCLUDED.role
         RETURNING *`,
        [id, body.userId, body.role],
      );
      return reply.status(201).send({ participant: formatParticipant(r.rows[0]) });
    }

    const r = await app.pg.query(
      `INSERT INTO huddle_participants
         (huddle_id, user_id, role, attendance_status, external_name, external_email)
       VALUES ($1, NULL, $2, 'invited', $3, $4)
       RETURNING *`,
      [id, body.role, body.externalName.trim(), body.externalEmail?.trim() || null],
    );
    return reply.status(201).send({ participant: formatParticipant(r.rows[0]) });
  });

  app.post('/huddles/:id/check-in', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    await loadHuddleOrThrow(app, id, userId);

    const r = await app.pg.query(
      `INSERT INTO huddle_participants (huddle_id, user_id, role, attendance_status, checked_in_at)
       VALUES ($1, $2, 'participant', 'present', now())
       ON CONFLICT (huddle_id, user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET attendance_status = 'present', checked_in_at = now()
       RETURNING *`,
      [id, userId],
    );
    return { participant: formatParticipant(r.rows[0]) };
  });

  app.put('/huddles/:id/participants/:pid', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, pid } = request.params as { id: string; pid: string };
    const body = updateParticipantSchema.parse(request.body);
    const huddle = await loadHuddleOrThrow(app, id, userId);

    // Self can update own attendance; only host can change role / others
    const target = await app.pg.query('SELECT * FROM huddle_participants WHERE id = $1 AND huddle_id = $2', [pid, id]);
    if (target.rows.length === 0) throw new NotFoundError('Participant not found');
    const tp = target.rows[0];
    const isSelf = tp.user_id === userId;
    if (!isSelf && huddle.host_user_id !== userId) throw new ForbiddenError();
    if (body.role && huddle.host_user_id !== userId) throw new ForbiddenError('Only host can change roles');

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (body.role) { sets.push(`role = $${i++}`); params.push(body.role); }
    if (body.isRequired !== undefined) { sets.push(`is_required = $${i++}`); params.push(body.isRequired); }
    if (body.isDecider !== undefined) { sets.push(`is_decider = $${i++}`); params.push(body.isDecider); }
    if (body.attendanceStatus) {
      sets.push(`attendance_status = $${i++}`); params.push(body.attendanceStatus);
      if (body.attendanceStatus === 'present') sets.push(`checked_in_at = COALESCE(checked_in_at, now())`);
    }
    if (sets.length === 0) return { participant: formatParticipant(tp) };
    params.push(pid);
    const r = await app.pg.query(`UPDATE huddle_participants SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    return { participant: formatParticipant(r.rows[0]) };
  });

  app.delete('/huddles/:id/participants/:pid', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, pid } = request.params as { id: string; pid: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);
    await app.pg.query('DELETE FROM huddle_participants WHERE id = $1 AND huddle_id = $2 AND role <> $3', [pid, id, 'host']);
    return reply.status(204).send();
  });

  // ── Signals ────────────────────────────────────────────────────────────
  app.post('/huddles/:id/signals', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = createSignalSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const orderRes = await app.pg.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM huddle_signals WHERE huddle_id = $1`, [id],
    );
    const r = await app.pg.query(
      `INSERT INTO huddle_signals (huddle_id, author_user_id, text, why_it_matters, details, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, userId, body.text, body.whyItMatters ?? null, body.details ?? null, orderRes.rows[0].next],
    );
    return reply.status(201).send({ signal: formatSignal(r.rows[0]) });
  });

  app.put('/huddles/:id/signals/reorder', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = reorderSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      for (let idx = 0; idx < body.orderedIds.length; idx++) {
        await client.query(
          `UPDATE huddle_signals SET sort_order = $1 WHERE id = $2 AND huddle_id = $3`,
          [idx, body.orderedIds[idx], id],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  app.put('/huddles/:id/signals/:sid/promote', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, sid } = request.params as { id: string; sid: string };
    await loadHuddleOrThrow(app, id, userId);

    const sig = await app.pg.query('SELECT * FROM huddle_signals WHERE id = $1 AND huddle_id = $2', [sid, id]);
    if (sig.rows.length === 0) throw new NotFoundError('Signal not found');
    const s = sig.rows[0];

    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const topicRes = await client.query(
        `INSERT INTO huddle_topics
           (origin_huddle_id, title, context, source_signal_id, status, first_discussed_at)
         VALUES ($1, $2, $3, $4, 'scheduled', now()) RETURNING *`,
        [id, s.text, s.why_it_matters, sid],
      );
      await addToAgenda(client, id, topicRes.rows[0].id);
      await client.query(`UPDATE huddle_signals SET promoted_to_topic = true WHERE id = $1`, [sid]);
      await client.query('COMMIT');
      return { topic: formatTopic(topicRes.rows[0]) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.delete('/huddles/:id/signals/:sid', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, sid } = request.params as { id: string; sid: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);
    const sig = await app.pg.query('SELECT * FROM huddle_signals WHERE id = $1 AND huddle_id = $2', [sid, id]);
    if (sig.rows.length === 0) throw new NotFoundError('Signal not found');
    if (sig.rows[0].author_user_id !== userId && huddle.host_user_id !== userId) throw new ForbiddenError();
    await app.pg.query('DELETE FROM huddle_signals WHERE id = $1', [sid]);
    return reply.status(204).send();
  });

  app.put('/huddles/:id/signals/:sid', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, sid } = request.params as { id: string; sid: string };
    const body = updateSignalSchema.parse(request.body);
    const huddle = await loadHuddleOrThrow(app, id, userId);
    const sig = await app.pg.query('SELECT * FROM huddle_signals WHERE id = $1 AND huddle_id = $2', [sid, id]);
    if (sig.rows.length === 0) throw new NotFoundError('Signal not found');
    if (sig.rows[0].author_user_id !== userId && huddle.host_user_id !== userId) throw new ForbiddenError();
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (body.text !== undefined) { sets.push(`text = $${i++}`); params.push(body.text); }
    if (body.whyItMatters !== undefined) { sets.push(`why_it_matters = $${i++}`); params.push(body.whyItMatters); }
    if (body.details !== undefined) { sets.push(`details = $${i++}`); params.push(body.details); }
    if (sets.length === 0) return { signal: formatSignal(sig.rows[0]) };
    params.push(sid);
    const r = await app.pg.query(
      `UPDATE huddle_signals SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params,
    );
    return { signal: formatSignal(r.rows[0]) };
  });

  // ── Topics ─────────────────────────────────────────────────────────────
  app.post('/huddles/:id/topics', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = createTopicSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);

    // A topic with purpose 'decide' has to have someone who can call it.
    if (body.purpose === 'decide' && !body.approverUserId) {
      throw new BadRequestError('A topic for deciding needs a decider before it goes on an agenda');
    }

    const r = await app.pg.query(
      `INSERT INTO huddle_topics
         (origin_huddle_id, title, context, details, source_signal_id, parent_topic_id,
          owner_user_id, approver_user_id, purpose, framing_question, timebox_minutes,
          status, first_discussed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'scheduled', now()) RETURNING *`,
      [
        id, body.title, body.context ?? null, body.details ?? null,
        body.sourceSignalId ?? null, body.parentTopicId ?? null,
        body.ownerUserId ?? null, body.approverUserId ?? null,
        body.purpose ?? 'discuss', body.framingQuestion ?? null,
        body.timeboxMinutes ?? null,
      ],
    );
    await addToAgenda(app.pg, id, r.rows[0].id, body.timeboxMinutes ?? null);
    return reply.status(201).send({ topic: formatTopic(await agendaTopic(app.pg, id, r.rows[0].id)) });
  });

  app.put('/huddles/:id/topics/reorder', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = reorderSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      for (let idx = 0; idx < body.orderedIds.length; idx++) {
        await client.query(
          `UPDATE huddle_agenda_items SET sort_order = $1, updated_at = now()
            WHERE topic_id = $2 AND huddle_id = $3`,
          [idx, body.orderedIds[idx], id],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  app.put('/huddles/:id/topics/:tid', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, tid } = request.params as { id: string; tid: string };
    const body = updateTopicSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (body.title !== undefined) { sets.push(`title = $${i++}`); params.push(body.title); }
    if (body.context !== undefined) { sets.push(`context = $${i++}`); params.push(body.context); }
    if (body.details !== undefined) { sets.push(`details = $${i++}`); params.push(body.details); }
    if (body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); params.push(body.sortOrder); }
    if (body.purpose !== undefined) { sets.push(`purpose = $${i++}`); params.push(body.purpose); }
    if (body.framingQuestion !== undefined) { sets.push(`framing_question = $${i++}`); params.push(body.framingQuestion); }
    if (body.timeboxMinutes !== undefined) { sets.push(`timebox_minutes = $${i++}`); params.push(body.timeboxMinutes); }
    if (body.horizon !== undefined) { sets.push(`horizon = $${i++}`); params.push(body.horizon); }
    if (body.ownerUserId !== undefined) { sets.push(`owner_user_id = $${i++}`); params.push(body.ownerUserId); }
    if (body.approverUserId !== undefined) { sets.push(`approver_user_id = $${i++}`); params.push(body.approverUserId); }
    if (body.parentTopicId !== undefined) {
      if (body.parentTopicId === tid) throw new BadRequestError('A topic cannot be its own parent');
      sets.push(`parent_topic_id = $${i++}`); params.push(body.parentTopicId);
    }
    if (body.status !== undefined) {
      sets.push(`status = $${i++}`); params.push(body.status);
      // Keep the terminal-state bookkeeping consistent however the status is
      // set, so a plain PUT can't leave a closed topic without a closed_at.
      if ((TOPIC_LIVE as readonly string[]).includes(body.status)) {
        sets.push(`closed_at = NULL`, `closed_by_user_id = NULL`);
      } else {
        sets.push(`closed_at = COALESCE(closed_at, now())`);
        sets.push(`closed_by_user_id = $${i++}`); params.push(userId);
      }
    }
    if (sets.length === 0) return { topic: await topicWithNames(tid, id) };
    sets.push(`updated_at = now()`);
    params.push(tid, id);
    const r = await app.pg.query(
      `UPDATE huddle_topics SET ${sets.join(', ')} WHERE id = $${i++} AND huddle_id = $${i} RETURNING id`, params,
    );
    if (r.rows.length === 0) throw new NotFoundError('Topic not found');
    return { topic: await topicWithNames(tid, id) };
  });

  app.delete('/huddles/:id/topics/:tid', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, tid } = request.params as { id: string; tid: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);
    const r = await app.pg.query(
      'DELETE FROM huddle_agenda_items WHERE topic_id = $1 AND huddle_id = $2 RETURNING id',
      [tid, id],
    );
    if (r.rows.length === 0) throw new NotFoundError('Topic not found on this agenda');
    // Only drop the topic itself once it is on no agenda at all, so removing it
    // from one meeting never erases its history from the others.
    await app.pg.query(
      `DELETE FROM huddle_topics t
        WHERE t.id = $1
          AND NOT EXISTS (SELECT 1 FROM huddle_agenda_items a WHERE a.topic_id = t.id)`,
      [tid],
    );
    return reply.status(204).send();
  });

  app.delete('/huddles/:id/decisions/:did', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, did } = request.params as { id: string; did: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);
    const r = await app.pg.query(
      `DELETE FROM huddle_decisions d
       USING huddle_topics t
       WHERE d.id = $1 AND d.huddle_topic_id = t.id AND d.huddle_id = $2
       RETURNING d.id`,
      [did, id],
    );
    if (r.rows.length === 0) throw new NotFoundError('Decision not found');
    return reply.status(204).send();
  });

  app.delete('/huddles/:id/intentions/:iid', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, iid } = request.params as { id: string; iid: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);
    const cur = await app.pg.query(
      'SELECT owner_user_id FROM huddle_intentions WHERE id = $1 AND huddle_id = $2',
      [iid, id],
    );
    if (cur.rows.length === 0) throw new NotFoundError('Intention not found');
    if (cur.rows[0].owner_user_id !== userId && huddle.host_user_id !== userId) throw new ForbiddenError();
    await app.pg.query('DELETE FROM huddle_intentions WHERE id = $1', [iid]);
    return reply.status(204).send();
  });

  app.delete('/huddles/:id/followups/:fid', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, fid } = request.params as { id: string; fid: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);
    const cur = await app.pg.query(
      'SELECT owner_user_id FROM huddle_followups WHERE id = $1 AND huddle_id = $2',
      [fid, id],
    );
    if (cur.rows.length === 0) throw new NotFoundError('Follow-up not found');
    if (cur.rows[0].owner_user_id !== userId && huddle.host_user_id !== userId) throw new ForbiddenError();
    await app.pg.query('DELETE FROM huddle_followups WHERE id = $1', [fid]);
    return reply.status(204).send();
  });

  app.post('/huddles/:id/topics/:tid/decide', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, tid } = request.params as { id: string; tid: string };
    const body = decideTopicSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);

    const t = await app.pg.query(
      `SELECT t.* FROM huddle_topics t
         JOIN huddle_agenda_items a ON a.topic_id = t.id
        WHERE t.id = $1 AND a.huddle_id = $2`,
      [tid, id],
    );
    if (t.rows.length === 0) throw new NotFoundError('Topic not found on this agenda');

    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const dec = await client.query(
        // huddle_id records which meeting actually made the call — a topic can
        // now span several, so it can no longer be inferred from the topic.
        `INSERT INTO huddle_decisions
           (huddle_topic_id, huddle_id, owner_user_id, decision_text, details,
            rationale, decision_type, affected_parties, supersedes_decision_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [tid, id, body.ownerUserId ?? null, body.decisionText, body.details ?? null,
         body.rationale ?? null, body.decisionType ?? null,
         body.affectedParties ?? null, body.supersedesDecisionId ?? null],
      );
      // Recording a decision closes the topic. The non-empty decision log is
      // what makes it render as "Decided" rather than plain "Closed".
      await client.query(
        `UPDATE huddle_topics
            SET status = 'closed',
                closed_at = COALESCE(closed_at, now()), closed_by_user_id = $2,
                updated_at = now()
          WHERE id = $1`,
        [tid, userId],
      );
      await client.query('COMMIT');
      return reply.status(201).send({ decision: formatDecision(dec.rows[0]) });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── Topic lifecycle transitions ────────────────────────────────────────
  // Re-reads the row with owner/approver names joined so the response matches
  // the shape the detail endpoint returns.
  async function topicWithNames(topicId: string, huddleId: string) {
    const r = await app.pg.query(
      `${AGENDA_SELECT} WHERE a.topic_id = $1 AND a.huddle_id = $2`,
      [topicId, huddleId],
    );
    if (r.rows.length === 0) throw new NotFoundError('Topic not found');
    return formatTopic(r.rows[0]);
  }

  // Deferred: needs more time or info, comes back next huddle as-is.
  // Passing horizon='long_term' moves it out of the weekly rotation entirely —
  // the escalation exit for topics that matter but aren't this week's problem.
  app.post('/huddles/:id/topics/:tid/defer', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, tid } = request.params as { id: string; tid: string };
    const body = deferTopicSchema.parse(request.body ?? {});
    await loadHuddleOrThrow(app, id, userId);
    const r = await app.pg.query(
      `UPDATE huddle_topics
          SET status = 'deferred',
              horizon = COALESCE($3, horizon),
              closed_at = NULL, closed_by_user_id = NULL,
              updated_at = now()
        WHERE id = $1 AND EXISTS (SELECT 1 FROM huddle_agenda_items a
                 WHERE a.topic_id = huddle_topics.id AND a.huddle_id = $2) RETURNING id`,
      [tid, id, body?.horizon ?? null],
    );
    if (r.rows.length === 0) throw new NotFoundError('Topic not found');
    return { topic: await topicWithNames(tid, id) };
  });

  // Needs a decision: pending on a named decision-maker. The approver is the
  // DACI-style "who can actually call this" — a topic stuck here usually has
  // an owner and no approver, which is precisely why it keeps deferring.
  app.post('/huddles/:id/topics/:tid/needs-decision', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, tid } = request.params as { id: string; tid: string };
    const body = needsDecisionSchema.parse(request.body ?? {});
    await loadHuddleOrThrow(app, id, userId);
    const r = await app.pg.query(
      `UPDATE huddle_topics
          SET status = 'awaiting_decision',
              approver_user_id = COALESCE($3, approver_user_id),
              owner_user_id    = COALESCE($4, owner_user_id),
              closed_at = NULL, closed_by_user_id = NULL,
              updated_at = now()
        WHERE id = $1 AND EXISTS (SELECT 1 FROM huddle_agenda_items a
                 WHERE a.topic_id = huddle_topics.id AND a.huddle_id = $2) RETURNING id`,
      [tid, id, body?.approverUserId ?? null, body?.ownerUserId ?? null],
    );
    if (r.rows.length === 0) throw new NotFoundError('Topic not found');
    return { topic: await topicWithNames(tid, id) };
  });

  // Leaves the loop. outcome='closed' means resolved (renders as "Decided"
  // when the decision log is non-empty); 'cancelled' means no longer relevant.
  app.post('/huddles/:id/topics/:tid/close', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, tid } = request.params as { id: string; tid: string };
    const body = closeTopicSchema.parse(request.body ?? {});
    await loadHuddleOrThrow(app, id, userId);
    const r = await app.pg.query(
      `UPDATE huddle_topics
          SET status = $3,
              closed_at = COALESCE(closed_at, now()), closed_by_user_id = $4,
              updated_at = now()
        WHERE id = $1 AND EXISTS (SELECT 1 FROM huddle_agenda_items a
                 WHERE a.topic_id = huddle_topics.id AND a.huddle_id = $2) RETURNING id`,
      [tid, id, body?.outcome ?? 'closed', userId],
    );
    if (r.rows.length === 0) throw new NotFoundError('Topic not found');
    return { topic: await topicWithNames(tid, id) };
  });

  app.put('/huddles/:id/decisions/:did', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, did } = request.params as { id: string; did: string };
    const body = updateDecisionSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const cur = await app.pg.query(
      `SELECT d.* FROM huddle_decisions d
         JOIN huddle_topics t ON t.id = d.huddle_topic_id
         WHERE d.id = $1 AND d.huddle_id = $2`,
      [did, id],
    );
    if (cur.rows.length === 0) throw new NotFoundError('Decision not found');
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (body.decisionText !== undefined) { sets.push(`decision_text = $${i++}`); params.push(body.decisionText); }
    if (body.rationale !== undefined) { sets.push(`rationale = $${i++}`); params.push(body.rationale); }
    if (body.decisionType !== undefined) { sets.push(`decision_type = $${i++}`); params.push(body.decisionType); }
    if (body.affectedParties !== undefined) { sets.push(`affected_parties = $${i++}`); params.push(body.affectedParties); }
    if (body.ownerUserId !== undefined) { sets.push(`owner_user_id = $${i++}`); params.push(body.ownerUserId); }
    if (body.details !== undefined) { sets.push(`details = $${i++}`); params.push(body.details); }
    if (sets.length === 0) return { decision: formatDecision(cur.rows[0]) };
    params.push(did);
    const r = await app.pg.query(
      `UPDATE huddle_decisions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params,
    );
    return { decision: formatDecision(r.rows[0]) };
  });

  // ── Intentions ─────────────────────────────────────────────────────────
  app.post('/huddles/:id/intentions', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = createIntentionSchema.parse(request.body);
    const huddle = await loadHuddleOrThrow(app, id, userId);
    const orderRes = await app.pg.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM huddle_intentions WHERE huddle_id = $1`, [id],
    );
    const r = await app.pg.query(
      `INSERT INTO huddle_intentions
         (huddle_id, text, owner_user_id, soft_due_text, due_date, topic_id, details, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        id, body.text, body.ownerUserId ?? userId, body.softDueText ?? null,
        body.dueDate ?? null, body.topicId ?? null,
        body.details ?? null, orderRes.rows[0].next,
      ],
    );
    let intention = r.rows[0];

    // Action items belong in the task tracker, so a huddle with a workspace
    // creates the task straight away and the huddle just references it.
    // Personal huddles have no workspace, so those stay local until converted.
    if (huddle.workspace_id) {
      try {
        await createTaskForIntention(app.pg, intention, huddle.workspace_id, userId);
        const re = await app.pg.query(
          `SELECT i.*, u.name AS owner_name,
                  tk.status AS linked_task_status, tk.due_date AS linked_task_due_date
             FROM huddle_intentions i
             LEFT JOIN users u ON u.id = i.owner_user_id
             LEFT JOIN tasks tk ON tk.id = i.linked_task_id
            WHERE i.id = $1`,
          [intention.id],
        );
        intention = re.rows[0];
      } catch (err) {
        // Keep the action item rather than losing what was typed; the explicit
        // Convert button remains available as a fallback.
        app.log.error(
          { err: (err as Error).message, intentionId: intention.id },
          'auto-convert of huddle action item to task failed',
        );
      }
    }

    return reply.status(201).send({ intention: formatIntention(intention) });
  });

  app.put('/huddles/:id/intentions/reorder', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = reorderSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      for (let idx = 0; idx < body.orderedIds.length; idx++) {
        await client.query(
          `UPDATE huddle_intentions SET sort_order = $1, updated_at = now() WHERE id = $2 AND huddle_id = $3`,
          [idx, body.orderedIds[idx], id],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  app.put('/huddles/:id/intentions/:iid', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, iid } = request.params as { id: string; iid: string };
    const body = updateIntentionSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (body.text !== undefined) { sets.push(`text = $${i++}`); params.push(body.text); }
    if (body.ownerUserId !== undefined) { sets.push(`owner_user_id = $${i++}`); params.push(body.ownerUserId); }
    if (body.softDueText !== undefined) { sets.push(`soft_due_text = $${i++}`); params.push(body.softDueText); }
    if (body.dueDate !== undefined) { sets.push(`due_date = $${i++}`); params.push(body.dueDate); }
    if (body.topicId !== undefined) { sets.push(`topic_id = $${i++}`); params.push(body.topicId); }
    if (body.details !== undefined) { sets.push(`details = $${i++}`); params.push(body.details); }
    if (body.status !== undefined) { sets.push(`status = $${i++}`); params.push(body.status); }
    if (sets.length === 0) {
      const cur = await app.pg.query('SELECT * FROM huddle_intentions WHERE id = $1 AND huddle_id = $2', [iid, id]);
      if (cur.rows.length === 0) throw new NotFoundError('Intention not found');
      return { intention: formatIntention(cur.rows[0]) };
    }
    sets.push(`updated_at = now()`);
    params.push(iid, id);
    const r = await app.pg.query(
      `UPDATE huddle_intentions SET ${sets.join(', ')} WHERE id = $${i++} AND huddle_id = $${i} RETURNING *`, params,
    );
    if (r.rows.length === 0) throw new NotFoundError('Intention not found');
    return { intention: formatIntention(r.rows[0]) };
  });

  app.post('/huddles/:id/intentions/:iid/complete', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, iid } = request.params as { id: string; iid: string };
    await loadHuddleOrThrow(app, id, userId);
    const r = await app.pg.query(
      `UPDATE huddle_intentions SET status = 'done', updated_at = now()
       WHERE id = $1 AND huddle_id = $2 RETURNING *`,
      [iid, id],
    );
    if (r.rows.length === 0) throw new NotFoundError('Intention not found');
    // If linked to task, mark task done too
    if (r.rows[0].linked_task_id) {
      await app.pg.query(
        `UPDATE tasks SET status = 'done', completed_at = COALESCE(completed_at, now()),
                          next_action_state = 'done'
         WHERE id = $1 AND status != 'done'`,
        [r.rows[0].linked_task_id],
      );
    }
    return { intention: formatIntention(r.rows[0]) };
  });

  // Convert intention into a Zentra task
  app.post('/huddles/:id/intentions/:iid/convert', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, iid } = request.params as { id: string; iid: string };
    const body = convertIntentionSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    await checkWorkspaceMember(app, body.workspaceId, userId);

    const intentionRes = await app.pg.query(
      'SELECT * FROM huddle_intentions WHERE id = $1 AND huddle_id = $2', [iid, id],
    );
    if (intentionRes.rows.length === 0) throw new NotFoundError('Intention not found');
    const intent = intentionRes.rows[0];
    if (intent.linked_task_id) {
      return { intention: formatIntention(intent), alreadyLinked: true };
    }

    const taskId = await createTaskForIntention(
      app.pg, intent, body.workspaceId, userId, body.priorityForToday,
    );
    const updated = await app.pg.query(
      `SELECT i.*, u.name AS owner_name,
              tk.status AS linked_task_status, tk.due_date AS linked_task_due_date
         FROM huddle_intentions i
         LEFT JOIN users u ON u.id = i.owner_user_id
         LEFT JOIN tasks tk ON tk.id = i.linked_task_id
        WHERE i.id = $1`,
      [iid],
    );
    return reply.status(201).send({ intention: formatIntention(updated.rows[0]), taskId });
  });

  // ── Follow-ups ─────────────────────────────────────────────────────────
  app.post('/huddles/:id/followups', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = createFollowupSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const r = await app.pg.query(
      `INSERT INTO huddle_followups (huddle_id, text, owner_user_id, review_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, body.text, body.ownerUserId ?? userId, body.reviewDate ?? null],
    );
    return reply.status(201).send({ followup: formatFollowup(r.rows[0]) });
  });

  app.put('/huddles/:id/followups/:fid', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, fid } = request.params as { id: string; fid: string };
    const body = updateFollowupSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (body.text !== undefined) { sets.push(`text = $${i++}`); params.push(body.text); }
    if (body.reviewDate !== undefined) { sets.push(`review_date = $${i++}`); params.push(body.reviewDate); }
    if (body.status !== undefined) { sets.push(`status = $${i++}`); params.push(body.status); }
    if (sets.length === 0) {
      const cur = await app.pg.query('SELECT * FROM huddle_followups WHERE id = $1 AND huddle_id = $2', [fid, id]);
      if (cur.rows.length === 0) throw new NotFoundError('Follow-up not found');
      return { followup: formatFollowup(cur.rows[0]) };
    }
    sets.push(`updated_at = now()`);
    params.push(fid, id);
    const r = await app.pg.query(
      `UPDATE huddle_followups SET ${sets.join(', ')} WHERE id = $${i++} AND huddle_id = $${i} RETURNING *`, params,
    );
    if (r.rows.length === 0) throw new NotFoundError('Follow-up not found');
    return { followup: formatFollowup(r.rows[0]) };
  });

  // ── Notes ──────────────────────────────────────────────────────────────
  app.post('/huddles/:id/notes', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = createNoteSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const r = await app.pg.query(
      `INSERT INTO huddle_notes (huddle_id, author_user_id, text)
       VALUES ($1, $2, $3) RETURNING *`,
      [id, userId, body.text],
    );
    return reply.status(201).send({ note: formatNote(r.rows[0]) });
  });

  // ── Series report for a template ────────────────────────────────────────
  // A template is the identity of a recurring meeting, so this reports on the
  // series rather than any single huddle. Only captures huddles created after
  // huddles.template_id shipped (052) — earlier ones can't be back-linked.
  app.get('/huddles/templates/:tid/report', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { tid } = request.params as { tid: string };

    const tr = await app.pg.query(
      `SELECT * FROM huddle_templates WHERE id = $1 AND owner_user_id = $2`,
      [tid, userId],
    );
    if (tr.rows.length === 0) throw new NotFoundError('Template not found');
    const tpl = tr.rows[0];

    const huddlesRes = await app.pg.query(
      `SELECT id, title, status, scheduled_at, started_at, ended_at, created_at,
              meeting_type, planned_duration_minutes
         FROM huddles WHERE template_id = $1
        ORDER BY COALESCE(ended_at, scheduled_at, created_at) ASC`,
      [tid],
    );
    const huddleIds = huddlesRes.rows.map((h: any) => h.id);

    if (huddleIds.length === 0) {
      return {
        template: { id: tpl.id, name: tpl.name, type: tpl.type },
        huddles: [], openTopics: [], escalations: [], longTerm: [],
        decisions: [], actionItems: [],
        stats: { huddleCount: 0, opened: 0, closed: 0, cancelled: 0, medianDaysToClose: null },
      };
    }

    // One row per topic now, however many meetings it appeared on — so the
    // recursive chain walk and the "superseded copy" filter this used to need
    // are both gone. Age comes straight off first_discussed_at.
    const [topicsRes, decisionsRes, actionsRes, closedRes] = await Promise.all([
      app.pg.query(
        `SELECT DISTINCT ON (t.id)
                t.id, t.title, t.status, t.horizon, t.defer_count, t.purpose,
                COALESCE(t.first_discussed_at, t.created_at) AS first_raised,
                EXTRACT(DAY FROM (now() - COALESCE(t.first_discussed_at, t.created_at)))::int AS age_days,
                last_seen.huddle_id AS huddle_id,
                last_seen.huddle_title,
                (SELECT count(*) FROM huddle_agenda_items ai WHERE ai.topic_id = t.id)::int AS meeting_count,
                uo.name AS owner_name, ua.name AS approver_name,
                EXISTS (SELECT 1 FROM huddle_topics c
                         WHERE c.parent_topic_id = t.id
                           AND c.status = ANY($2::text[])) AS has_open_child
           FROM huddle_topics t
           JOIN LATERAL (
             SELECT a.huddle_id, h.title AS huddle_title
               FROM huddle_agenda_items a
               JOIN huddles h ON h.id = a.huddle_id
              WHERE a.topic_id = t.id AND a.huddle_id = ANY($1::uuid[])
              ORDER BY COALESCE(h.ended_at, h.scheduled_at, h.created_at) DESC
              LIMIT 1
           ) last_seen ON true
           LEFT JOIN users uo ON uo.id = t.owner_user_id
           LEFT JOIN users ua ON ua.id = t.approver_user_id`,
        [huddleIds, [...TOPIC_LIVE]],
      ),
      app.pg.query(
        // The decision's own huddle_id is now authoritative for which meeting
        // made the call; the topic may have appeared at several.
        `SELECT d.decision_text, d.created_at, t.title AS topic_title,
                h.title AS huddle_title, u.name AS owner_name
           FROM huddle_decisions d
           JOIN huddle_topics t ON t.id = d.huddle_topic_id
           JOIN huddles h ON h.id = d.huddle_id
           LEFT JOIN users u ON u.id = d.owner_user_id
          WHERE d.huddle_id = ANY($1::uuid[])
          ORDER BY d.created_at ASC`,
        [huddleIds],
      ),
      // Follow-through: the huddle only references the task, so the tracker is
      // the source of truth for whether the work actually happened.
      app.pg.query(
        `SELECT i.text, i.status AS intention_status, i.linked_task_id,
                i.due_date, i.soft_due_text,
                tk.status AS task_status, tk.due_date AS task_due_date,
                tk.completed_at, u.name AS owner_name, h.title AS huddle_title
           FROM huddle_intentions i
           JOIN huddles h ON h.id = i.huddle_id
           LEFT JOIN tasks tk ON tk.id = i.linked_task_id
           LEFT JOIN users u ON u.id = i.owner_user_id
          WHERE i.huddle_id = ANY($1::uuid[])
          ORDER BY i.created_at ASC`,
        [huddleIds],
      ),
      app.pg.query(
        // Time to close now runs from when the topic was first discussed, not
        // when the last copy of it was created.
        `SELECT percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM
                    (t.closed_at - COALESCE(t.first_discussed_at, t.created_at))) / 86400.0
                ) AS median_days
           FROM huddle_topics t
          WHERE t.closed_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM huddle_agenda_items a
                         WHERE a.topic_id = t.id AND a.huddle_id = ANY($1::uuid[]))`,
        [huddleIds],
      ),
    ]);

    const topics = topicsRes.rows;
    const LIVE: readonly string[] = TOPIC_LIVE;
    const open = topics.filter((t: any) => LIVE.includes(t.status));

    // Per-meeting throughput reads off the agenda: a topic can be on several
    // agendas, so counting by the topic's own row would attribute it once only.
    const perHuddle = await app.pg.query(
      `SELECT a.huddle_id,
              count(*)::int AS total,
              count(*) FILTER (WHERE t.status = 'closed')::int    AS closed,
              count(*) FILTER (WHERE t.status = 'cancelled')::int AS cancelled
         FROM huddle_agenda_items a
         JOIN huddle_topics t ON t.id = a.topic_id
        WHERE a.huddle_id = ANY($1::uuid[])
        GROUP BY a.huddle_id`,
      [huddleIds],
    );
    const agendaCounts = new Map<string, { total: number; closed: number; cancelled: number }>(
      perHuddle.rows.map((r: any) => [r.huddle_id, r]),
    );

    const shape = (t: any) => ({
      id: t.id, title: t.title, status: t.status,
      purpose: t.purpose, horizon: t.horizon, meetingCount: t.meeting_count ?? 1,
      deferCount: t.defer_count ?? 0, ageDays: t.age_days ?? 0,
      ownerName: t.owner_name ?? null, approverName: t.approver_name ?? null,
      huddleId: t.huddle_id, huddleTitle: t.huddle_title,
    });

    // Actual length when we have both ends, else the planned figure.
    const actualMinutes = (h: any) => {
      if (h.started_at && h.ended_at) {
        return Math.max(0, Math.round(
          (new Date(h.ended_at).getTime() - new Date(h.started_at).getTime()) / 60000));
      }
      return h.planned_duration_minutes ?? 0;
    };

    const rateRow = await app.pg.query(
      'SELECT huddle_loaded_hourly_rate AS rate FROM users WHERE id = $1', [userId],
    );
    const rate = rateRow.rows[0]?.rate != null ? Number(rateRow.rows[0].rate) : null;

    const attendeeRes = await app.pg.query(
      `SELECT huddle_id, count(*)::int AS n FROM huddle_participants
        WHERE huddle_id = ANY($1::uuid[]) GROUP BY huddle_id`,
      [huddleIds],
    );
    const attendeeCounts = new Map<string, number>(
      attendeeRes.rows.map((r: any) => [r.huddle_id, r.n]),
    );

    const totalMinutes = huddlesRes.rows.reduce((m: number, h: any) => m + actualMinutes(h), 0);
    const totalCost = rate == null ? 0 : huddlesRes.rows.reduce(
      (c: number, h: any) =>
        c + (actualMinutes(h) / 60) * (attendeeCounts.get(h.id) ?? 0) * rate, 0);

    // Of everything that reached an agenda, how much actually got decided.
    const agendaRes = await app.pg.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (
                WHERE EXISTS (SELECT 1 FROM huddle_decisions d WHERE d.huddle_topic_id = a.topic_id)
              )::int AS decided
         FROM huddle_agenda_items a
        WHERE a.huddle_id = ANY($1::uuid[])`,
      [huddleIds],
    );
    const agendaTotal = agendaRes.rows[0]?.total ?? 0;
    const agendaDecided = agendaRes.rows[0]?.decided ?? 0;

    const today = new Date().toISOString().slice(0, 10);
    const actionItems = actionsRes.rows.map((a: any) => {
      const due = a.task_due_date ?? a.due_date ?? null;
      const dueStr = due ? new Date(due).toISOString().slice(0, 10) : null;
      const done = a.task_status === 'done' || a.intention_status === 'done';
      return {
        text: a.text,
        ownerName: a.owner_name ?? null,
        huddleTitle: a.huddle_title,
        converted: !!a.linked_task_id,
        taskStatus: a.task_status ?? null,
        dueDate: dueStr,
        softDueText: a.soft_due_text ?? null,
        done,
        overdue: !done && !!dueStr && dueStr < today,
      };
    });

    // Completion rate per person. Unassigned work rolls up under a single
    // bucket rather than being dropped, since that is itself a signal.
    const assigneeRoll = new Map<string, { total: number; done: number; overdue: number }>();
    for (const a of actionItems) {
      const key = a.ownerName ?? 'Unassigned';
      const v = assigneeRoll.get(key) ?? { total: 0, done: 0, overdue: 0 };
      v.total += 1;
      if (a.done) v.done += 1;
      if (a.overdue) v.overdue += 1;
      assigneeRoll.set(key, v);
    }

    return {
      template: { id: tpl.id, name: tpl.name, type: tpl.type },
      huddles: huddlesRes.rows.map((h: any) => ({
        id: h.id, title: h.title, status: h.status,
        meetingType: h.meeting_type,
        durationMinutes: actualMinutes(h),
        attendeeCount: attendeeCounts.get(h.id) ?? 0,
        costEstimate: rate == null ? null
          : Math.round((actualMinutes(h) / 60) * (attendeeCounts.get(h.id) ?? 0) * rate),
        endedAt: h.ended_at, scheduledAt: h.scheduled_at, createdAt: h.created_at,
        // Per-huddle throughput, so an opened-faster-than-closed trend is visible.
        opened: agendaCounts.get(h.id)?.total ?? 0,
        closed: agendaCounts.get(h.id)?.closed ?? 0,
        cancelled: agendaCounts.get(h.id)?.cancelled ?? 0,
      })),
      // Aging is the leading indicator — what's at risk now, not what already finished.
      openTopics: open
        .filter((t: any) => t.horizon === 'short_term')
        .sort((a: any, b: any) => (b.age_days ?? 0) - (a.age_days ?? 0))
        .map(shape),
      // Needs an exit: round the loop 3+ times with nothing in flight beneath it.
      escalations: open
        .filter((t: any) => t.horizon === 'short_term'
          && (t.defer_count ?? 0) >= 3 && !t.has_open_child)
        .map(shape),
      // Parked out of the weekly rotation — otherwise only reachable via its own huddle.
      longTerm: open.filter((t: any) => t.horizon === 'long_term').map(shape),
      decisions: decisionsRes.rows.map((d: any) => ({
        decisionText: d.decision_text,
        topicTitle: d.topic_title,
        huddleTitle: d.huddle_title,
        ownerName: d.owner_name ?? null,
        createdAt: d.created_at,
      })),
      actionItems,
      stats: {
        huddleCount: huddlesRes.rows.length,
        opened: topics.length,
        closed: topics.filter((t: any) => t.status === 'closed').length,
        cancelled: topics.filter((t: any) => t.status === 'cancelled').length,
        stillOpen: open.length,
        needsDecisionNoApprover: open.filter(
          (t: any) => t.status === 'awaiting_decision' && !t.approver_name).length,
        medianDaysToClose: closedRes.rows[0]?.median_days != null
          ? Math.round(Number(closedRes.rows[0].median_days) * 10) / 10
          : null,
        actionsTotal: actionItems.length,
        actionsConverted: actionItems.filter((a) => a.converted).length,
        actionsDone: actionItems.filter((a) => a.done).length,
        actionsOverdue: actionItems.filter((a) => a.overdue).length,
        // Metrics that needed a duration, and so could not be answered before.
        totalMeetingHours: Math.round(totalMinutes / 6) / 10,
        decisionsPerMeetingHour: totalMinutes > 0
          ? Math.round((decisionsRes.rows.length / (totalMinutes / 60)) * 10) / 10
          : null,
        // Share of agenda items that actually reached a decision.
        agendaDecidedPct: agendaTotal > 0
          ? Math.round((agendaDecided / agendaTotal) * 100)
          : null,
        totalCost: rate == null ? null : Math.round(totalCost),
        loadedHourlyRate: rate,
      },
      // Completion per person, so a series with one overloaded owner is visible.
      byAssignee: [...assigneeRoll.entries()]
        .map(([name, v]) => ({
          name,
          total: v.total,
          done: v.done,
          overdue: v.overdue,
          completionPct: v.total > 0 ? Math.round((v.done / v.total) * 100) : 0,
        }))
        .sort((a, b) => b.total - a.total),
    };
  });

  // ── Workspace members helper (for invite picker) ───────────────────────
  app.get('/huddles/workspaces/:wid/members', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { wid } = request.params as { wid: string };
    await checkWorkspaceMember(app, wid, userId);
    const r = await app.pg.query(
      `SELECT u.id, u.name, u.email, u.avatar_url, wm.role
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY u.name ASC`,
      [wid],
    );
    return {
      members: r.rows.map((m) => ({
        id: m.id, name: m.name, email: m.email, avatarUrl: m.avatar_url, role: m.role,
      })),
    };
  });

  // ─── Templates ─────────────────────────────────────────────────────────
  function formatTemplate(r: any) {
    return {
      id: r.id,
      ownerUserId: r.owner_user_id,
      workspaceId: r.workspace_id,
      name: r.name,
      type: r.type,
      defaultTitle: r.default_title,
      defaultIntention: r.default_intention,
      defaultParticipantUserIds: r.default_participant_user_ids ?? [],
      defaultExternalAttendees: r.default_external_attendees ?? [],
      defaultTopics: r.default_topics ?? [],
      emailSummaryToParticipants: r.email_summary_to_participants ?? false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  const templateTopicSchema = z.object({
    title: z.string().min(1).max(300),
    context: z.string().max(2000).optional().nullable(),
  });

  const createTemplateSchema = z.object({
    name: z.string().min(1).max(200),
    type: z.enum(['team', 'personal']),
    workspaceId: z.string().uuid().optional().nullable(),
    defaultTitle: z.string().min(1).max(200),
    defaultIntention: z.string().max(1000).optional().nullable(),
    defaultParticipantUserIds: z.array(z.string().uuid()).optional().default([]),
    defaultExternalAttendees: z.array(externalAttendeeSchema).optional().default([]),
    defaultTopics: z.array(templateTopicSchema).optional().default([]),
    emailSummaryToParticipants: z.boolean().optional().default(false),
  });

  const updateTemplateSchema = createTemplateSchema.partial();

  // List templates owned by the current user.
  app.get('/huddles/templates', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const r = await app.pg.query(
      `SELECT * FROM huddle_templates WHERE owner_user_id = $1 ORDER BY lower(name) ASC LIMIT 200`,
      [userId],
    );
    return { templates: r.rows.map(formatTemplate) };
  });

  // Create a new template directly (e.g. from the start-huddle form).
  app.post('/huddles/templates', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const body = createTemplateSchema.parse(request.body);
    if (body.workspaceId) await checkWorkspaceMember(app, body.workspaceId, userId);
    const r = await app.pg.query(
      `INSERT INTO huddle_templates
         (owner_user_id, workspace_id, name, type, default_title, default_intention,
          default_participant_user_ids, default_external_attendees, default_topics, email_summary_to_participants)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
       RETURNING *`,
      [
        userId,
        body.workspaceId ?? null,
        body.name.trim(),
        body.type,
        body.defaultTitle.trim(),
        body.defaultIntention?.trim() || null,
        JSON.stringify(body.defaultParticipantUserIds ?? []),
        JSON.stringify(body.defaultExternalAttendees ?? []),
        JSON.stringify(body.defaultTopics ?? []),
        !!body.emailSummaryToParticipants,
      ],
    );
    return reply.status(201).send({ template: formatTemplate(r.rows[0]) });
  });

  // Update a template owned by the current user.
  app.patch('/huddles/templates/:tid', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { tid } = request.params as { tid: string };
    const body = updateTemplateSchema.parse(request.body);

    const own = await app.pg.query(
      `SELECT 1 FROM huddle_templates WHERE id = $1 AND owner_user_id = $2`,
      [tid, userId],
    );
    if (own.rows.length === 0) throw new NotFoundError('Template not found');

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (body.name !== undefined)              { sets.push(`name = $${i++}`); params.push(body.name.trim()); }
    if (body.type !== undefined)              { sets.push(`type = $${i++}`); params.push(body.type); }
    if (body.workspaceId !== undefined)       { sets.push(`workspace_id = $${i++}`); params.push(body.workspaceId); }
    if (body.defaultTitle !== undefined)      { sets.push(`default_title = $${i++}`); params.push(body.defaultTitle.trim()); }
    if (body.defaultIntention !== undefined)  { sets.push(`default_intention = $${i++}`); params.push(body.defaultIntention?.trim() || null); }
    if (body.defaultParticipantUserIds !== undefined) {
      sets.push(`default_participant_user_ids = $${i++}::jsonb`);
      params.push(JSON.stringify(body.defaultParticipantUserIds));
    }
    if (body.defaultExternalAttendees !== undefined) {
      sets.push(`default_external_attendees = $${i++}::jsonb`);
      params.push(JSON.stringify(body.defaultExternalAttendees));
    }
    if (body.defaultTopics !== undefined) {
      sets.push(`default_topics = $${i++}::jsonb`);
      params.push(JSON.stringify(body.defaultTopics));
    }
    if (body.emailSummaryToParticipants !== undefined) {
      sets.push(`email_summary_to_participants = $${i++}`);
      params.push(!!body.emailSummaryToParticipants);
    }
    if (sets.length === 0) {
      const cur = await app.pg.query(`SELECT * FROM huddle_templates WHERE id = $1`, [tid]);
      return { template: formatTemplate(cur.rows[0]) };
    }
    sets.push(`updated_at = now()`);
    params.push(tid, userId);
    const r = await app.pg.query(
      `UPDATE huddle_templates SET ${sets.join(', ')}
       WHERE id = $${i++} AND owner_user_id = $${i} RETURNING *`,
      params,
    );
    return { template: formatTemplate(r.rows[0]) };
  });

  // Delete a template owned by the current user.
  app.delete('/huddles/templates/:tid', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { tid } = request.params as { tid: string };
    const r = await app.pg.query(
      `DELETE FROM huddle_templates WHERE id = $1 AND owner_user_id = $2`,
      [tid, userId],
    );
    if (r.rowCount === 0) throw new NotFoundError('Template not found');
    return reply.status(204).send();
  });

  // Snapshot an existing huddle as a template (captures topics + participants).
  app.post('/huddles/:id/save-as-template', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().min(1).max(200),
      includeTopics: z.boolean().optional().default(true),
      includeParticipants: z.boolean().optional().default(true),
    }).parse(request.body);

    const huddle = await loadHuddleOrThrow(app, id, userId);

    let participantIds: string[] = [];
    let externalAttendees: { name: string; email: string | null }[] = [];
    if (body.includeParticipants) {
      const p = await app.pg.query(
        `SELECT user_id, external_name, external_email
         FROM huddle_participants
         WHERE huddle_id = $1`,
        [id],
      );
      participantIds = p.rows
        .filter((row: any) => row.user_id)
        .map((row: any) => row.user_id as string)
        .filter((u: string) => u !== userId);
      externalAttendees = p.rows
        .filter((row: any) => !row.user_id && row.external_name)
        .map((row: any) => ({
          name: String(row.external_name),
          email: row.external_email ?? null,
        }));
    }

    let topics: { title: string; context: string | null }[] = [];
    if (body.includeTopics) {
      const t = await app.pg.query(
        `SELECT t.title, t.context FROM huddle_agenda_items a
           JOIN huddle_topics t ON t.id = a.topic_id
          WHERE a.huddle_id = $1 ORDER BY a.sort_order ASC, t.created_at ASC`,
        [id],
      );
      topics = t.rows.map((row: any) => ({ title: row.title, context: row.context ?? null }));
    }

    const r = await app.pg.query(
      `INSERT INTO huddle_templates
         (owner_user_id, workspace_id, name, type, default_title, default_intention,
          default_participant_user_ids, default_external_attendees, default_topics)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
       RETURNING *`,
      [
        userId,
        huddle.workspace_id,
        body.name.trim(),
        huddle.type,
        huddle.title,
        huddle.intention,
        JSON.stringify(participantIds),
        JSON.stringify(externalAttendees),
        JSON.stringify(topics),
      ],
    );
    return reply.status(201).send({ template: formatTemplate(r.rows[0]) });
  });

  // Start a new huddle from a template (applies title, intention, participants, topics).
  app.post('/huddles/from-template/:tid', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { tid } = request.params as { tid: string };
    const overrides = z.object({
      title: z.string().min(1).max(200).optional(),
      intention: z.string().max(1000).nullable().optional(),
      workspaceId: z.string().uuid().nullable().optional(),
      scheduledAt: z.string().datetime().nullable().optional(),
      participantUserIds: z.array(z.string().uuid()).optional(),
      externalAttendees: z.array(externalAttendeeSchema).optional(),
    }).parse(request.body ?? {});

    const tr = await app.pg.query(
      `SELECT * FROM huddle_templates WHERE id = $1 AND owner_user_id = $2`,
      [tid, userId],
    );
    if (tr.rows.length === 0) throw new NotFoundError('Template not found');
    const tpl = tr.rows[0];

    const workspaceId = overrides.workspaceId !== undefined ? overrides.workspaceId : tpl.workspace_id;
    if (tpl.type === 'team' && !workspaceId) {
      throw new BadRequestError('Team huddles require a workspace');
    }
    if (workspaceId) await checkWorkspaceMember(app, workspaceId, userId);

    const huddleRes = await app.pg.query(
      `INSERT INTO huddles (workspace_id, type, title, intention, host_user_id, scheduled_at, status, email_summary_on_close, template_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8) RETURNING *`,
      [
        workspaceId,
        tpl.type,
        (overrides.title ?? tpl.default_title).trim(),
        overrides.intention !== undefined ? overrides.intention : tpl.default_intention,
        userId,
        overrides.scheduledAt ?? null,
        !!tpl.email_summary_to_participants,
        // Ties this huddle to its series, so the template can be reported on.
        tid,
      ],
    );
    const huddle = huddleRes.rows[0];

    // Host as participant.
    await app.pg.query(
      `INSERT INTO huddle_participants (huddle_id, user_id, role) VALUES ($1, $2, 'host')
       ON CONFLICT (huddle_id, user_id) WHERE user_id IS NOT NULL DO NOTHING`,
      [huddle.id, userId],
    );

    // Other participants from the template (validate workspace membership for team).
    const tplPart: string[] = Array.isArray(tpl.default_participant_user_ids)
      ? tpl.default_participant_user_ids
      : [];
    const partSource = overrides.participantUserIds !== undefined ? overrides.participantUserIds : tplPart;
    for (const uid of partSource) {
      if (uid === userId) continue;
      if (tpl.type === 'team' && workspaceId) {
        const m = await app.pg.query(
          `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
          [workspaceId, uid],
        );
        if (m.rows.length === 0) continue;
      }
      await app.pg.query(
        `INSERT INTO huddle_participants (huddle_id, user_id, role) VALUES ($1, $2, 'participant')
         ON CONFLICT (huddle_id, user_id) WHERE user_id IS NOT NULL DO NOTHING`,
        [huddle.id, uid],
      );
    }

    // External attendees from the template (or overrides).
    const tplExternals: { name: string; email?: string | null }[] = Array.isArray(tpl.default_external_attendees)
      ? tpl.default_external_attendees
      : [];
    const externalSource = overrides.externalAttendees !== undefined ? overrides.externalAttendees : tplExternals;
    for (const ext of externalSource) {
      if (!ext || !ext.name || !String(ext.name).trim()) continue;
      await app.pg.query(
        `INSERT INTO huddle_participants
           (huddle_id, user_id, role, attendance_status, external_name, external_email)
         VALUES ($1, NULL, 'participant', 'invited', $2, $3)`,
        [huddle.id, String(ext.name).trim(), ext.email ? String(ext.email).trim() : null],
      );
    }

    // Unresolved business from last time comes in FIRST, before the template's
    // standing agenda is seeded. A template topic and the still-open copy of
    // that same topic carried from the previous huddle are the same agenda
    // item, so seeding both produced a visible duplicate — one fresh, one
    // marked deferred. The carried row wins because it holds the accumulated
    // history (deferral count, owner, approver, context); a fresh seed would
    // silently drop all of it.
    await carryForwardTopics(app.pg, huddle.id, huddle);

    const carried = await app.pg.query(
      `SELECT lower(btrim(t.title)) AS key, COALESCE(MAX(a.sort_order), -1) AS max_order
         FROM huddle_agenda_items a JOIN huddle_topics t ON t.id = a.topic_id
        WHERE a.huddle_id = $1 GROUP BY lower(btrim(t.title))`,
      [huddle.id],
    );
    const alreadyPresent = new Set<string>(carried.rows.map((r: any) => r.key));
    let order = carried.rows.reduce(
      (m: number, r: any) => Math.max(m, Number(r.max_order)), -1,
    ) + 1;

    // Topics from the template, minus anything carry-forward already supplied.
    const tplTopics: { title: string; context?: string | null }[] = Array.isArray(tpl.default_topics)
      ? tpl.default_topics
      : [];
    for (const t of tplTopics) {
      if (!t || !t.title) continue;
      if (alreadyPresent.has(t.title.trim().toLowerCase())) continue;
      await app.pg.query(
        `INSERT INTO huddle_topics (huddle_id, title, context, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [huddle.id, t.title, t.context ?? null, order++],
      );
    }

    return reply.status(201).send({ huddle: formatHuddle(huddle) });
  });

  // ─── Sharing ───────────────────────────────────────────────────────────
  // Host generates a public link to share the huddle summary after it is
  // closed. The link is read-only and can be revoked at any time.

  function formatShare(r: any) {
    return {
      id: r.id,
      huddleId: r.huddle_id,
      token: r.token,
      createdByUserId: r.created_by_user_id,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      viewCount: r.view_count ?? 0,
      lastViewedAt: r.last_viewed_at,
      createdAt: r.created_at,
    };
  }

  // List existing share links for a huddle (host only).
  app.get('/huddles/:id/shares', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);
    const r = await app.pg.query(
      `SELECT * FROM huddle_shares WHERE huddle_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [id],
    );
    return { shares: r.rows.map(formatShare) };
  });

  // Create a share link for a closed huddle (host only).
  app.post('/huddles/:id/share', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = z.object({
      expiresInDays: z.number().int().min(1).max(365).optional(),
    }).parse(request.body ?? {});

    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);
    if (huddle.status !== 'closed') {
      throw new BadRequestError('Only closed huddles can be shared. Close the huddle first.');
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const r = await app.pg.query(
      `INSERT INTO huddle_shares (huddle_id, token, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, token, userId, expiresAt],
    );
    return reply.status(201).send({ share: formatShare(r.rows[0]) });
  });

  // Revoke a share link (host only).
  app.delete('/huddles/:id/shares/:sid', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, sid } = request.params as { id: string; sid: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);
    const r = await app.pg.query(
      `UPDATE huddle_shares SET revoked_at = now()
       WHERE id = $1 AND huddle_id = $2 AND revoked_at IS NULL`,
      [sid, id],
    );
    if (r.rowCount === 0) throw new NotFoundError('Share link not found');
    return reply.status(204).send();
  });

  // Public, unauthenticated read of a shared huddle summary.
  // Returns a read-only payload: huddle metadata, host name, decisions,
  // intentions, follow-ups, notes, and topic outcomes — no signals or
  // participant emails.
  app.get('/huddles/share/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const sr = await app.pg.query(
      `SELECT s.*, h.* FROM huddle_shares s
       JOIN huddles h ON h.id = s.huddle_id
       WHERE s.token = $1 AND s.revoked_at IS NULL
         AND (s.expires_at IS NULL OR s.expires_at > now())`,
      [token],
    );
    if (sr.rows.length === 0) {
      return reply.status(404).send({ error: 'Share link not found or expired' });
    }
    const row = sr.rows[0];
    if (row.status !== 'closed') {
      return reply.status(404).send({ error: 'Huddle is no longer available' });
    }
    const huddleId = row.huddle_id;

    const [hostRow, parts, topics, decisions, intentions, followups, notes] = await Promise.all([
      app.pg.query('SELECT name FROM users WHERE id = $1', [row.host_user_id]),
      app.pg.query(
        `SELECT u.name AS user_name, p.role, p.attendance_status
         FROM huddle_participants p
         LEFT JOIN users u ON u.id = p.user_id
         WHERE p.huddle_id = $1
         ORDER BY p.role DESC, u.name ASC`,
        [huddleId],
      ),
      app.pg.query(
        `SELECT t.id, t.title, t.context, t.status, a.sort_order
           FROM huddle_agenda_items a JOIN huddle_topics t ON t.id = a.topic_id
          WHERE a.huddle_id = $1
          ORDER BY a.sort_order ASC, t.created_at ASC`,
        [huddleId],
      ),
      app.pg.query(
        `SELECT d.huddle_topic_id, d.decision_text, u.name AS owner_name
         FROM huddle_decisions d
         JOIN huddle_topics t ON t.id = d.huddle_topic_id
         LEFT JOIN users u ON u.id = d.owner_user_id
         WHERE d.huddle_id = $1
         ORDER BY d.created_at ASC`,
        [huddleId],
      ),
      app.pg.query(
        `SELECT i.text, i.soft_due_text, i.status, u.name AS owner_name
         FROM huddle_intentions i
         LEFT JOIN users u ON u.id = i.owner_user_id
         WHERE i.huddle_id = $1
         ORDER BY i.sort_order ASC, i.created_at ASC`,
        [huddleId],
      ),
      app.pg.query(
        `SELECT f.text, f.review_date, f.status, u.name AS owner_name
         FROM huddle_followups f
         LEFT JOIN users u ON u.id = f.owner_user_id
         WHERE f.huddle_id = $1
         ORDER BY f.created_at ASC`,
        [huddleId],
      ),
      app.pg.query(
        `SELECT n.text, n.created_at, u.name AS author_name
         FROM huddle_notes n
         LEFT JOIN users u ON u.id = n.author_user_id
         WHERE n.huddle_id = $1
         ORDER BY n.created_at ASC`,
        [huddleId],
      ),
    ]);

    // Bucket decisions under their topic.
    const decByTopic = new Map<string, any[]>();
    for (const d of decisions.rows) {
      const arr = decByTopic.get(d.huddle_topic_id) ?? [];
      arr.push({ decisionText: d.decision_text, ownerName: d.owner_name ?? null });
      decByTopic.set(d.huddle_topic_id, arr);
    }

    // Best-effort view count update; ignore failures.
    app.pg
      .query(
        `UPDATE huddle_shares SET view_count = view_count + 1, last_viewed_at = now()
         WHERE token = $1`,
        [token],
      )
      .catch(() => {});

    return {
      summary: {
        huddle: {
          id: row.huddle_id,
          type: row.type,
          title: row.title,
          intention: row.intention,
          summary: row.summary,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          scheduledAt: row.scheduled_at,
          hostName: hostRow.rows[0]?.name ?? null,
        },
        participants: parts.rows.map((p) => ({
          name: p.user_name,
          role: p.role,
          attendanceStatus: p.attendance_status,
        })),
        topics: topics.rows.map((t) => ({
          id: t.id,
          title: t.title,
          context: t.context,
          status: t.status,
          // status now carries what open_reason used to.
          decisions: decByTopic.get(t.id) ?? [],
        })),
        intentions: intentions.rows.map((i) => ({
          text: i.text,
          softDueText: i.soft_due_text,
          status: i.status,
          ownerName: i.owner_name ?? null,
        })),
        followups: followups.rows.map((f) => ({
          text: f.text,
          reviewDate: f.review_date,
          status: f.status,
          ownerName: f.owner_name ?? null,
        })),
        notes: notes.rows.map((n) => ({
          text: n.text,
          createdAt: n.created_at,
          authorName: n.author_name ?? null,
        })),
      },
    };
  });
}

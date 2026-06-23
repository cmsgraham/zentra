import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../lib/errors.js';
import { sendMail, huddleSummaryEmail } from '../../lib/mailer.js';
import { getEnv } from '../../lib/env.js';

// ─── Schemas ──────────────────────────────────────────────────────────────

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
});

const updateHuddleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
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
  details: detailsField,
});

const createTopicSchema = z.object({
  title: z.string().min(1).max(300),
  context: z.string().max(2000).optional().nullable(),
  sourceSignalId: z.string().uuid().optional().nullable(),
  details: detailsField,
});

const updateTopicSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  context: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  status: z.enum(['open', 'decided', 'parked']).optional(),
  details: detailsField,
});

const decideTopicSchema = z.object({
  decisionText: z.string().min(1).max(1000),
  ownerUserId: z.string().uuid().nullable().optional(),
  details: detailsField,
});

const createIntentionSchema = z.object({
  text: z.string().min(1).max(500),
  ownerUserId: z.string().uuid().optional(), // defaults to current user
  softDueText: z.string().max(120).optional().nullable(),
  details: detailsField,
});

const updateIntentionSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  ownerUserId: z.string().uuid().optional(),
  softDueText: z.string().max(120).nullable().optional(),
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
    createdAt: r.created_at,
    authorName: r.author_name ?? undefined,
  };
}
function formatTopic(r: any) {
  return {
    id: r.id,
    huddleId: r.huddle_id,
    title: r.title,
    context: r.context,
    details: r.details ?? null,
    sortOrder: r.sort_order,
    status: r.status,
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
    details: r.details ?? null,
    linkedTaskId: r.linked_task_id,
    status: r.status,
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
      const statusTag = t.status && t.status !== 'open' ? ` _(${t.status})_` : '';
      lines.push(`- **${t.title}**${statusTag}`);
      if (t.context) lines.push(`  ${t.context}`);
      if (t.details) lines.push(ind(t.details));
      const decs = input.decisionsByTopic.get(t.id) ?? [];
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
      `SELECT id, title FROM huddle_topics WHERE huddle_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [huddleId],
    ),
    app.pg.query(
      `SELECT d.huddle_topic_id, d.decision_text, u.name AS owner_name
       FROM huddle_decisions d
       JOIN huddle_topics t ON t.id = d.huddle_topic_id
       LEFT JOIN users u ON u.id = d.owner_user_id
       WHERE t.huddle_id = $1
       ORDER BY d.created_at ASC`,
      [huddleId],
    ),
    app.pg.query(
      `SELECT i.text, i.soft_due_text, i.status, u.name AS owner_name
       FROM huddle_intentions i
       LEFT JOIN users u ON u.id = i.owner_user_id
       WHERE i.huddle_id = $1
       ORDER BY i.created_at ASC`,
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
      `SELECT f.*, u.name AS host_name,
              (SELECT count(*)::int FROM huddle_participants p WHERE p.huddle_id = f.id) AS participant_count
       FROM huddles f
       LEFT JOIN users u ON u.id = f.host_user_id
       WHERE ${conds.join(' AND ')}
       ORDER BY lower(f.title) ASC
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

      const huddleRes = await client.query(
        `INSERT INTO huddles (workspace_id, type, title, intention, host_user_id, scheduled_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft')
         RETURNING *`,
        [body.workspaceId ?? null, body.type, body.title, body.intention ?? null, userId, body.scheduledAt ?? null],
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
         ORDER BY s.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT * FROM huddle_topics WHERE huddle_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT d.*, u.name AS owner_name
         FROM huddle_decisions d
         JOIN huddle_topics t ON t.id = d.huddle_topic_id
         LEFT JOIN users u ON u.id = d.owner_user_id
         WHERE t.huddle_id = $1
         ORDER BY d.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT i.*, u.name AS owner_name
         FROM huddle_intentions i
         LEFT JOIN users u ON u.id = i.owner_user_id
         WHERE i.huddle_id = $1
         ORDER BY i.created_at ASC`,
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
         ORDER BY s.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT * FROM huddle_topics WHERE huddle_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT d.*, u.name AS owner_name
         FROM huddle_decisions d
         JOIN huddle_topics t ON t.id = d.huddle_topic_id
         LEFT JOIN users u ON u.id = d.owner_user_id
         WHERE t.huddle_id = $1
         ORDER BY d.created_at ASC`,
        [id],
      ),
      app.pg.query(
        `SELECT i.*, u.name AS owner_name
         FROM huddle_intentions i
         LEFT JOIN users u ON u.id = i.owner_user_id
         WHERE i.huddle_id = $1
         ORDER BY i.created_at ASC`,
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
    const r = await app.pg.query(
      `INSERT INTO huddle_signals (huddle_id, author_user_id, text, why_it_matters, details)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, userId, body.text, body.whyItMatters ?? null, body.details ?? null],
    );
    return reply.status(201).send({ signal: formatSignal(r.rows[0]) });
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
      const orderRes = await client.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM huddle_topics WHERE huddle_id = $1`,
        [id],
      );
      const topicRes = await client.query(
        `INSERT INTO huddle_topics (huddle_id, title, context, sort_order, source_signal_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, s.text, s.why_it_matters, orderRes.rows[0].next, sid],
      );
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
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = createTopicSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const orderRes = await app.pg.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM huddle_topics WHERE huddle_id = $1`, [id],
    );
    const r = await app.pg.query(
      `INSERT INTO huddle_topics (huddle_id, title, context, details, sort_order, source_signal_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, body.title, body.context ?? null, body.details ?? null, orderRes.rows[0].next, body.sourceSignalId ?? null],
    );
    return reply.status(201).send({ topic: formatTopic(r.rows[0]) });
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
    if (body.status !== undefined) { sets.push(`status = $${i++}`); params.push(body.status); }
    if (sets.length === 0) {
      const cur = await app.pg.query('SELECT * FROM huddle_topics WHERE id = $1 AND huddle_id = $2', [tid, id]);
      if (cur.rows.length === 0) throw new NotFoundError('Topic not found');
      return { topic: formatTopic(cur.rows[0]) };
    }
    sets.push(`updated_at = now()`);
    params.push(tid, id);
    const r = await app.pg.query(
      `UPDATE huddle_topics SET ${sets.join(', ')} WHERE id = $${i++} AND huddle_id = $${i} RETURNING *`, params,
    );
    if (r.rows.length === 0) throw new NotFoundError('Topic not found');
    return { topic: formatTopic(r.rows[0]) };
  });

  app.delete('/huddles/:id/topics/:tid', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, tid } = request.params as { id: string; tid: string };
    const huddle = await loadHuddleOrThrow(app, id, userId);
    requireHost(huddle, userId);
    const r = await app.pg.query(
      'DELETE FROM huddle_topics WHERE id = $1 AND huddle_id = $2 RETURNING id',
      [tid, id],
    );
    if (r.rows.length === 0) throw new NotFoundError('Topic not found');
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
       WHERE d.id = $1 AND d.huddle_topic_id = t.id AND t.huddle_id = $2
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

    const t = await app.pg.query('SELECT * FROM huddle_topics WHERE id = $1 AND huddle_id = $2', [tid, id]);
    if (t.rows.length === 0) throw new NotFoundError('Topic not found');

    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const dec = await client.query(
        `INSERT INTO huddle_decisions (huddle_topic_id, owner_user_id, decision_text, details)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [tid, body.ownerUserId ?? null, body.decisionText, body.details ?? null],
      );
      await client.query(
        `UPDATE huddle_topics SET status = 'decided', updated_at = now() WHERE id = $1`,
        [tid],
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

  app.post('/huddles/:id/topics/:tid/park', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, tid } = request.params as { id: string; tid: string };
    await loadHuddleOrThrow(app, id, userId);
    const r = await app.pg.query(
      `UPDATE huddle_topics SET status = 'parked', updated_at = now()
       WHERE id = $1 AND huddle_id = $2 RETURNING *`,
      [tid, id],
    );
    if (r.rows.length === 0) throw new NotFoundError('Topic not found');
    return { topic: formatTopic(r.rows[0]) };
  });

  app.put('/huddles/:id/decisions/:did', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id, did } = request.params as { id: string; did: string };
    const body = updateDecisionSchema.parse(request.body);
    await loadHuddleOrThrow(app, id, userId);
    const cur = await app.pg.query(
      `SELECT d.* FROM huddle_decisions d
         JOIN huddle_topics t ON t.id = d.huddle_topic_id
         WHERE d.id = $1 AND t.huddle_id = $2`,
      [did, id],
    );
    if (cur.rows.length === 0) throw new NotFoundError('Decision not found');
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (body.decisionText !== undefined) { sets.push(`decision_text = $${i++}`); params.push(body.decisionText); }
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
    await loadHuddleOrThrow(app, id, userId);
    const r = await app.pg.query(
      `INSERT INTO huddle_intentions (huddle_id, text, owner_user_id, soft_due_text, details)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, body.text, body.ownerUserId ?? userId, body.softDueText ?? null, body.details ?? null],
    );
    return reply.status(201).send({ intention: formatIntention(r.rows[0]) });
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

    const today = new Date().toISOString().slice(0, 10);
    const taskRes = await app.pg.query(
      `INSERT INTO tasks (workspace_id, title, status, priority, next_action, next_action_state${body.priorityForToday ? ', priority_for_date, priority_for_user_id' : ''})
       VALUES ($1, $2, 'pending', 'medium', $3, 'set'${body.priorityForToday ? ', $4, $5' : ''})
       RETURNING id`,
      body.priorityForToday
        ? [body.workspaceId, intent.text, intent.text, today, intent.owner_user_id]
        : [body.workspaceId, intent.text, intent.text],
    );
    const taskId = taskRes.rows[0].id;
    const updated = await app.pg.query(
      `UPDATE huddle_intentions SET linked_task_id = $1, updated_at = now()
       WHERE id = $2 RETURNING *`,
      [taskId, iid],
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
        `SELECT title, context FROM huddle_topics WHERE huddle_id = $1 ORDER BY sort_order ASC, created_at ASC`,
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
      `INSERT INTO huddles (workspace_id, type, title, intention, host_user_id, scheduled_at, status, email_summary_on_close)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7) RETURNING *`,
      [
        workspaceId,
        tpl.type,
        (overrides.title ?? tpl.default_title).trim(),
        overrides.intention !== undefined ? overrides.intention : tpl.default_intention,
        userId,
        overrides.scheduledAt ?? null,
        !!tpl.email_summary_to_participants,
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

    // Topics from the template.
    const tplTopics: { title: string; context?: string | null }[] = Array.isArray(tpl.default_topics)
      ? tpl.default_topics
      : [];
    let order = 0;
    for (const t of tplTopics) {
      if (!t || !t.title) continue;
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
        `SELECT id, title, context, status, sort_order
         FROM huddle_topics WHERE huddle_id = $1
         ORDER BY sort_order ASC, created_at ASC`,
        [huddleId],
      ),
      app.pg.query(
        `SELECT d.huddle_topic_id, d.decision_text, u.name AS owner_name
         FROM huddle_decisions d
         JOIN huddle_topics t ON t.id = d.huddle_topic_id
         LEFT JOIN users u ON u.id = d.owner_user_id
         WHERE t.huddle_id = $1
         ORDER BY d.created_at ASC`,
        [huddleId],
      ),
      app.pg.query(
        `SELECT i.text, i.soft_due_text, i.status, u.name AS owner_name
         FROM huddle_intentions i
         LEFT JOIN users u ON u.id = i.owner_user_id
         WHERE i.huddle_id = $1
         ORDER BY i.created_at ASC`,
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

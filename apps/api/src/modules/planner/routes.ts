import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';

// ---------- Schemas ----------

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const monthStr = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM');
const goalStatusEnum = z.enum(['pending', 'done', 'skipped']);
const followupTypeEnum = z.enum(['call', 'email', 'followup', 'other']);

const getPlannerQuerySchema = z.object({
  date: dateStr,
  workspaceId: z.string().uuid().optional(),
});

const upsertPlannerSchema = z.object({
  date: dateStr,
  workspaceId: z.string().uuid().optional(),
  mood: z.string().max(200).optional().nullable(),
  reminderText: z.string().max(2000).optional().nullable(),
  topPriorityText: z.string().max(2000).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  reflection: z.string().max(10000).optional().nullable(),
  tomorrowNotes: z.string().max(5000).optional().nullable(),
});

const createGoalSchema = z.object({
  title: z.string().min(1).max(500),
  status: goalStatusEnum.default('pending'),
  linkedTaskId: z.string().uuid().optional(),
  sortOrder: z.number().int().default(0),
});

const updateGoalSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  status: goalStatusEnum.optional(),
  linkedTaskId: z.string().uuid().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

const createFollowupSchema = z.object({
  label: z.string().min(1).max(500),
  type: followupTypeEnum.default('other'),
  sortOrder: z.number().int().default(0),
});

const updateFollowupSchema = z.object({
  label: z.string().min(1).max(500).optional(),
  type: followupTypeEnum.optional(),
  sortOrder: z.number().int().optional(),
});

const calendarSummaryQuerySchema = z.object({
  month: monthStr,
  workspaceId: z.string().uuid().optional(),
});

// ---------- Formatters ----------

function formatPlan(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    planDate: row.plan_date,
    mood: row.mood,
    reminderText: row.reminder_text,
    topPriorityText: row.top_priority_text,
    notes: row.notes,
    reflection: row.reflection,
    tomorrowNotes: row.tomorrow_notes,
    planBlocks: row.plan_blocks ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatGoal(row: any) {
  const goal: any = {
    id: row.id,
    dailyPlanId: row.daily_plan_id,
    title: row.title,
    status: row.status,
    linkedTaskId: row.linked_task_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  // Include linked task info if joined
  if (row.task_title !== undefined) {
    goal.linkedTask = row.linked_task_id ? {
      id: row.linked_task_id,
      title: row.task_title,
      status: row.task_status,
      priority: row.task_priority,
      createdAt: row.task_created_at,
      openDays: row.task_created_at
        ? Math.floor((Date.now() - new Date(row.task_created_at).getTime()) / 86400000)
        : null,
    } : null;
  }
  return goal;
}

function formatFollowup(row: any) {
  return {
    id: row.id,
    dailyPlanId: row.daily_plan_id,
    label: row.label,
    type: row.type,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- Helpers ----------

async function getPlanRow(app: FastifyInstance, userId: string, date: string, workspaceId?: string) {
  if (workspaceId) {
    const r = await app.pg.query(
      'SELECT * FROM daily_plans WHERE user_id = $1 AND plan_date = $2 AND workspace_id = $3',
      [userId, date, workspaceId],
    );
    return r.rows[0] ?? null;
  }
  const r = await app.pg.query(
    'SELECT * FROM daily_plans WHERE user_id = $1 AND plan_date = $2 AND workspace_id IS NULL',
    [userId, date],
  );
  return r.rows[0] ?? null;
}

async function verifyPlanOwnership(app: FastifyInstance, planId: string, userId: string) {
  const r = await app.pg.query('SELECT * FROM daily_plans WHERE id = $1', [planId]);
  if (r.rows.length === 0) throw new NotFoundError('Plan not found');
  if (r.rows[0].user_id !== userId) throw new ForbiddenError();
  return r.rows[0];
}

// ---------- Routes ----------

export default async function plannerRoutes(app: FastifyInstance) {

  // ==================== Plan CRUD ====================

  // GET /planner?date=YYYY-MM-DD&workspaceId=...
  // Returns plan + goals + followups, or null if no plan exists
  app.get('/planner', { preHandler: [app.authenticate] }, async (request) => {
    const query = getPlannerQuerySchema.parse(request.query);
    const userId = request.user.sub;

    if (query.workspaceId) {
      const mem = await app.pg.query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [query.workspaceId, userId],
      );
      if (mem.rows.length === 0) throw new ForbiddenError();
    }

    const plan = await getPlanRow(app, userId, query.date, query.workspaceId);
    if (!plan) return { plan: null, goals: [], followups: [] };

    const [goalsResult, followupsResult] = await Promise.all([
      app.pg.query(
        `SELECT g.*, t.title as task_title, t.status as task_status, t.priority as task_priority, t.created_at as task_created_at
         FROM daily_plan_goals g
         LEFT JOIN tasks t ON t.id = g.linked_task_id
         WHERE g.daily_plan_id = $1
         ORDER BY g.sort_order`,
        [plan.id],
      ),
      app.pg.query('SELECT * FROM daily_plan_followups WHERE daily_plan_id = $1 ORDER BY sort_order', [plan.id]),
    ]);

    return {
      plan: formatPlan(plan),
      goals: goalsResult.rows.map(formatGoal),
      followups: followupsResult.rows.map(formatFollowup),
    };
  });

  // PUT /planner — upsert plan for a date
  app.put('/planner', { preHandler: [app.authenticate] }, async (request) => {
    const body = upsertPlannerSchema.parse(request.body);
    const userId = request.user.sub;

    if (body.workspaceId) {
      const mem = await app.pg.query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [body.workspaceId, userId],
      );
      if (mem.rows.length === 0) throw new ForbiddenError();
    }

    const existing = await getPlanRow(app, userId, body.date, body.workspaceId);

    let plan;
    if (existing) {
      const result = await app.pg.query(
        `UPDATE daily_plans SET
          mood = CASE WHEN $1::boolean THEN $2 ELSE mood END,
          reminder_text = CASE WHEN $3::boolean THEN $4 ELSE reminder_text END,
          top_priority_text = CASE WHEN $5::boolean THEN $6 ELSE top_priority_text END,
          notes = CASE WHEN $7::boolean THEN $8 ELSE notes END,
          reflection = CASE WHEN $9::boolean THEN $10 ELSE reflection END,
          tomorrow_notes = CASE WHEN $11::boolean THEN $12 ELSE tomorrow_notes END
         WHERE id = $13 RETURNING *`,
        [
          body.mood !== undefined, body.mood ?? null,
          body.reminderText !== undefined, body.reminderText ?? null,
          body.topPriorityText !== undefined, body.topPriorityText ?? null,
          body.notes !== undefined, body.notes ?? null,
          body.reflection !== undefined, body.reflection ?? null,
          body.tomorrowNotes !== undefined, body.tomorrowNotes ?? null,
          existing.id,
        ],
      );
      plan = result.rows[0];
    } else {
      const result = await app.pg.query(
        `INSERT INTO daily_plans (user_id, workspace_id, plan_date, mood, reminder_text, top_priority_text, notes, reflection, tomorrow_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          userId, body.workspaceId || null, body.date,
          body.mood ?? null, body.reminderText ?? null, body.topPriorityText ?? null,
          body.notes ?? null, body.reflection ?? null, body.tomorrowNotes ?? null,
        ],
      );
      plan = result.rows[0];
    }

    const [goalsResult, followupsResult] = await Promise.all([
      app.pg.query(
        `SELECT g.*, t.title as task_title, t.status as task_status, t.priority as task_priority, t.created_at as task_created_at
         FROM daily_plan_goals g
         LEFT JOIN tasks t ON t.id = g.linked_task_id
         WHERE g.daily_plan_id = $1
         ORDER BY g.sort_order`,
        [plan.id],
      ),
      app.pg.query('SELECT * FROM daily_plan_followups WHERE daily_plan_id = $1 ORDER BY sort_order', [plan.id]),
    ]);

    return {
      plan: formatPlan(plan),
      goals: goalsResult.rows.map(formatGoal),
      followups: followupsResult.rows.map(formatFollowup),
    };
  });

  // ==================== Goals ====================

  // POST /planner/:plannerId/goals
  app.post('/planner/:plannerId/goals', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { plannerId } = request.params as { plannerId: string };
    const body = createGoalSchema.parse(request.body);
    const userId = request.user.sub;

    const planRow = await verifyPlanOwnership(app, plannerId, userId);

    const result = await app.pg.query(
      `INSERT INTO daily_plan_goals (daily_plan_id, title, status, linked_task_id, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [plannerId, body.title, body.status, body.linkedTaskId || null, body.sortOrder],
    );

    // Auto-set linked task to in_progress if it's currently pending
    if (body.linkedTaskId) {
      await app.pg.query(
        `UPDATE tasks SET status = 'in_progress'
         WHERE id = $1 AND status = 'pending'`,
        [body.linkedTaskId],
      );
    }

    return reply.status(201).send(formatGoal(result.rows[0]));
  });

  // PATCH /planner/goals/:goalId
  app.patch('/planner/goals/:goalId', { preHandler: [app.authenticate] }, async (request) => {
    const { goalId } = request.params as { goalId: string };
    const body = updateGoalSchema.parse(request.body);
    const userId = request.user.sub;

    const goalResult = await app.pg.query('SELECT * FROM daily_plan_goals WHERE id = $1', [goalId]);
    if (goalResult.rows.length === 0) throw new NotFoundError('Goal not found');

    await verifyPlanOwnership(app, goalResult.rows[0].daily_plan_id, userId);

    const result = await app.pg.query(
      `UPDATE daily_plan_goals SET
        title = COALESCE($1, title),
        status = COALESCE($2, status),
        linked_task_id = CASE WHEN $3::boolean THEN $4::uuid ELSE linked_task_id END,
        sort_order = COALESCE($5, sort_order)
       WHERE id = $6 RETURNING *`,
      [
        body.title ?? null,
        body.status ?? null,
        body.linkedTaskId !== undefined, body.linkedTaskId ?? null,
        body.sortOrder ?? null,
        goalId,
      ],
    );

    return formatGoal(result.rows[0]);
  });

  // DELETE /planner/goals/:goalId
  app.delete('/planner/goals/:goalId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { goalId } = request.params as { goalId: string };
    const userId = request.user.sub;

    const goalResult = await app.pg.query('SELECT * FROM daily_plan_goals WHERE id = $1', [goalId]);
    if (goalResult.rows.length === 0) throw new NotFoundError('Goal not found');

    await verifyPlanOwnership(app, goalResult.rows[0].daily_plan_id, userId);

    await app.pg.query('DELETE FROM daily_plan_goals WHERE id = $1', [goalId]);
    return reply.status(204).send();
  });

  // ==================== Follow-ups ====================

  // POST /planner/:plannerId/followups
  app.post('/planner/:plannerId/followups', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { plannerId } = request.params as { plannerId: string };
    const body = createFollowupSchema.parse(request.body);
    const userId = request.user.sub;

    await verifyPlanOwnership(app, plannerId, userId);

    const result = await app.pg.query(
      `INSERT INTO daily_plan_followups (daily_plan_id, label, type, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [plannerId, body.label, body.type, body.sortOrder],
    );

    return reply.status(201).send(formatFollowup(result.rows[0]));
  });

  // PATCH /planner/followups/:followupId
  app.patch('/planner/followups/:followupId', { preHandler: [app.authenticate] }, async (request) => {
    const { followupId } = request.params as { followupId: string };
    const body = updateFollowupSchema.parse(request.body);
    const userId = request.user.sub;

    const fuResult = await app.pg.query('SELECT * FROM daily_plan_followups WHERE id = $1', [followupId]);
    if (fuResult.rows.length === 0) throw new NotFoundError('Follow-up not found');

    await verifyPlanOwnership(app, fuResult.rows[0].daily_plan_id, userId);

    const result = await app.pg.query(
      `UPDATE daily_plan_followups SET
        label = COALESCE($1, label),
        type = COALESCE($2, type),
        sort_order = COALESCE($3, sort_order)
       WHERE id = $4 RETURNING *`,
      [
        body.label ?? null,
        body.type ?? null,
        body.sortOrder ?? null,
        followupId,
      ],
    );

    return formatFollowup(result.rows[0]);
  });

  // DELETE /planner/followups/:followupId
  app.delete('/planner/followups/:followupId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { followupId } = request.params as { followupId: string };
    const userId = request.user.sub;

    const fuResult = await app.pg.query('SELECT * FROM daily_plan_followups WHERE id = $1', [followupId]);
    if (fuResult.rows.length === 0) throw new NotFoundError('Follow-up not found');

    await verifyPlanOwnership(app, fuResult.rows[0].daily_plan_id, userId);

    await app.pg.query('DELETE FROM daily_plan_followups WHERE id = $1', [followupId]);
    return reply.status(204).send();
  });

  // ==================== Calendar Summary ====================

  // GET /planner/calendar-summary?month=YYYY-MM&workspaceId=...
  app.get('/planner/calendar-summary', { preHandler: [app.authenticate] }, async (request) => {
    const query = calendarSummaryQuerySchema.parse(request.query);
    const userId = request.user.sub;

    // Derive month range
    const monthStart = `${query.month}-01`;
    // Last day: add 1 month, subtract 1 day handled via date math
    const monthEndExclusive = nextMonthFirst(query.month);

    // 1. Planner existence by date
    const plannerQuery = query.workspaceId
      ? app.pg.query(
          `SELECT plan_date FROM daily_plans
           WHERE user_id = $1 AND workspace_id = $2
             AND plan_date >= $3::date AND plan_date < $4::date`,
          [userId, query.workspaceId, monthStart, monthEndExclusive],
        )
      : app.pg.query(
          `SELECT plan_date FROM daily_plans
           WHERE user_id = $1
             AND plan_date >= $2::date AND plan_date < $3::date`,
          [userId, monthStart, monthEndExclusive],
        );

    // 2. Appointment counts by date
    const appointmentQuery = query.workspaceId
      ? app.pg.query(
          `SELECT starts_at::date AS day, count(*)::int AS cnt FROM appointments
           WHERE owner_user_id = $1 AND workspace_id = $2
             AND starts_at >= $3::timestamptz AND starts_at < $4::timestamptz
           GROUP BY day`,
          [userId, query.workspaceId, `${monthStart}T00:00:00Z`, `${monthEndExclusive}T00:00:00Z`],
        )
      : app.pg.query(
          `SELECT starts_at::date AS day, count(*)::int AS cnt FROM appointments
           WHERE owner_user_id = $1
             AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz
           GROUP BY day`,
          [userId, `${monthStart}T00:00:00Z`, `${monthEndExclusive}T00:00:00Z`],
        );

    // 3. Task deadline counts by date
    //    Count tasks the user can see (member of workspace) that have a due_date in the month and are not done/archived.
    const deadlineQuery = query.workspaceId
      ? app.pg.query(
          `SELECT t.due_date::date AS day, count(*)::int AS cnt FROM tasks t
           WHERE t.workspace_id = $1 AND t.due_date IS NOT NULL
             AND t.due_date >= $2::timestamptz AND t.due_date < $3::timestamptz
             AND t.status != 'done' AND t.archived = false
           GROUP BY day`,
          [query.workspaceId, `${monthStart}T00:00:00Z`, `${monthEndExclusive}T00:00:00Z`],
        )
      : app.pg.query(
          `SELECT t.due_date::date AS day, count(*)::int AS cnt FROM tasks t
           JOIN workspace_members wm ON wm.workspace_id = t.workspace_id AND wm.user_id = $1
           WHERE t.due_date IS NOT NULL
             AND t.due_date >= $2::timestamptz AND t.due_date < $3::timestamptz
             AND t.status != 'done' AND t.archived = false
           GROUP BY day`,
          [userId, `${monthStart}T00:00:00Z`, `${monthEndExclusive}T00:00:00Z`],
        );

    const [plannerResult, appointmentResult, deadlineResult] = await Promise.all([
      plannerQuery, appointmentQuery, deadlineQuery,
    ]);

    // Build lookup maps
    const plannerDates = new Set(plannerResult.rows.map((r: any) => isoDate(r.plan_date)));
    const appointmentMap = new Map<string, number>();
    for (const r of appointmentResult.rows) appointmentMap.set(isoDate(r.day), r.cnt);
    const deadlineMap = new Map<string, number>();
    for (const r of deadlineResult.rows) deadlineMap.set(isoDate(r.day), r.cnt);

    // Build days array for the entire month
    const days: { date: string; hasPlanner: boolean; appointmentCount: number; deadlineCount: number }[] = [];
    const cursor = new Date(`${monthStart}T00:00:00Z`);
    const endDate = new Date(`${monthEndExclusive}T00:00:00Z`);
    while (cursor < endDate) {
      const d = cursor.toISOString().slice(0, 10);
      days.push({
        date: d,
        hasPlanner: plannerDates.has(d),
        appointmentCount: appointmentMap.get(d) ?? 0,
        deadlineCount: deadlineMap.get(d) ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return { month: query.month, days };
  });
}

// ---------- Utility ----------

function nextMonthFirst(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return `${next}-01`;
}

function isoDate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';

const statusEnum = z.enum(['pending', 'in_progress', 'blocked', 'done']);
const priorityEnum = z.enum(['low', 'medium', 'high', 'critical']);

const recurrenceTypeEnum = z.enum(['daily', 'weekly', 'monthly']);

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  status: statusEnum,
  priority: priorityEnum,
  blockedReason: z.string().max(1000).optional(),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  laneOrder: z.number().optional(),
  tags: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional(),
  complexity: z.number().int().min(1).max(3).optional(),
  recurrenceType: recurrenceTypeEnum.optional().nullable(),
  recurrenceInterval: z.number().int().min(1).max(365).optional().nullable(),
  recurrenceEndDate: z.string().optional().nullable(),
  nextAction: z.string().max(300).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  blockedReason: z.string().max(1000).optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  laneOrder: z.number().optional().nullable(),
  tags: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
  workspaceId: z.string().uuid().optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional().nullable(),
  complexity: z.number().int().min(1).max(3).optional().nullable(),
  recurrenceType: recurrenceTypeEnum.optional().nullable(),
  recurrenceInterval: z.number().int().min(1).max(365).optional().nullable(),
  recurrenceEndDate: z.string().optional().nullable(),
  nextAction: z.string().max(300).optional().nullable(),
  nextActionState: z.enum(['unclear', 'set', 'done']).optional(),
});

const moveTaskSchema = z.object({
  status: statusEnum,
  blockedReason: z.string().max(1000).optional(),
  laneOrder: z.number().optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const taskListQuerySchema = paginationSchema.extend({
  status: statusEnum.optional(),
  assigneeId: z.string().uuid().optional(),
  includeArchived: z.coerce.boolean().default(false),
  // Deadline filters
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),   // exact day
  dueBefore: z.string().datetime().optional(),                     // range ceiling
  dueAfter: z.string().datetime().optional(),                      // range floor
  overdue: z.coerce.boolean().optional(),                          // shortcut: due < now & not done
  hasDueDate: z.coerce.boolean().optional(),                       // filter to only tasks with/without a due date
});

async function checkMembership(app: FastifyInstance, workspaceId: string, userId: string) {
  const result = await app.pg.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  if (result.rows.length === 0) throw new ForbiddenError();
  return result.rows[0].role;
}

async function getTaskWithTags(app: FastifyInstance, taskId: string) {
  const taskResult = await app.pg.query(
    `SELECT t.*, u.id as assignee_user_id, u.email as assignee_email, u.name as assignee_name
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.id = $1`,
    [taskId],
  );
  if (taskResult.rows.length === 0) return null;
  const t = taskResult.rows[0];

  const tagResult = await app.pg.query(
    `SELECT tt.name FROM task_tag_links ttl JOIN task_tags tt ON tt.id = ttl.tag_id WHERE ttl.task_id = $1`,
    [taskId],
  );

  let segmentProgress = null;
  if (t.has_segments) {
    const segResult = await app.pg.query(
      `SELECT count(*) as total, count(*) FILTER (WHERE status = 'done') as completed FROM task_segments WHERE parent_task_id = $1`,
      [taskId],
    );
    segmentProgress = { completed: parseInt(segResult.rows[0].completed), total: parseInt(segResult.rows[0].total) };
  }

  return formatTask(t, tagResult.rows.map((r: any) => r.name), segmentProgress);
}

function formatTask(t: any, tags: string[], segmentProgress?: { completed: number; total: number } | null) {
  const now = Date.now();
  const createdMs = new Date(t.created_at).getTime();
  const openDays = Math.floor((now - createdMs) / 86400000);

  return {
    id: t.id,
    workspaceId: t.workspace_id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    blockedReason: t.blocked_reason,
    assignee: t.assignee_user_id ? { id: t.assignee_user_id, email: t.assignee_email, name: t.assignee_name } : null,
    creatorId: t.creator_id,
    laneOrder: t.lane_order ? parseFloat(t.lane_order) : null,
    sourceType: t.source_type,
    sourceReferenceId: t.source_reference_id,
    dueDate: t.due_date,
    estimatedMinutes: t.estimated_minutes,
    complexity: t.complexity ?? 1,
    recurrenceType: t.recurrence_type ?? null,
    recurrenceInterval: t.recurrence_interval ?? 1,
    recurrenceEndDate: t.recurrence_end_date ?? null,
    nextAction: t.next_action ?? null,
    nextActionState: t.next_action_state ?? 'unclear',
    priorityForDate: t.priority_for_date ?? null,
    brainDump: t.brain_dump ?? null,
    hasSegments: t.has_segments ?? false,
    segmentProgress: segmentProgress ?? null,
    tags,
    archived: t.archived,
    completedAt: t.completed_at,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    openDays,
  };
}

async function logActivity(app: FastifyInstance, taskId: string, actorId: string, actionType: string, before: any, after: any) {
  await app.pg.query(
    `INSERT INTO task_activity (task_id, actor_id, action_type, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5)`,
    [taskId, actorId, actionType, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null],
  );
}

function formatSegment(s: any) {
  return {
    id: s.id,
    parentTaskId: s.parent_task_id,
    title: s.title,
    sequenceNumber: s.sequence_number,
    totalSegments: s.total_segments,
    estimatedMinutes: s.estimated_minutes,
    dueDate: s.due_date ?? null,
    status: s.status,
    completedAt: s.completed_at,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

async function syncTaskTags(app: FastifyInstance, taskId: string, workspaceId: string, tagNames: string[] | undefined) {
  if (!tagNames) return;
  // Delete existing links
  await app.pg.query('DELETE FROM task_tag_links WHERE task_id = $1', [taskId]);
  
  for (const name of tagNames) {
    // Find tag (do not auto-create)
    const tagResult = await app.pg.query(
      'SELECT id FROM task_tags WHERE workspace_id = $1 AND name = $2',
      [workspaceId, name],
    );
    if (tagResult.rows.length > 0) {
      await app.pg.query(
        'INSERT INTO task_tag_links (task_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [taskId, tagResult.rows[0].id],
      );
    }
    // Skip unknown tags silently per MVP policy
  }
}

// Enqueue embedding generation
async function enqueueEmbedding(app: FastifyInstance, taskId: string) {
  try {
    await app.redis.lPush('queue:generate_task_embeddings', JSON.stringify({ taskId }));
  } catch { /* non-critical */ }
}

// Create next occurrence for a recurring task
async function createNextRecurrence(app: FastifyInstance, task: any, userId: string) {
  const interval = task.recurrence_interval || 1;
  const baseDate = task.due_date ? new Date(task.due_date) : new Date();

  let nextDate: Date;
  switch (task.recurrence_type) {
    case 'daily':
      nextDate = new Date(baseDate);
      nextDate.setDate(nextDate.getDate() + interval);
      break;
    case 'weekly':
      nextDate = new Date(baseDate);
      nextDate.setDate(nextDate.getDate() + interval * 7);
      break;
    case 'monthly':
      nextDate = new Date(baseDate);
      nextDate.setMonth(nextDate.getMonth() + interval);
      break;
    default:
      return;
  }

  // Check if past end date
  if (task.recurrence_end_date && nextDate > new Date(task.recurrence_end_date)) {
    return;
  }

  const nextDueDate = nextDate.toISOString().slice(0, 10);

  await app.pg.query(
    `INSERT INTO tasks (workspace_id, title, description, status, priority, assignee_id, creator_id, due_date, estimated_minutes, complexity, recurrence_type, recurrence_interval, recurrence_end_date)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [task.workspace_id, task.title, task.description, task.priority, task.assignee_id, userId, nextDueDate,
     task.estimated_minutes, task.complexity || 1, task.recurrence_type, task.recurrence_interval || 1, task.recurrence_end_date],
  );
}

export default async function taskRoutes(app: FastifyInstance) {

  // Cross-workspace tasks for global planner
  const myTasksQuerySchema = paginationSchema.extend({
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    overdue: z.coerce.boolean().optional(),
    workspaceId: z.string().uuid().optional(),
  });

  app.get('/my/tasks', { preHandler: [app.authenticate] }, async (request) => {
    const query = myTasksQuerySchema.parse(request.query);
    const userId = request.user.sub;
    const offset = (query.page - 1) * query.pageSize;

    // Get all workspace IDs the user belongs to
    const wsResult = await app.pg.query(
      'SELECT workspace_id FROM workspace_members WHERE user_id = $1',
      [userId],
    );
    const wsIds = wsResult.rows.map((r: any) => r.workspace_id);
    if (wsIds.length === 0) return { items: [], pagination: { page: 1, pageSize: query.pageSize, total: 0 } };

    // If workspaceId filter is provided, verify membership and narrow
    const filteredIds = query.workspaceId
      ? wsIds.filter((id: string) => id === query.workspaceId)
      : wsIds;
    if (filteredIds.length === 0) return { items: [], pagination: { page: 1, pageSize: query.pageSize, total: 0 } };

    const conditions: string[] = ['t.workspace_id = ANY($1)', 't.archived = false'];
    const params: any[] = [filteredIds];
    let paramIdx = 2;

    if (query.dueDate) {
      conditions.push(`t.due_date::date = $${paramIdx++}`);
      params.push(query.dueDate);
    }
    if (query.overdue) {
      conditions.push("t.due_date < now()");
      conditions.push("t.due_date IS NOT NULL");
      conditions.push("t.status != 'done'");
    }

    const where = conditions.join(' AND ');

    const countResult = await app.pg.query(`SELECT count(*) FROM tasks t WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await app.pg.query(
      `SELECT t.*, u.id as assignee_user_id, u.email as assignee_email, u.name as assignee_name,
              w.name as workspace_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       LEFT JOIN workspaces w ON w.id = t.workspace_id
       WHERE ${where}
       ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, query.pageSize, offset],
    );

    const taskIds = result.rows.map((r: any) => r.id);
    let tagsMap: Record<string, string[]> = {};
    if (taskIds.length > 0) {
      const tagResult = await app.pg.query(
        `SELECT ttl.task_id, tt.name FROM task_tag_links ttl
         JOIN task_tags tt ON tt.id = ttl.tag_id
         WHERE ttl.task_id = ANY($1)`,
        [taskIds],
      );
      for (const r of tagResult.rows) {
        if (!tagsMap[r.task_id]) tagsMap[r.task_id] = [];
        tagsMap[r.task_id].push(r.name);
      }
    }

    return {
      items: result.rows.map((t: any) => ({
        ...formatTask(t, tagsMap[t.id] || []),
        workspaceName: t.workspace_name,
      })),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  });

  // List tasks
  app.get('/workspaces/:workspaceId/tasks', { preHandler: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const query = taskListQuerySchema.parse(request.query);
    await checkMembership(app, workspaceId, request.user.sub);
    const offset = (query.page - 1) * query.pageSize;

    const conditions: string[] = ['t.workspace_id = $1'];
    const params: any[] = [workspaceId];
    let paramIdx = 2;

    if (query.status) {
      conditions.push(`t.status = $${paramIdx++}`);
      params.push(query.status);
    }
    if (query.assigneeId) {
      conditions.push(`t.assignee_id = $${paramIdx++}`);
      params.push(query.assigneeId);
    }
    if (!query.includeArchived) {
      conditions.push('t.archived = false');
    }

    // Deadline filters
    if (query.dueDate) {
      conditions.push(`t.due_date::date = $${paramIdx++}`);
      params.push(query.dueDate);
    }
    if (query.dueBefore) {
      conditions.push(`t.due_date < $${paramIdx++}`);
      params.push(query.dueBefore);
    }
    if (query.dueAfter) {
      conditions.push(`t.due_date >= $${paramIdx++}`);
      params.push(query.dueAfter);
    }
    if (query.overdue) {
      conditions.push("t.due_date < now()");
      conditions.push("t.due_date IS NOT NULL");
      conditions.push("t.status != 'done'");
    }
    if (query.hasDueDate === true) {
      conditions.push('t.due_date IS NOT NULL');
    } else if (query.hasDueDate === false) {
      conditions.push('t.due_date IS NULL');
    }

    const where = conditions.join(' AND ');

    const countResult = await app.pg.query(
      `SELECT count(*) FROM tasks t WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await app.pg.query(
      `SELECT t.*, u.id as assignee_user_id, u.email as assignee_email, u.name as assignee_name
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE ${where}
       ORDER BY t.lane_order NULLS LAST, t.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, query.pageSize, offset],
    );

    // Get tags for all tasks
    const taskIds = result.rows.map((r: any) => r.id);
    let tagsMap: Record<string, string[]> = {};
    if (taskIds.length > 0) {
      const tagResult = await app.pg.query(
        `SELECT ttl.task_id, tt.name FROM task_tag_links ttl
         JOIN task_tags tt ON tt.id = ttl.tag_id
         WHERE ttl.task_id = ANY($1)`,
        [taskIds],
      );
      for (const r of tagResult.rows) {
        if (!tagsMap[r.task_id]) tagsMap[r.task_id] = [];
        tagsMap[r.task_id].push(r.name);
      }
    }

    return {
      items: result.rows.map((t: any) => formatTask(t, tagsMap[t.id] || [])),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  });

  // Create task
  app.post('/workspaces/:workspaceId/tasks', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = createTaskSchema.parse(request.body);
    const userId = request.user.sub;
    await checkMembership(app, workspaceId, userId);

    if (body.status === 'blocked' && !body.blockedReason?.trim()) {
      throw new BadRequestError('Blocked reason is required when status is blocked');
    }

    const result = await app.pg.query(
      `INSERT INTO tasks (workspace_id, title, description, status, priority, blocked_reason, assignee_id, creator_id, due_date, lane_order, estimated_minutes, complexity, recurrence_type, recurrence_interval, recurrence_end_date, next_action, next_action_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [workspaceId, body.title, body.description || null, body.status, body.priority,
       body.blockedReason || null, body.assigneeId || null, userId,
       body.dueDate || null, body.laneOrder || null, body.estimatedMinutes || null, body.complexity || 1,
       body.recurrenceType || null, body.recurrenceInterval || 1, body.recurrenceEndDate || null,
       body.nextAction || null, body.nextAction ? 'set' : 'unclear'],
    );
    const task = result.rows[0];

    await syncTaskTags(app, task.id, workspaceId, body.tags);
    await logActivity(app, task.id, userId, 'created', null, { title: body.title, status: body.status });
    await enqueueEmbedding(app, task.id);

    const full = await getTaskWithTags(app, task.id);
    return reply.status(201).send(full);
  });

  // Get task
  app.get('/tasks/:taskId', { preHandler: [app.authenticate] }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const task = await getTaskWithTags(app, taskId);
    if (!task) throw new NotFoundError('Task not found');
    await checkMembership(app, task.workspaceId, request.user.sub);
    return task;
  });

  // Update task
  // Bulk update multiple tasks at once (common fields only)
  // Registered BEFORE '/tasks/:taskId' so Fastify matches the literal 'bulk' path first.
  const bulkUpdateSchema = z.object({
    taskIds: z.array(z.string().uuid()).min(1).max(200),
    updates: z.object({
      description: z.string().max(5000).optional().nullable(),
      status: statusEnum.optional(),
      priority: priorityEnum.optional(),
      dueDate: z.string().optional().nullable(),
      estimatedMinutes: z.number().int().min(1).max(480).optional().nullable(),
      complexity: z.number().int().min(1).max(3).optional().nullable(),
      assigneeId: z.string().uuid().optional().nullable(),
      blockedReason: z.string().max(1000).optional().nullable(),
      workspaceId: z.string().uuid().optional(),
    }).refine((u) => Object.keys(u).length > 0, { message: 'At least one field must be provided' }),
  });

  app.patch('/tasks/bulk', { preHandler: [app.authenticate] }, async (request) => {
    const body = bulkUpdateSchema.parse(request.body);
    const userId = request.user.sub;
    const { taskIds, updates } = body;

    const existing = await app.pg.query(
      'SELECT id, workspace_id, status, blocked_reason, completed_at, title FROM tasks WHERE id = ANY($1)',
      [taskIds],
    );
    if (existing.rows.length !== taskIds.length) {
      throw new NotFoundError('One or more tasks not found');
    }

    const workspaceIds = Array.from(new Set(existing.rows.map((r: any) => r.workspace_id)));
    for (const wsId of workspaceIds) {
      await checkMembership(app, wsId as string, userId);
    }

    // If moving to a different workspace, verify membership of the target too.
    if (updates.workspaceId) {
      await checkMembership(app, updates.workspaceId, userId);
    }

    if (updates.status === 'blocked' && !updates.blockedReason) {
      const missing = existing.rows.some((r: any) => !r.blocked_reason);
      if (missing) {
        throw new BadRequestError('Blocked reason is required when moving tasks to blocked');
      }
    }

    const client = await app.pg.connect();
    const updatedIds: string[] = [];
    try {
      await client.query('BEGIN');
      for (const row of existing.rows) {
        const newStatus = updates.status ?? row.status;
        const completedAt = newStatus === 'done' && row.status !== 'done'
          ? new Date().toISOString()
          : row.completed_at;

        await client.query(
          `UPDATE tasks SET
             description = CASE WHEN $1::boolean THEN $2 ELSE description END,
             status = COALESCE($3, status),
             priority = COALESCE($4, priority),
             due_date = CASE WHEN $5::boolean THEN $6::timestamptz ELSE due_date END,
             estimated_minutes = CASE WHEN $7::boolean THEN $8::integer ELSE estimated_minutes END,
             complexity = CASE WHEN $9::boolean THEN $10::smallint ELSE complexity END,
             assignee_id = CASE WHEN $11::boolean THEN $12::uuid ELSE assignee_id END,
             blocked_reason = CASE WHEN $13::boolean THEN $14 ELSE blocked_reason END,
             workspace_id = COALESCE($15::uuid, workspace_id),
             completed_at = $16
           WHERE id = $17`,
          [
            updates.description !== undefined, updates.description ?? null,
            updates.status ?? null,
            updates.priority ?? null,
            updates.dueDate !== undefined, updates.dueDate ?? null,
            updates.estimatedMinutes !== undefined, updates.estimatedMinutes ?? null,
            updates.complexity !== undefined, updates.complexity ?? null,
            updates.assigneeId !== undefined, updates.assigneeId ?? null,
            updates.blockedReason !== undefined, updates.blockedReason ?? null,
            updates.workspaceId ?? null,
            completedAt,
            row.id,
          ],
        );
        updatedIds.push(row.id);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    for (const row of existing.rows) {
      await logActivity(
        app,
        row.id,
        userId,
        'bulk_updated',
        { status: row.status, title: row.title },
        updates,
      );
    }

    return { updatedCount: updatedIds.length, taskIds: updatedIds };
  });

  app.patch('/tasks/:taskId', { preHandler: [app.authenticate] }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const body = updateTaskSchema.parse(request.body);
    const userId = request.user.sub;

    const existing = await getTaskWithTags(app, taskId);
    if (!existing) throw new NotFoundError('Task not found');
    await checkMembership(app, existing.workspaceId, userId);

    // Handle workspace move
    if (body.workspaceId && body.workspaceId !== existing.workspaceId) {
      await checkMembership(app, body.workspaceId, userId);
      await app.pg.query('UPDATE tasks SET workspace_id = $1 WHERE id = $2', [body.workspaceId, taskId]);
      await logActivity(app, taskId, userId, 'moved_workspace', { workspaceId: existing.workspaceId }, { workspaceId: body.workspaceId });
    }

    const newStatus = body.status ?? existing.status;
    if (newStatus === 'blocked' && !body.blockedReason && !existing.blockedReason) {
      throw new BadRequestError('Blocked reason is required when status is blocked');
    }

    const completedAt = newStatus === 'done' && existing.status !== 'done' ? new Date().toISOString() : existing.completedAt;

    const result = await app.pg.query(
      `UPDATE tasks SET
        title = COALESCE($1, title),
        description = CASE WHEN $2::boolean THEN $3 ELSE description END,
        status = COALESCE($4, status),
        priority = COALESCE($5, priority),
        blocked_reason = CASE WHEN $6::boolean THEN $7 ELSE blocked_reason END,
        assignee_id = CASE WHEN $8::boolean THEN $9::uuid ELSE assignee_id END,
        due_date = CASE WHEN $10::boolean THEN $11::timestamptz ELSE due_date END,
        lane_order = CASE WHEN $12::boolean THEN $13::numeric ELSE lane_order END,
        archived = COALESCE($14, archived),
        completed_at = $15,
        estimated_minutes = CASE WHEN $17::boolean THEN $18::integer ELSE estimated_minutes END,
        complexity = CASE WHEN $19::boolean THEN $20::smallint ELSE complexity END,
        recurrence_type = CASE WHEN $21::boolean THEN $22::text ELSE recurrence_type END,
        recurrence_interval = CASE WHEN $23::boolean THEN $24::smallint ELSE recurrence_interval END,
        recurrence_end_date = CASE WHEN $25::boolean THEN $26::date ELSE recurrence_end_date END,
        next_action = CASE WHEN $27::boolean THEN $28 ELSE next_action END,
        next_action_state = CASE WHEN $29::boolean THEN $30::text ELSE next_action_state END
       WHERE id = $16 RETURNING *`,
      [
        body.title ?? null,
        body.description !== undefined, body.description ?? null,
        body.status ?? null,
        body.priority ?? null,
        body.blockedReason !== undefined, body.blockedReason ?? null,
        body.assigneeId !== undefined, body.assigneeId ?? null,
        body.dueDate !== undefined, body.dueDate ?? null,
        body.laneOrder !== undefined, body.laneOrder ?? null,
        body.archived ?? null,
        completedAt,
        taskId,
        body.estimatedMinutes !== undefined, body.estimatedMinutes ?? null,
        body.complexity !== undefined, body.complexity ?? null,
        body.recurrenceType !== undefined, body.recurrenceType ?? null,
        body.recurrenceInterval !== undefined, body.recurrenceInterval ?? null,
        body.recurrenceEndDate !== undefined, body.recurrenceEndDate ?? null,
        body.nextAction !== undefined, body.nextAction ?? null,
        body.nextActionState !== undefined, body.nextActionState ?? null,
      ],
    );

    await syncTaskTags(app, taskId, existing.workspaceId, body.tags);
    await logActivity(app, taskId, userId, 'updated', { title: existing.title, status: existing.status }, body);
    await enqueueEmbedding(app, taskId);

    // Auto-create next recurrence when a recurring task is completed
    const justCompleted = newStatus === 'done' && existing.status !== 'done';
    if (justCompleted && result.rows[0].recurrence_type) {
      await createNextRecurrence(app, result.rows[0], userId);
    }

    const full = await getTaskWithTags(app, taskId);
    return full;
  });

  // Delete task
  app.delete('/tasks/:taskId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const existing = await getTaskWithTags(app, taskId);
    if (!existing) throw new NotFoundError('Task not found');
    await checkMembership(app, existing.workspaceId, request.user.sub);

    // Log BEFORE deleting — task_activity has FK task_id referencing tasks(id),
    // so logging after DELETE would fail the FK constraint.
    await logActivity(app, taskId, request.user.sub, 'deleted', { title: existing.title }, null);
    await app.pg.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    return reply.status(204).send();
  });

  // Get task status history + duration per status
  app.get('/tasks/:taskId/status-history', { preHandler: [app.authenticate] }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const task = await getTaskWithTags(app, taskId);
    if (!task) throw new NotFoundError('Task not found');
    await checkMembership(app, task.workspaceId, request.user.sub);

    const histResult = await app.pg.query(
      'SELECT * FROM task_status_history WHERE task_id = $1 ORDER BY changed_at ASC',
      [taskId],
    );

    const entries = histResult.rows;
    const now = new Date();
    const durations: Record<string, number> = {};

    for (let i = 0; i < entries.length; i++) {
      const status = entries[i].new_status;
      const start = new Date(entries[i].changed_at);
      const end = i + 1 < entries.length ? new Date(entries[i + 1].changed_at) : now;
      const days = (end.getTime() - start.getTime()) / 86400000;
      durations[status] = (durations[status] || 0) + days;
    }

    // Round to 1 decimal
    for (const k of Object.keys(durations)) {
      durations[k] = Math.round(durations[k] * 10) / 10;
    }

    return {
      history: entries.map((e: any) => ({
        id: e.id,
        oldStatus: e.old_status,
        newStatus: e.new_status,
        changedBy: e.changed_by,
        changedAt: e.changed_at,
      })),
      durations,
    };
  });

  // Move task
  app.post('/tasks/:taskId/move', { preHandler: [app.authenticate] }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const body = moveTaskSchema.parse(request.body);
    const userId = request.user.sub;

    const existing = await getTaskWithTags(app, taskId);
    if (!existing) throw new NotFoundError('Task not found');
    await checkMembership(app, existing.workspaceId, userId);

    if (body.status === 'blocked' && !body.blockedReason?.trim()) {
      throw new BadRequestError('Blocked reason is required when moving to blocked');
    }

    const completedAt = body.status === 'done' && existing.status !== 'done' ? new Date().toISOString() : (body.status !== 'done' ? null : existing.completedAt);

    await app.pg.query(
      `UPDATE tasks SET status = $1, blocked_reason = $2, lane_order = COALESCE($3, lane_order), completed_at = $4
       WHERE id = $5`,
      [body.status, body.blockedReason || null, body.laneOrder ?? null, completedAt, taskId],
    );

    await logActivity(app, taskId, userId, 'moved', { status: existing.status }, { status: body.status });

    // Auto-create next recurrence when a recurring task is completed via move
    if (body.status === 'done' && existing.status !== 'done') {
      const taskRow = await app.pg.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      if (taskRow.rows[0]?.recurrence_type) {
        await createNextRecurrence(app, taskRow.rows[0], userId);
      }
    }

    const full = await getTaskWithTags(app, taskId);
    return full;
  });

  // ── Task Segments ──

  const splitTaskSchema = z.object({
    mode: z.enum(['equal', 'phases']),
    count: z.number().int().min(2).max(20).optional(),
    phases: z.array(z.object({
      title: z.string().min(1).max(200),
      estimatedMinutes: z.number().int().min(1).max(480).optional(),
      dueDate: z.string().optional(),
    })).min(2).max(20).optional(),
  }).refine(
    (d) => (d.mode === 'equal' && d.count) || (d.mode === 'phases' && d.phases && d.phases.length >= 2),
    { message: 'Equal mode requires count; phases mode requires at least 2 phases' },
  );

  // Split a task into segments
  app.post('/tasks/:taskId/split', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = splitTaskSchema.parse(request.body);
    const userId = request.user.sub;

    const task = await getTaskWithTags(app, taskId);
    if (!task) throw new NotFoundError('Task not found');
    await checkMembership(app, task.workspaceId, userId);

    if (task.hasSegments) {
      throw new BadRequestError('Task already has segments. Remove existing segments first.');
    }

    const segments: { title: string; sequence: number; total: number; minutes: number | null; dueDate: string | null }[] = [];

    if (body.mode === 'equal') {
      const total = body.count!;
      const perPart = task.estimatedMinutes ? Math.ceil(task.estimatedMinutes / total) : null;
      for (let i = 1; i <= total; i++) {
        segments.push({ title: `${task.title} — Part ${i}/${total}`, sequence: i, total, minutes: perPart, dueDate: null });
      }
    } else {
      const total = body.phases!.length;
      for (let i = 0; i < total; i++) {
        const phase = body.phases![i];
        segments.push({
          title: `${task.title} — ${phase.title}`,
          sequence: i + 1,
          total,
          minutes: phase.estimatedMinutes ?? null,
          dueDate: phase.dueDate ?? null,
        });
      }
    }

    // Insert all segments
    for (const seg of segments) {
      await app.pg.query(
        `INSERT INTO task_segments (parent_task_id, title, sequence_number, total_segments, estimated_minutes, due_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [taskId, seg.title, seg.sequence, seg.total, seg.minutes, seg.dueDate],
      );
    }

    // Mark parent as having segments
    await app.pg.query('UPDATE tasks SET has_segments = true WHERE id = $1', [taskId]);

    await logActivity(app, taskId, userId, 'split_into_segments', null, { segmentCount: segments.length, mode: body.mode });

    const updated = await getTaskWithTags(app, taskId);
    const segs = await app.pg.query(
      'SELECT * FROM task_segments WHERE parent_task_id = $1 ORDER BY sequence_number',
      [taskId],
    );

    return reply.status(201).send({
      task: updated,
      segments: segs.rows.map(formatSegment),
    });
  });

  // Get segments for a task
  app.get('/tasks/:taskId/segments', { preHandler: [app.authenticate] }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const task = await getTaskWithTags(app, taskId);
    if (!task) throw new NotFoundError('Task not found');
    await checkMembership(app, task.workspaceId, request.user.sub);

    const result = await app.pg.query(
      'SELECT * FROM task_segments WHERE parent_task_id = $1 ORDER BY sequence_number',
      [taskId],
    );

    return { segments: result.rows.map(formatSegment) };
  });

  const updateSegmentSchema = z.object({
    status: statusEnum.optional(),
    title: z.string().min(1).max(500).optional(),
    estimatedMinutes: z.number().int().min(1).max(480).optional().nullable(),
    dueDate: z.string().optional().nullable(),
  });

  // Update a segment
  app.patch('/task-segments/:segmentId', { preHandler: [app.authenticate] }, async (request) => {
    const { segmentId } = request.params as { segmentId: string };
    const body = updateSegmentSchema.parse(request.body);

    const segResult = await app.pg.query(
      `SELECT s.*, t.workspace_id FROM task_segments s JOIN tasks t ON t.id = s.parent_task_id WHERE s.id = $1`,
      [segmentId],
    );
    if (segResult.rows.length === 0) throw new NotFoundError('Segment not found');
    const seg = segResult.rows[0];
    await checkMembership(app, seg.workspace_id, request.user.sub);

    const completedAt = body.status === 'done' && seg.status !== 'done' ? new Date().toISOString() : (body.status && body.status !== 'done' ? null : seg.completed_at);

    await app.pg.query(
      `UPDATE task_segments SET
        title = COALESCE($1, title),
        status = COALESCE($2, status),
        estimated_minutes = CASE WHEN $3::boolean THEN $4::integer ELSE estimated_minutes END,
        due_date = CASE WHEN $7::boolean THEN $8::date ELSE due_date END,
        completed_at = $5,
        updated_at = now()
       WHERE id = $6`,
      [body.title ?? null, body.status ?? null, body.estimatedMinutes !== undefined, body.estimatedMinutes ?? null, completedAt, segmentId, body.dueDate !== undefined, body.dueDate ?? null],
    );

    // Check if all segments are done → auto-complete parent
    if (body.status === 'done') {
      const allDone = await app.pg.query(
        `SELECT count(*) FILTER (WHERE status != 'done') as remaining FROM task_segments WHERE parent_task_id = $1`,
        [seg.parent_task_id],
      );
      if (parseInt(allDone.rows[0].remaining) === 0) {
        await app.pg.query(
          `UPDATE tasks SET status = 'done', completed_at = now() WHERE id = $1`,
          [seg.parent_task_id],
        );
      }
    }

    const updated = await app.pg.query('SELECT * FROM task_segments WHERE id = $1', [segmentId]);
    return formatSegment(updated.rows[0]);
  });

  // Update next action for a task
  app.patch('/tasks/:taskId/next-action', { preHandler: [app.authenticate] }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const body = z.object({
      nextAction: z.string().max(300).nullable(),
      nextActionState: z.enum(['unclear', 'set', 'done']).optional(),
    }).parse(request.body);
    const userId = request.user.sub;

    const existing = await getTaskWithTags(app, taskId);
    if (!existing) throw new NotFoundError('Task not found');
    await checkMembership(app, existing.workspaceId, userId);

    const state = body.nextActionState ?? (body.nextAction ? 'set' : 'unclear');

    await app.pg.query(
      `UPDATE tasks SET next_action = $1, next_action_state = $2, updated_at = now() WHERE id = $3`,
      [body.nextAction, state, taskId],
    );

    await logActivity(app, taskId, userId, 'next_action_updated',
      { nextAction: existing.nextAction },
      { nextAction: body.nextAction, nextActionState: state },
    );

    const full = await getTaskWithTags(app, taskId);
    return full;
  });

  // Remove all segments from a task
  app.delete('/tasks/:taskId/segments', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = await getTaskWithTags(app, taskId);
    if (!task) throw new NotFoundError('Task not found');
    await checkMembership(app, task.workspaceId, request.user.sub);

    await app.pg.query('DELETE FROM task_segments WHERE parent_task_id = $1', [taskId]);
    await app.pg.query('UPDATE tasks SET has_segments = false WHERE id = $1', [taskId]);

    await logActivity(app, taskId, request.user.sub, 'removed_segments', null, null);
    return reply.status(204).send();
  });

  // PATCH /tasks/:taskId/brain-dump — save scratch notes for a task (auto-saved during focus sessions)
  app.patch('/tasks/:taskId/brain-dump', { preHandler: [app.authenticate] }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const body = z.object({ brainDump: z.string().max(10000) }).parse(request.body);
    const userId = request.user.sub;

    const existing = await getTaskWithTags(app, taskId);
    if (!existing) throw new NotFoundError('Task not found');
    await checkMembership(app, existing.workspaceId, userId);

    await app.pg.query(
      `UPDATE tasks SET brain_dump = $1, updated_at = now() WHERE id = $2`,
      [body.brainDump, taskId],
    );
    return { ok: true };
  });

  // GET /tasks/by-title — find a task by exact title within the user's workspaces.
  // Falls back to matching task_segments.title and returns the parent task, so
  // segment-labelled plan entries (e.g. "Foo — Part 1/4") can still start a
  // focus session on the parent task.
  app.get('/tasks/by-title', { preHandler: [app.authenticate] }, async (request) => {
    const query = z.object({ title: z.string().min(1).max(500) }).parse(request.query);
    const userId = request.user.sub;

    const result = await app.pg.query(
      `SELECT t.id, t.title, t.status, t.next_action, t.next_action_state, t.workspace_id
       FROM tasks t
       JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
       WHERE wm.user_id = $1
         AND t.title = $2
         AND t.archived = false
       ORDER BY t.updated_at DESC
       LIMIT 1`,
      [userId, query.title],
    );

    if (result.rows.length === 0) {
      // Try segment title → parent task
      const segResult = await app.pg.query(
        `SELECT t.id, t.title, t.status, t.next_action, t.next_action_state, t.workspace_id
         FROM task_segments ts
         JOIN tasks t ON t.id = ts.parent_task_id
         JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
         WHERE wm.user_id = $1
           AND ts.title = $2
           AND t.archived = false
         ORDER BY t.updated_at DESC
         LIMIT 1`,
        [userId, query.title],
      );
      if (segResult.rows.length === 0) return { task: null };
      const t = segResult.rows[0];
      // Heal legacy data: if the parent is marked done but still has pending
      // segments (e.g. from before segment-aware focus completion), revive
      // the parent so the remaining segments can actually run.
      if (t.status === 'done') {
        const pending = await app.pg.query(
          `SELECT count(*)::int AS n FROM task_segments WHERE parent_task_id = $1 AND status != 'done'`,
          [t.id],
        );
        if ((pending.rows[0]?.n ?? 0) > 0) {
          await app.pg.query(
            `UPDATE tasks SET status = 'pending', completed_at = NULL WHERE id = $1`,
            [t.id],
          );
          t.status = 'pending';
        }
      }
      return {
        task: {
          id: t.id,
          title: t.title,
          status: t.status,
          nextAction: t.next_action ?? null,
          nextActionState: t.next_action_state ?? 'unclear',
          workspaceId: t.workspace_id,
        },
      };
    }
    const t = result.rows[0];
    return {
      task: {
        id: t.id,
        title: t.title,
        status: t.status,
        nextAction: t.next_action ?? null,
        nextActionState: t.next_action_state ?? 'unclear',
        workspaceId: t.workspace_id,
      },
    };
  });
}

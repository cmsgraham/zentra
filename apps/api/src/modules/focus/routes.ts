import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../lib/errors.js';

const startSessionSchema = z.object({
  taskId: z.string().uuid(),
  plannedMinutes: z.number().int().refine((v) => [15, 25, 50].includes(v), {
    message: 'plannedMinutes must be 15, 25, or 50',
  }).default(25),
});

const extendSessionSchema = z.object({
  additionalMinutes: z.number().int().refine((v) => [15, 25].includes(v), {
    message: 'additionalMinutes must be 15 or 25',
  }),
});

const moveOnSchema = z.object({
  reason: z.enum([
    'ran_out_of_time',
    'lost_focus',
    'blocked',
    'priority_shift',
    'too_big',
    'not_worth_it',
  ]).optional(),
  note: z.string().max(500).optional(),
});

function formatSession(s: any) {
  return {
    id: s.id,
    userId: s.user_id,
    taskId: s.task_id,
    nextActionSnapshot: s.next_action_snapshot,
    plannedMinutes: s.planned_minutes,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    outcome: s.outcome,
    createdAt: s.created_at,
  };
}

export default async function focusRoutes(app: FastifyInstance) {
  // GET /focus/sessions/active — currently running session for this user
  app.get('/focus/sessions/active', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const result = await app.pg.query(
      `SELECT fs.*, t.title as task_title, t.next_action, t.next_action_state
       FROM focus_sessions fs
       JOIN tasks t ON t.id = fs.task_id
       WHERE fs.user_id = $1 AND fs.ended_at IS NULL
       ORDER BY fs.started_at DESC
       LIMIT 1`,
      [userId],
    );

    if (result.rows.length === 0) return { session: null };

    const s = result.rows[0];
    return {
      session: {
        ...formatSession(s),
        task: { title: s.task_title, nextAction: s.next_action, nextActionState: s.next_action_state },
      },
    };
  });

  // GET /focus/sessions/today — all sessions for today (for momentum display)
  app.get('/focus/sessions/today', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const result = await app.pg.query(
      `SELECT fs.*, t.title as task_title
       FROM focus_sessions fs
       JOIN tasks t ON t.id = fs.task_id
       WHERE fs.user_id = $1
         AND fs.started_at >= CURRENT_DATE AT TIME ZONE COALESCE(
           (SELECT timezone FROM users WHERE id = $1), 'UTC'
         )
       ORDER BY fs.started_at ASC`,
      [userId],
    );

    const sessions = result.rows.map((s: any) => ({
      ...formatSession(s),
      taskTitle: s.task_title,
    }));

    const completedCount = sessions.filter((s: any) => s.outcome === 'completed').length;
    const totalMinutes = sessions
      .filter((s: any) => s.outcome === 'completed' && s.endedAt)
      .reduce((sum: number, s: any) => sum + s.plannedMinutes, 0);

    return { sessions, completedCount, totalMinutes };
  });

  // POST /focus/sessions — start a new session
  app.post('/focus/sessions', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const body = startSessionSchema.parse(request.body);

    // Enforce one active session per user
    const active = await app.pg.query(
      'SELECT id FROM focus_sessions WHERE user_id = $1 AND ended_at IS NULL LIMIT 1',
      [userId],
    );
    if (active.rows.length > 0) {
      throw new BadRequestError('A session is already active. End it before starting a new one.');
    }

    // Verify task access
    const taskResult = await app.pg.query(
      `SELECT t.* FROM tasks t
       JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
       WHERE t.id = $1 AND wm.user_id = $2 AND t.archived = false`,
      [body.taskId, userId],
    );
    if (taskResult.rows.length === 0) throw new NotFoundError('Task not found');
    const task = taskResult.rows[0];

    const result = await app.pg.query(
      `INSERT INTO focus_sessions (user_id, task_id, next_action_snapshot, planned_minutes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, body.taskId, task.next_action, body.plannedMinutes],
    );

    return reply.status(201).send({ session: formatSession(result.rows[0]) });
  });

  // PATCH /focus/sessions/:id/complete
  app.patch('/focus/sessions/:id/complete', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    const result = await app.pg.query(
      `UPDATE focus_sessions
       SET ended_at = now(), outcome = 'completed'
       WHERE id = $1 AND user_id = $2 AND ended_at IS NULL
       RETURNING *`,
      [id, userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('Active session not found');

    const taskId = result.rows[0].task_id;

    // If the task has segments, mark only the next pending segment done.
    // The parent is auto-marked done once every segment is complete. This
    // lets a user run N focus sessions — one per segment — without the
    // first completion locking out the rest.
    const segCount = await app.pg.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'done')::int AS done
       FROM task_segments WHERE parent_task_id = $1`,
      [taskId],
    );
    const total = segCount.rows[0]?.total ?? 0;
    const done = segCount.rows[0]?.done ?? 0;

    if (total > 0) {
      // Advance the first pending segment.
      const next = await app.pg.query(
        `SELECT id FROM task_segments
         WHERE parent_task_id = $1 AND status != 'done'
         ORDER BY sequence_number ASC
         LIMIT 1`,
        [taskId],
      );
      if (next.rows.length > 0) {
        await app.pg.query(
          `UPDATE task_segments
           SET status = 'done', completed_at = now(), updated_at = now()
           WHERE id = $1`,
          [next.rows[0].id],
        );
        // If this was the last segment, also flip the parent task to done.
        if (done + 1 >= total) {
          await app.pg.query(
            `UPDATE tasks
             SET status = 'done', completed_at = now(), next_action_state = 'done'
             WHERE id = $1 AND status != 'done'`,
            [taskId],
          );
        }
      }
    } else {
      // No segments — mark the whole task done as before.
      await app.pg.query(
        `UPDATE tasks
         SET status = 'done', completed_at = now(), next_action_state = 'done'
         WHERE id = $1 AND status != 'done'`,
        [taskId],
      );
    }

    return reply.status(200).send({ session: formatSession(result.rows[0]) });
  });

  // PATCH /focus/sessions/:id/abandon — "Move on" (optionally with a self-reason)
  app.patch('/focus/sessions/:id/abandon', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = request.body ? moveOnSchema.parse(request.body) : {};
    const reason = body.reason ?? null;
    const note = body.note?.trim() ? body.note.trim() : null;

    const result = await app.pg.query(
      `UPDATE focus_sessions
       SET ended_at = now(), outcome = 'abandoned',
           move_on_reason = $3, move_on_note = $4
       WHERE id = $1 AND user_id = $2 AND ended_at IS NULL
       RETURNING *`,
      [id, userId, reason, note],
    );
    if (result.rows.length === 0) throw new NotFoundError('Active session not found');

    return reply.status(200).send({ session: formatSession(result.rows[0]) });
  });

  // PATCH /focus/sessions/:id/extend
  app.patch('/focus/sessions/:id/extend', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = extendSessionSchema.parse(request.body);

    // Mark current session completed and start a new one for the same task
    const current = await app.pg.query(
      `UPDATE focus_sessions
       SET ended_at = now(), outcome = 'extended'
       WHERE id = $1 AND user_id = $2 AND ended_at IS NULL
       RETURNING *`,
      [id, userId],
    );
    if (current.rows.length === 0) throw new NotFoundError('Active session not found');

    const prev = current.rows[0];
    const newSession = await app.pg.query(
      `INSERT INTO focus_sessions (user_id, task_id, next_action_snapshot, planned_minutes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, prev.task_id, prev.next_action_snapshot, body.additionalMinutes],
    );

    return reply.status(200).send({ session: formatSession(newSession.rows[0]) });
  });
}

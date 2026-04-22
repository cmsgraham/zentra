import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../lib/errors.js';

const setPrioritySchema = z.object({
  taskId: z.string().uuid(),
});

function formatTask(t: any) {
  return {
    id: t.id,
    workspaceId: t.workspace_id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    nextAction: t.next_action,
    nextActionState: t.next_action_state,
    priorityForDate: t.priority_for_date,
    dueDate: t.due_date,
    creatorId: t.creator_id,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

async function getUserDate(app: FastifyInstance, userId: string): Promise<string> {
  const result = await app.pg.query(
    `SELECT CURRENT_DATE AT TIME ZONE COALESCE(
      (SELECT timezone FROM users WHERE id = $1), 'UTC'
    ) AS local_date`,
    [userId],
  );
  return result.rows[0].local_date;
}

export default async function priorityRoutes(app: FastifyInstance) {
  // GET /priority/today — today's priority task or null
  app.get('/priority/today', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const localDate = await getUserDate(app, userId);

    const result = await app.pg.query(
      `SELECT * FROM tasks
       WHERE priority_for_user_id = $1
         AND priority_for_date = $2
         AND archived = false
       LIMIT 1`,
      [userId, localDate],
    );

    return { task: result.rows.length > 0 ? formatTask(result.rows[0]) : null };
  });

  // POST /priority/today — set a task as today's priority
  app.post('/priority/today', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const body = setPrioritySchema.parse(request.body);
    const localDate = await getUserDate(app, userId);

    // Verify task exists and is accessible to this user
    const taskResult = await app.pg.query(
      `SELECT t.* FROM tasks t
       JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
       WHERE t.id = $1 AND wm.user_id = $2 AND t.archived = false`,
      [body.taskId, userId],
    );
    if (taskResult.rows.length === 0) throw new NotFoundError('Task not found');

    // Clear any existing priority for this user+date to enforce one-per-day
    await app.pg.query(
      `UPDATE tasks SET priority_for_date = NULL, priority_for_user_id = NULL, updated_at = now()
       WHERE priority_for_user_id = $1 AND priority_for_date = $2`,
      [userId, localDate],
    );

    // Set the new priority
    const updated = await app.pg.query(
      `UPDATE tasks
       SET priority_for_date = $1, priority_for_user_id = $2, updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [localDate, userId, body.taskId],
    );

    return reply.status(200).send({ task: formatTask(updated.rows[0]) });
  });

  // DELETE /priority/today — clear today's priority
  app.delete('/priority/today', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const localDate = await getUserDate(app, userId);

    await app.pg.query(
      `UPDATE tasks SET priority_for_date = NULL, priority_for_user_id = NULL, updated_at = now()
       WHERE priority_for_user_id = $1 AND priority_for_date = $2`,
      [userId, localDate],
    );

    return reply.status(204).send();
  });

  // POST /priority/suggest — suggest a priority from yesterday's unfinished + tomorrow reflection
  app.post('/priority/suggest', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const localDate = await getUserDate(app, userId);

    // Check reflection for tomorrow_priority first
    const reflectionResult = await app.pg.query(
      `SELECT tomorrow_priority_task_id, tomorrow_priority_text
       FROM reflections
       WHERE user_id = $1
         AND reflection_date = ($2::date - interval '1 day')::date
       LIMIT 1`,
      [userId, localDate],
    );

    if (reflectionResult.rows.length > 0) {
      const r = reflectionResult.rows[0];
      if (r.tomorrow_priority_task_id) {
        const taskResult = await app.pg.query(
          'SELECT * FROM tasks WHERE id = $1 AND archived = false AND status != $2',
          [r.tomorrow_priority_task_id, 'done'],
        );
        if (taskResult.rows.length > 0) {
          return { suggestion: formatTask(taskResult.rows[0]), source: 'reflection' };
        }
      }
      if (r.tomorrow_priority_text) {
        return { suggestion: null, suggestionText: r.tomorrow_priority_text, source: 'reflection_text' };
      }
    }

    // Fall back to yesterday's unfinished priority
    const yesterday = await app.pg.query(
      `SELECT * FROM tasks
       WHERE priority_for_user_id = $1
         AND priority_for_date = ($2::date - interval '1 day')::date
         AND status != 'done'
         AND archived = false
       LIMIT 1`,
      [userId, localDate],
    );

    if (yesterday.rows.length > 0) {
      return { suggestion: formatTask(yesterday.rows[0]), source: 'yesterday' };
    }

    return { suggestion: null, source: 'none' };
  });
}

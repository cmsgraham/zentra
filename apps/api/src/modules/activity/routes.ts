import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export default async function activityRoutes(app: FastifyInstance) {
  app.get('/tasks/:taskId/activity', { preHandler: [app.authenticate] }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const { page, pageSize } = paginationSchema.parse(request.query);
    const offset = (page - 1) * pageSize;

    const taskResult = await app.pg.query('SELECT workspace_id FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) throw new NotFoundError('Task not found');

    const memberCheck = await app.pg.query(
      'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [taskResult.rows[0].workspace_id, request.user.sub],
    );
    if (memberCheck.rows.length === 0) throw new ForbiddenError();

    const countResult = await app.pg.query(
      'SELECT count(*) FROM task_activity WHERE task_id = $1',
      [taskId],
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await app.pg.query(
      `SELECT id, task_id, actor_id, action_type, before_json, after_json, created_at
       FROM task_activity WHERE task_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [taskId, pageSize, offset],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        taskId: r.task_id,
        actorId: r.actor_id,
        actionType: r.action_type,
        beforeJson: r.before_json,
        afterJson: r.after_json,
        createdAt: r.created_at,
      })),
      pagination: { page, pageSize, total },
    };
  });
}

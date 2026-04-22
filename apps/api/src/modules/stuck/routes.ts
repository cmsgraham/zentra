import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';

const resolveSchema = z.object({
  resolvedBy: z.enum(['broke_it_down', 'changed_task', 'took_a_break', 'just_started', 'abandoned']),
});

export default async function stuckRoutes(app: FastifyInstance) {
  // POST /stuck/events — record that user is stuck during a focus session
  app.post('/stuck/events', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const body = z.object({
      sessionId: z.string().uuid(),
      taskId: z.string().uuid(),
    }).parse(request.body);

    const result = await app.pg.query(
      `INSERT INTO stuck_events (session_id, user_id, task_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [body.sessionId, userId, body.taskId],
    );

    return reply.status(201).send({ stuckEvent: formatStuck(result.rows[0]) });
  });

  // PATCH /stuck/events/:id/resolve — mark stuck event resolved
  app.patch('/stuck/events/:id/resolve', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = resolveSchema.parse(request.body);

    const result = await app.pg.query(
      `UPDATE stuck_events
       SET resolved_by = $1, resolved_at = now()
       WHERE id = $2 AND user_id = $3 AND resolved_at IS NULL
       RETURNING *`,
      [body.resolvedBy, id, userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('Stuck event not found');

    return reply.status(200).send({ stuckEvent: formatStuck(result.rows[0]) });
  });
}

function formatStuck(s: any) {
  return {
    id: s.id,
    sessionId: s.session_id,
    userId: s.user_id,
    taskId: s.task_id,
    resolvedBy: s.resolved_by,
    createdAt: s.created_at,
    resolvedAt: s.resolved_at,
  };
}

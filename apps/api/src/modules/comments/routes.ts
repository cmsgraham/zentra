import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';

const createCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export default async function commentRoutes(app: FastifyInstance) {
  // List comments
  app.get('/tasks/:taskId/comments', { preHandler: [app.authenticate] }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const { page, pageSize } = paginationSchema.parse(request.query);
    const offset = (page - 1) * pageSize;

    // Check task exists and user has access
    const taskResult = await app.pg.query('SELECT workspace_id FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) throw new NotFoundError('Task not found');
    
    const memberCheck = await app.pg.query(
      'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [taskResult.rows[0].workspace_id, request.user.sub],
    );
    if (memberCheck.rows.length === 0) throw new ForbiddenError();

    const countResult = await app.pg.query(
      'SELECT count(*) FROM task_comments WHERE task_id = $1',
      [taskId],
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await app.pg.query(
      `SELECT tc.id, tc.task_id, tc.body, tc.created_at, u.id as author_id, u.email as author_email, u.name as author_name
       FROM task_comments tc JOIN users u ON u.id = tc.author_id
       WHERE tc.task_id = $1
       ORDER BY tc.created_at ASC
       LIMIT $2 OFFSET $3`,
      [taskId, pageSize, offset],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        taskId: r.task_id,
        author: { id: r.author_id, email: r.author_email, name: r.author_name },
        body: r.body,
        createdAt: r.created_at,
      })),
      pagination: { page, pageSize, total },
    };
  });

  // Create comment
  app.post('/tasks/:taskId/comments', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = createCommentSchema.parse(request.body);
    const userId = request.user.sub;

    const taskResult = await app.pg.query('SELECT workspace_id FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) throw new NotFoundError('Task not found');

    const memberCheck = await app.pg.query(
      'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [taskResult.rows[0].workspace_id, userId],
    );
    if (memberCheck.rows.length === 0) throw new ForbiddenError();

    const result = await app.pg.query(
      `INSERT INTO task_comments (task_id, author_id, body) VALUES ($1, $2, $3)
       RETURNING id, task_id, body, created_at`,
      [taskId, userId, body.body],
    );
    const comment = result.rows[0];

    const userResult = await app.pg.query('SELECT id, email, name FROM users WHERE id = $1', [userId]);
    const author = userResult.rows[0];

    // Log activity
    await app.pg.query(
      `INSERT INTO task_activity (task_id, actor_id, action_type, after_json)
       VALUES ($1, $2, $3, $4)`,
      [taskId, userId, 'comment_added', JSON.stringify({ body: body.body })],
    );

    return reply.status(201).send({
      id: comment.id,
      taskId: comment.task_id,
      author: { id: author.id, email: author.email, name: author.name },
      body: comment.body,
      createdAt: comment.created_at,
    });
  });
}

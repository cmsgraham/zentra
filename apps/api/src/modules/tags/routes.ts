import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';

const createTagSchema = z.object({
  name: z.string().min(1).max(100),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

async function checkMembership(app: FastifyInstance, workspaceId: string, userId: string) {
  const result = await app.pg.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  if (result.rows.length === 0) throw new ForbiddenError();
  return result.rows[0].role;
}

export default async function tagRoutes(app: FastifyInstance) {
  // List tags
  app.get('/workspaces/:workspaceId/tags', { preHandler: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { page, pageSize } = paginationSchema.parse(request.query);
    await checkMembership(app, workspaceId, request.user.sub);
    const offset = (page - 1) * pageSize;

    const countResult = await app.pg.query(
      'SELECT count(*) FROM task_tags WHERE workspace_id = $1',
      [workspaceId],
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await app.pg.query(
      `SELECT id, workspace_id, name FROM task_tags
       WHERE workspace_id = $1 ORDER BY name LIMIT $2 OFFSET $3`,
      [workspaceId, pageSize, offset],
    );

    return {
      items: result.rows.map(r => ({ id: r.id, workspaceId: r.workspace_id, name: r.name })),
      pagination: { page, pageSize, total },
    };
  });

  // Create tag
  app.post('/workspaces/:workspaceId/tags', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = createTagSchema.parse(request.body);
    await checkMembership(app, workspaceId, request.user.sub);

    try {
      const result = await app.pg.query(
        'INSERT INTO task_tags (workspace_id, name) VALUES ($1, $2) RETURNING id, workspace_id, name',
        [workspaceId, body.name],
      );
      return reply.status(201).send({
        id: result.rows[0].id,
        workspaceId: result.rows[0].workspace_id,
        name: result.rows[0].name,
      });
    } catch (err: any) {
      if (err.code === '23505') {
        throw new BadRequestError('Tag already exists in this workspace');
      }
      throw err;
    }
  });

  // Delete tag
  app.delete('/workspaces/:workspaceId/tags/:tagId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { workspaceId, tagId } = request.params as { workspaceId: string; tagId: string };
    await checkMembership(app, workspaceId, request.user.sub);

    const result = await app.pg.query(
      'DELETE FROM task_tags WHERE id = $1 AND workspace_id = $2',
      [tagId, workspaceId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundError('Tag not found');
    }

    return reply.status(204).send();
  });
}

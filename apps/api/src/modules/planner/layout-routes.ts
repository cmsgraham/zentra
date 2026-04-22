import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const widgetIdEnum = z.enum([
  'calendar-mood', 'schedule', 'goals', 'pomodoro',
  'due-tasks', 'notes', 'reflection', 'tomorrow', 'today-plan',
]);

const layoutTypeEnum = z.enum([
  'default', 'columns', 'rows', 'grid', 'priority', 'focus', 'custom',
]);

const zoneSchema = z.object({
  id: z.string(),
  height: z.number().min(0).max(1),
  widget: widgetIdEnum.nullable(),
});

const columnSchema = z.object({
  id: z.string(),
  width: z.number().min(0).max(1),
  zones: z.array(zoneSchema).min(1).max(6),
});

const layoutDataSchema = z.object({
  type: layoutTypeEnum,
  columns: z.array(columnSchema).min(1).max(6),
});

export default async function layoutRoutes(app: FastifyInstance) {

  // ── Get current user's planner layout ──
  app.get('/planner/layout', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const result = await app.pg.query(
      'SELECT layout_data FROM planner_layouts WHERE user_id = $1',
      [userId],
    );

    if (result.rows.length === 0) {
      return { layout: null };
    }

    return { layout: result.rows[0].layout_data };
  });

  // ── Save / update planner layout ──
  app.put('/planner/layout', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const layoutData = layoutDataSchema.parse(request.body);

    await app.pg.query(
      `INSERT INTO planner_layouts (user_id, layout_data)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET layout_data = $2, updated_at = now()`,
      [userId, JSON.stringify(layoutData)],
    );

    return { layout: layoutData };
  });

  // ── Reset layout to defaults ──
  app.delete('/planner/layout', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;

    await app.pg.query(
      'DELETE FROM planner_layouts WHERE user_id = $1',
      [userId],
    );

    return reply.status(204).send();
  });
}

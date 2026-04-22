import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const upsertSchema = z.object({
  completedCount: z.number().int().min(0).default(0),
  avoidedText: z.string().max(500).optional(),
  feelingText: z.string().max(500).optional(),
  tomorrowPriorityTaskId: z.string().uuid().nullable().optional(),
  tomorrowPriorityText: z.string().max(300).optional(),
});

function formatReflection(r: any) {
  return {
    id: r.id,
    userId: r.user_id,
    reflectionDate: r.reflection_date,
    completedCount: r.completed_count,
    avoidedText: r.avoided_text,
    feelingText: r.feeling_text,
    tomorrowPriorityTaskId: r.tomorrow_priority_task_id,
    tomorrowPriorityText: r.tomorrow_priority_text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function getUserDate(timezone: string | null) {
  const tz = timezone || 'UTC';
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
}

export default async function reflectionRoutes(app: FastifyInstance) {
  // GET /reflections/today — get today's reflection if it exists
  app.get('/reflections/today', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const tzResult = await app.pg.query('SELECT timezone FROM users WHERE id = $1', [userId]);
    const timezone = tzResult.rows[0]?.timezone ?? null;
    const today = getUserDate(timezone);

    const result = await app.pg.query(
      'SELECT * FROM reflections WHERE user_id = $1 AND reflection_date = $2',
      [userId, today],
    );

    if (result.rows.length === 0) return { reflection: null, date: today };
    return { reflection: formatReflection(result.rows[0]), date: today };
  });

  // POST /reflections — upsert today's reflection
  app.post('/reflections', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const body = upsertSchema.parse(request.body);

    const tzResult = await app.pg.query('SELECT timezone FROM users WHERE id = $1', [userId]);
    const timezone = tzResult.rows[0]?.timezone ?? null;
    const today = getUserDate(timezone);

    const result = await app.pg.query(
      `INSERT INTO reflections
         (user_id, reflection_date, completed_count, avoided_text, feeling_text,
          tomorrow_priority_task_id, tomorrow_priority_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, reflection_date)
       DO UPDATE SET
         completed_count = EXCLUDED.completed_count,
         avoided_text = EXCLUDED.avoided_text,
         feeling_text = EXCLUDED.feeling_text,
         tomorrow_priority_task_id = EXCLUDED.tomorrow_priority_task_id,
         tomorrow_priority_text = EXCLUDED.tomorrow_priority_text,
         updated_at = now()
       RETURNING *`,
      [
        userId,
        today,
        body.completedCount,
        body.avoidedText ?? null,
        body.feelingText ?? null,
        body.tomorrowPriorityTaskId ?? null,
        body.tomorrowPriorityText ?? null,
      ],
    );

    const isNew = result.rows[0].created_at.getTime() === result.rows[0].updated_at.getTime();
    return reply.status(isNew ? 201 : 200).send({ reflection: formatReflection(result.rows[0]) });
  });

  // GET /reflections — paginated list of past reflections
  app.get('/reflections', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const query = request.query as { limit?: string; before?: string };
    const limit = Math.min(parseInt(query.limit ?? '30'), 90);
    const before = query.before ?? new Date().toISOString().slice(0, 10);

    const result = await app.pg.query(
      `SELECT * FROM reflections
       WHERE user_id = $1 AND reflection_date < $2
       ORDER BY reflection_date DESC
       LIMIT $3`,
      [userId, before, limit],
    );

    return { reflections: result.rows.map(formatReflection) };
  });
}

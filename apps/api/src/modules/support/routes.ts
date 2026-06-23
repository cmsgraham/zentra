import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';

const createSchema = z.object({
  category: z.enum(['question', 'bug', 'feedback', 'account', 'other']),
  subject: z.string().min(3).max(160),
  message: z.string().min(10).max(5000),
  appUrl: z.string().max(500).optional(),
});

function formatTicket(t: any) {
  return {
    id: t.id,
    category: t.category,
    subject: t.subject,
    message: t.message,
    status: t.status,
    priority: t.priority,
    staffResponse: t.staff_response,
    respondedAt: t.responded_at,
    appUrl: t.app_url,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

export default async function supportRoutes(app: FastifyInstance) {
  // Tight rate limit on ticket creation to prevent spam
  const createRateLimit = {
    rateLimit: {
      max: 10,
      timeWindow: '1 hour',
    },
  };

  // POST /support/tickets — open a new ticket
  app.post(
    '/support/tickets',
    { preHandler: [app.authenticate], config: createRateLimit },
    async (request, reply) => {
      const userId = request.user.sub;
      const body = createSchema.parse(request.body);
      const userAgent = request.headers['user-agent']?.slice(0, 500) ?? null;

      const result = await app.pg.query(
        `INSERT INTO support_tickets
           (user_id, category, subject, message, user_agent, app_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, body.category, body.subject, body.message, userAgent, body.appUrl ?? null],
      );

      reply.code(201);
      return { ticket: formatTicket(result.rows[0]) };
    },
  );

  // GET /support/tickets — list the current user's tickets
  app.get('/support/tickets', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const result = await app.pg.query(
      `SELECT * FROM support_tickets
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId],
    );
    return { items: result.rows.map(formatTicket) };
  });

  // GET /support/tickets/:id — fetch a single ticket (owned by current user)
  app.get<{ Params: { id: string } }>(
    '/support/tickets/:id',
    { preHandler: [app.authenticate] },
    async (request) => {
      const userId = request.user.sub;
      const { id } = request.params;
      const result = await app.pg.query(
        'SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      if (result.rows.length === 0) throw new NotFoundError('Ticket not found');
      return { ticket: formatTicket(result.rows[0]) };
    },
  );
}

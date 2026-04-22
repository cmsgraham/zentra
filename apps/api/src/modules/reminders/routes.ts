import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';

const createSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(5000).optional(),
  dueAt: z.string().datetime().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().max(5000).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
});

const shareSchema = z.object({
  friendId: z.string().uuid(),
});

const convertSchema = z.object({
  workspaceId: z.string().uuid(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

export default async function reminderRoutes(app: FastifyInstance) {

  // ── List my reminders (owned + shared with me) ──
  app.get('/reminders', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const result = await app.pg.query(
      `SELECT r.id, r.title, r.notes, r.due_at, r.completed_at, r.created_at, r.updated_at,
              r.user_id AS owner_id, u.name AS owner_name,
              CASE WHEN r.user_id = $1 THEN true ELSE false END AS is_owner
       FROM reminders r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN reminder_shares rs ON rs.reminder_id = r.id AND rs.shared_with = $1
       WHERE r.user_id = $1 OR rs.shared_with = $1
       ORDER BY r.completed_at NULLS FIRST, r.due_at ASC NULLS LAST, r.created_at DESC`,
      [userId],
    );
    return {
      items: result.rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        notes: r.notes,
        dueAt: r.due_at,
        completedAt: r.completed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        ownerId: r.owner_id,
        ownerName: r.owner_name,
        isOwner: r.is_owner,
      })),
    };
  });

  // ── Create ──
  app.post('/reminders', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const data = createSchema.parse(request.body);
    const result = await app.pg.query(
      `INSERT INTO reminders (user_id, title, notes, due_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, notes, due_at, completed_at, created_at, updated_at`,
      [userId, data.title, data.notes ?? null, data.dueAt ?? null],
    );
    const r = result.rows[0];
    return reply.status(201).send({
      id: r.id,
      title: r.title,
      notes: r.notes,
      dueAt: r.due_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      isOwner: true,
    });
  });

  // ── Update ──
  app.patch('/reminders/:id', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const data = updateSchema.parse(request.body);

    const existing = await app.pg.query('SELECT user_id FROM reminders WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new NotFoundError();
    if (existing.rows[0].user_id !== userId) throw new ForbiddenError();

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (data.title !== undefined) { sets.push(`title = $${idx++}`); vals.push(data.title); }
    if (data.notes !== undefined) { sets.push(`notes = $${idx++}`); vals.push(data.notes); }
    if (data.dueAt !== undefined) { sets.push(`due_at = $${idx++}`); vals.push(data.dueAt); }

    if (sets.length === 0) throw new BadRequestError('No fields to update');

    sets.push(`updated_at = now()`);
    vals.push(id);

    const result = await app.pg.query(
      `UPDATE reminders SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, title, notes, due_at, completed_at, created_at, updated_at`,
      vals,
    );
    const r = result.rows[0];
    return {
      id: r.id, title: r.title, notes: r.notes,
      dueAt: r.due_at, completedAt: r.completed_at,
      createdAt: r.created_at, updatedAt: r.updated_at, isOwner: true,
    };
  });

  // ── Toggle complete / uncomplete ──
  app.post('/reminders/:id/toggle', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    // Owner or shared-with can toggle
    const check = await app.pg.query(
      `SELECT r.user_id, r.completed_at FROM reminders r
       LEFT JOIN reminder_shares rs ON rs.reminder_id = r.id AND rs.shared_with = $2
       WHERE r.id = $1 AND (r.user_id = $2 OR rs.shared_with = $2)`,
      [id, userId],
    );
    if (check.rows.length === 0) throw new NotFoundError();

    const isCompleted = check.rows[0].completed_at !== null;
    const result = await app.pg.query(
      `UPDATE reminders SET completed_at = $2, updated_at = now() WHERE id = $1
       RETURNING id, title, notes, due_at, completed_at`,
      [id, isCompleted ? null : new Date().toISOString()],
    );
    const r = result.rows[0];
    return { id: r.id, title: r.title, completedAt: r.completed_at };
  });

  // ── Delete ──
  app.delete('/reminders/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    const existing = await app.pg.query('SELECT user_id FROM reminders WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new NotFoundError();
    if (existing.rows[0].user_id !== userId) throw new ForbiddenError();

    await app.pg.query('DELETE FROM reminders WHERE id = $1', [id]);
    return reply.status(204).send();
  });

  // ── Share with a friend ──
  app.post('/reminders/:id/share', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const { friendId } = shareSchema.parse(request.body);

    // Must own the reminder
    const reminder = await app.pg.query('SELECT user_id FROM reminders WHERE id = $1', [id]);
    if (reminder.rows.length === 0) throw new NotFoundError();
    if (reminder.rows[0].user_id !== userId) throw new ForbiddenError();

    // Must be friends
    const friendship = await app.pg.query(
      `SELECT id FROM friendships
       WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
       AND status = 'accepted'`,
      [userId, friendId],
    );
    if (friendship.rows.length === 0) throw new BadRequestError('Must be friends to share');

    await app.pg.query(
      `INSERT INTO reminder_shares (reminder_id, shared_by, shared_with)
       VALUES ($1, $2, $3)
       ON CONFLICT (reminder_id, shared_with) DO NOTHING`,
      [id, userId, friendId],
    );
    return reply.status(201).send({ message: 'Reminder shared' });
  });

  // ── List who a reminder is shared with ──
  app.get('/reminders/:id/shares', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    const reminder = await app.pg.query('SELECT user_id FROM reminders WHERE id = $1', [id]);
    if (reminder.rows.length === 0) throw new NotFoundError();
    if (reminder.rows[0].user_id !== userId) throw new ForbiddenError();

    const result = await app.pg.query(
      `SELECT rs.id AS share_id, rs.shared_with, u.name, u.email, rs.created_at
       FROM reminder_shares rs
       JOIN users u ON u.id = rs.shared_with
       WHERE rs.reminder_id = $1`,
      [id],
    );
    return {
      items: result.rows.map((r: any) => ({
        shareId: r.share_id,
        userId: r.shared_with,
        name: r.name,
        email: r.email,
        sharedAt: r.created_at,
      })),
    };
  });

  // ── Unshare ──
  app.delete('/reminders/:id/share/:shareId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { id, shareId } = request.params as { id: string; shareId: string };

    const reminder = await app.pg.query('SELECT user_id FROM reminders WHERE id = $1', [id]);
    if (reminder.rows.length === 0) throw new NotFoundError();
    if (reminder.rows[0].user_id !== userId) throw new ForbiddenError();

    await app.pg.query('DELETE FROM reminder_shares WHERE id = $1 AND reminder_id = $2', [shareId, id]);
    return reply.status(204).send();
  });

  // ── Convert reminder to task ──
  app.post('/reminders/:id/convert', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const { workspaceId, priority } = convertSchema.parse(request.body);

    // Check ownership or shared access
    const check = await app.pg.query(
      `SELECT r.title, r.notes, r.due_at FROM reminders r
       LEFT JOIN reminder_shares rs ON rs.reminder_id = r.id AND rs.shared_with = $2
       WHERE r.id = $1 AND (r.user_id = $2 OR rs.shared_with = $2)`,
      [id, userId],
    );
    if (check.rows.length === 0) throw new NotFoundError();

    // Verify workspace membership
    const membership = await app.pg.query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    );
    if (membership.rows.length === 0) throw new ForbiddenError();

    const reminder = check.rows[0];

    // Get max lane_order
    const maxOrder = await app.pg.query(
      `SELECT COALESCE(MAX(lane_order), 0) + 1 AS next_order
       FROM tasks WHERE workspace_id = $1 AND status = 'pending' AND archived = false`,
      [workspaceId],
    );

    const taskResult = await app.pg.query(
      `INSERT INTO tasks (workspace_id, title, description, status, priority, creator_id, due_date, lane_order, source_type, source_reference_id)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, 'reminder', $8)
       RETURNING id, title`,
      [
        workspaceId,
        reminder.title,
        reminder.notes ?? null,
        priority,
        userId,
        reminder.due_at ? reminder.due_at.toISOString().slice(0, 10) : null,
        maxOrder.rows[0].next_order,
        id,
      ],
    );

    return {
      taskId: taskResult.rows[0].id,
      taskTitle: taskResult.rows[0].title,
      message: 'Reminder converted to task',
    };
  });
}

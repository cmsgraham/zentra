import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';

const sendRequestSchema = z.object({
  email: z.string().email(),
});

const respondSchema = z.object({
  action: z.enum(['accept', 'reject']),
});

const shareTaskSchema = z.object({
  taskId: z.string().uuid(),
  friendId: z.string().uuid(),
  permission: z.enum(['view', 'edit']).default('view'),
});

export default async function friendRoutes(app: FastifyInstance) {

  // ── List friends (accepted) ──
  app.get('/friends', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const result = await app.pg.query(
      `SELECT
         f.id AS friendship_id,
         CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS friend_id,
         u.name AS friend_name,
         u.email AS friend_email,
         f.created_at
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
       ORDER BY u.name`,
      [userId],
    );

    return { items: result.rows.map(r => ({
      friendshipId: r.friendship_id,
      id: r.friend_id,
      name: r.friend_name,
      email: r.friend_email,
      since: r.created_at,
    })) };
  });

  // ── Pending requests (incoming) ──
  app.get('/friends/requests', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const result = await app.pg.query(
      `SELECT f.id, f.requester_id, u.name, u.email, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId],
    );

    return { items: result.rows.map(r => ({
      id: r.id,
      fromId: r.requester_id,
      fromName: r.name,
      fromEmail: r.email,
      createdAt: r.created_at,
    })) };
  });

  // ── Pending requests (outgoing) ──
  app.get('/friends/sent', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const result = await app.pg.query(
      `SELECT f.id, f.addressee_id, u.name, u.email, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId],
    );

    return { items: result.rows.map(r => ({
      id: r.id,
      toId: r.addressee_id,
      toName: r.name,
      toEmail: r.email,
      createdAt: r.created_at,
    })) };
  });

  // ── Send friend request ──
  app.post('/friends/request', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { email } = sendRequestSchema.parse(request.body);

    // Find target user
    const userResult = await app.pg.query(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    if (userResult.rows.length === 0) {
      throw new NotFoundError('No user found with that email');
    }
    const targetId = userResult.rows[0].id;

    if (targetId === userId) {
      throw new BadRequestError('Cannot send a friend request to yourself');
    }

    // Check existing friendship in either direction
    const existing = await app.pg.query(
      `SELECT id, status FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [userId, targetId],
    );

    if (existing.rows.length > 0) {
      const f = existing.rows[0];
      if (f.status === 'accepted') throw new BadRequestError('Already friends');
      if (f.status === 'pending') throw new BadRequestError('Friend request already pending');
      // If rejected, allow re-sending by updating
      await app.pg.query(
        `UPDATE friendships SET status = 'pending', requester_id = $1, addressee_id = $2, updated_at = now() WHERE id = $3`,
        [userId, targetId, f.id],
      );
      return reply.status(200).send({ message: 'Friend request re-sent' });
    }

    await app.pg.query(
      `INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)`,
      [userId, targetId],
    );

    return reply.status(201).send({ message: 'Friend request sent' });
  });

  // ── Respond to friend request ──
  app.post('/friends/:friendshipId/respond', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { friendshipId } = request.params as { friendshipId: string };
    const { action } = respondSchema.parse(request.body);

    const result = await app.pg.query(
      `SELECT id, addressee_id, status FROM friendships WHERE id = $1`,
      [friendshipId],
    );
    if (result.rows.length === 0) throw new NotFoundError('Friend request not found');

    const friendship = result.rows[0];
    if (friendship.addressee_id !== userId) throw new ForbiddenError('Not your request to respond to');
    if (friendship.status !== 'pending') throw new BadRequestError('Request already responded to');

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    await app.pg.query(
      `UPDATE friendships SET status = $1, updated_at = now() WHERE id = $2`,
      [newStatus, friendshipId],
    );

    return { message: `Friend request ${newStatus}` };
  });

  // ── Remove friend ──
  app.delete('/friends/:friendshipId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { friendshipId } = request.params as { friendshipId: string };

    const result = await app.pg.query(
      `DELETE FROM friendships
       WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)
       RETURNING id`,
      [friendshipId, userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('Friendship not found');

    return reply.status(204).send();
  });

  // ── Share a task with a friend ──
  app.post('/friends/share-task', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { taskId, friendId, permission } = shareTaskSchema.parse(request.body);

    // Verify friendship
    const friendCheck = await app.pg.query(
      `SELECT id FROM friendships
       WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status = 'accepted'`,
      [userId, friendId],
    );
    if (friendCheck.rows.length === 0) throw new ForbiddenError('Not friends with this user');

    // Verify task ownership / membership
    const taskCheck = await app.pg.query(
      `SELECT t.id FROM tasks t
       JOIN workspace_members wm ON wm.workspace_id = t.workspace_id AND wm.user_id = $1
       WHERE t.id = $2`,
      [userId, taskId],
    );
    if (taskCheck.rows.length === 0) throw new NotFoundError('Task not found or no access');

    // Upsert share
    await app.pg.query(
      `INSERT INTO task_shares (task_id, shared_by, shared_with, permission)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, shared_with) DO UPDATE SET permission = $4`,
      [taskId, userId, friendId, permission],
    );

    return reply.status(201).send({ message: 'Task shared' });
  });

  // ── List tasks shared with me ──
  app.get('/friends/shared-tasks', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const result = await app.pg.query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date,
              ts.permission, ts.created_at AS shared_at,
              u.name AS shared_by_name, w.name AS workspace_name
       FROM task_shares ts
       JOIN tasks t ON t.id = ts.task_id
       JOIN users u ON u.id = ts.shared_by
       JOIN workspaces w ON w.id = t.workspace_id
       WHERE ts.shared_with = $1
       ORDER BY ts.created_at DESC`,
      [userId],
    );

    return { items: result.rows.map(r => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.due_date,
      permission: r.permission,
      sharedAt: r.shared_at,
      sharedByName: r.shared_by_name,
      workspaceName: r.workspace_name,
    })) };
  });

  // ── Remove task share ──
  app.delete('/friends/shared-tasks/:shareId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const { shareId } = request.params as { shareId: string };

    const result = await app.pg.query(
      `DELETE FROM task_shares
       WHERE id = $1 AND (shared_by = $2 OR shared_with = $2)
       RETURNING id`,
      [shareId, userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('Share not found');

    return reply.status(204).send();
  });
}

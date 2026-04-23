import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(200),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export default async function workspaceRoutes(app: FastifyInstance) {
  // List user workspaces
  app.get('/workspaces', { preHandler: [app.authenticate] }, async (request) => {
    const { page, pageSize } = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const offset = (page - 1) * pageSize;

    const countResult = await app.pg.query(
      'SELECT count(*) FROM workspace_members WHERE user_id = $1',
      [userId],
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await app.pg.query(
      `SELECT w.id, w.name, wm.role, w.created_at
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = $1
       ORDER BY w.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        name: r.name,
        role: r.role,
        createdAt: r.created_at,
      })),
      pagination: { page, pageSize, total },
    };
  });

  // Create workspace
  app.post('/workspaces', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createWorkspaceSchema.parse(request.body);
    const userId = request.user.sub;

    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const wsResult = await client.query(
        'INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id, name, created_at',
        [body.name, userId],
      );
      const ws = wsResult.rows[0];
      await client.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [ws.id, userId, 'owner'],
      );
      await client.query('COMMIT');
      return reply.status(201).send({
        id: ws.id,
        name: ws.name,
        role: 'owner',
        createdAt: ws.created_at,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // Rename workspace (owner or admin only).
  app.patch('/workspaces/:workspaceId', { preHandler: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = updateWorkspaceSchema.parse(request.body);
    const userId = request.user.sub;

    // Must be owner or admin of this workspace.
    const membership = await app.pg.query(
      `SELECT role FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    );
    if (membership.rows.length === 0) throw new NotFoundError('Workspace not found');
    const role = membership.rows[0].role;
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenError('Only owners or admins can rename a workspace');
    }

    const result = await app.pg.query(
      `UPDATE workspaces SET name = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, name, created_at`,
      [body.name, workspaceId],
    );
    if (result.rows.length === 0) throw new NotFoundError('Workspace not found');
    const ws = result.rows[0];
    return { id: ws.id, name: ws.name, role, createdAt: ws.created_at };
  });

  // Invite member
  app.post('/workspaces/:workspaceId/invites', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = inviteMemberSchema.parse(request.body);
    const userId = request.user.sub;

    // Check caller is owner or admin
    const memberCheck = await app.pg.query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    );
    if (memberCheck.rows.length === 0 || !['owner', 'admin'].includes(memberCheck.rows[0].role)) {
      throw new ForbiddenError('Only owners and admins can invite members');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await app.pg.query(
      `INSERT INTO workspace_invites (workspace_id, email, role, token, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [workspaceId, body.email, body.role, token, userId, expires],
    );

    app.log.info({ inviteToken: token, email: body.email, workspaceId }, 'Invite created');

    return reply.status(202).send({
      email: body.email,
      role: body.role,
      status: 'pending',
    });
  });

  // List pending invites for the authenticated user
  app.get('/workspaces/invites/pending', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    // Get user email
    const userResult = await app.pg.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) throw new BadRequestError('User not found');
    const email = userResult.rows[0].email;

    const result = await app.pg.query(
      `SELECT wi.id, wi.token, wi.role, wi.created_at, wi.expires_at,
              w.id AS workspace_id, w.name AS workspace_name,
              u.name AS invited_by_name
       FROM workspace_invites wi
       JOIN workspaces w ON w.id = wi.workspace_id
       LEFT JOIN users u ON u.id = wi.invited_by
       WHERE wi.email = $1 AND wi.status = 'pending' AND wi.expires_at > NOW()
       ORDER BY wi.created_at DESC`,
      [email],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        token: r.token,
        role: r.role,
        workspaceId: r.workspace_id,
        workspaceName: r.workspace_name,
        invitedByName: r.invited_by_name,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      })),
    };
  });

  // Accept invite
  app.post('/workspaces/invites/accept', async (request, reply) => {
    const body = acceptInviteSchema.parse(request.body);

    const result = await app.pg.query(
      `SELECT id, workspace_id, email, role, status, expires_at
       FROM workspace_invites WHERE token = $1`,
      [body.token],
    );

    if (result.rows.length === 0) {
      throw new BadRequestError('Invalid invite token');
    }

    const invite = result.rows[0];
    if (invite.status !== 'pending') {
      throw new BadRequestError('Invite already used or expired');
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      throw new BadRequestError('Invite has expired');
    }

    // Find or check user by email
    const userResult = await app.pg.query('SELECT id FROM users WHERE email = $1', [invite.email]);
    if (userResult.rows.length === 0) {
      throw new BadRequestError('No account found for this email. Please sign up first.');
    }
    const userId = userResult.rows[0].id;

    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
         VALUES ($1, $2, $3, (SELECT invited_by FROM workspace_invites WHERE id = $4))
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [invite.workspace_id, userId, invite.role, invite.id],
      );
      await client.query(
        "UPDATE workspace_invites SET status = 'accepted' WHERE id = $1",
        [invite.id],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const wsResult = await app.pg.query(
      'SELECT id, name FROM workspaces WHERE id = $1',
      [invite.workspace_id],
    );

    return reply.send({
      workspace: { id: wsResult.rows[0].id, name: wsResult.rows[0].name, role: invite.role, createdAt: wsResult.rows[0].created_at },
      role: invite.role,
    });
  });

  // List workspace members
  app.get('/workspaces/:workspaceId/members', { preHandler: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { page, pageSize } = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const offset = (page - 1) * pageSize;

    // Check membership
    const memberCheck = await app.pg.query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    );
    if (memberCheck.rows.length === 0) {
      throw new ForbiddenError();
    }

    const countResult = await app.pg.query(
      'SELECT count(*) FROM workspace_members WHERE workspace_id = $1',
      [workspaceId],
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await app.pg.query(
      `SELECT u.id, u.email, u.name, wm.role
       FROM workspace_members wm JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.created_at
       LIMIT $2 OFFSET $3`,
      [workspaceId, pageSize, offset],
    );

    return {
      items: result.rows.map(r => ({
        user: { id: r.id, email: r.email, name: r.name },
        role: r.role,
      })),
      pagination: { page, pageSize, total },
    };
  });
}

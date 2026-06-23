import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import os from 'os';
import { promises as fs } from 'fs';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

// ─────────────────────────────────────────────────────────────────────────
//  ADMIN PANEL — Privacy-first
//  Admins NEVER see user content (intentions/notes/echoes/chats).
//  Only counts, metadata, and security-relevant data.
//  Mounted under /zentra-ops to avoid bots scanning /admin.
// ─────────────────────────────────────────────────────────────────────────

async function audit(
  app: FastifyInstance,
  request: FastifyRequest,
  args: {
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const actor = request.user;
    await app.pg.query(
      `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_type, target_id, metadata, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        actor.sub,
        actor.email,
        args.action,
        args.targetType ?? null,
        args.targetId ?? null,
        JSON.stringify(args.metadata ?? {}),
        request.ip ?? null,
        (request.headers['user-agent'] as string | undefined)?.slice(0, 500) ?? null,
      ],
    );
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'audit log insert failed');
  }
}

export default async function adminRoutes(app: FastifyInstance) {
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };

  // ─── Identity check (used by web to gate the panel UI) ────────────────
  app.get('/zentra-ops/whoami', guard, async (request) => {
    const r = await app.pg.query(
      'SELECT id, email, name, role FROM users WHERE id = $1',
      [request.user.sub],
    );
    return r.rows[0];
  });

  // ─── Overview stats ───────────────────────────────────────────────────
  app.get('/zentra-ops/overview', guard, async () => {
    const [
      users,
      activeUsers,
      signups7d,
      signups30d,
      dau,
      wau,
      mau,
      content,
      tickets,
      ai24h,
      logins24h,
    ] = await Promise.all([
      app.pg.query(`SELECT COUNT(*)::int AS n FROM users WHERE status = 'active'`),
      app.pg.query(`SELECT COUNT(*)::int AS n FROM users WHERE status = 'active' AND last_seen_at > now() - interval '30 days'`),
      app.pg.query(`SELECT COUNT(*)::int AS n FROM users WHERE created_at > now() - interval '7 days'`),
      app.pg.query(`SELECT COUNT(*)::int AS n FROM users WHERE created_at > now() - interval '30 days'`),
      app.pg.query(`SELECT COUNT(*)::int AS n FROM users WHERE last_seen_at > now() - interval '1 day'`),
      app.pg.query(`SELECT COUNT(*)::int AS n FROM users WHERE last_seen_at > now() - interval '7 days'`),
      app.pg.query(`SELECT COUNT(*)::int AS n FROM users WHERE last_seen_at > now() - interval '30 days'`),
      app.pg.query(`
        SELECT
          (SELECT COUNT(*) FROM workspaces)::int AS workspaces,
          (SELECT COUNT(*) FROM tasks)::int AS tasks,
          (SELECT COUNT(*) FROM tasks WHERE status = 'done')::int AS tasks_done,
          (SELECT COUNT(*) FROM appointments)::int AS appointments,
          (SELECT COUNT(*) FROM shopping_lists)::int AS shopping_lists,
          (SELECT COUNT(*) FROM reflections)::int AS reflections
      `),
      app.pg.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'open')::int AS open,
          COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
          COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
          COUNT(*)::int AS total
        FROM support_tickets
      `),
      app.pg.query(`
        SELECT
          COUNT(*)::int AS calls,
          COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
          COUNT(*) FILTER (WHERE NOT ok)::int AS errors
        FROM ai_usage_events
        WHERE created_at > now() - interval '24 hours'
      `),
      app.pg.query(`
        SELECT
          COUNT(*) FILTER (WHERE success)::int AS success,
          COUNT(*) FILTER (WHERE NOT success)::int AS failed,
          COUNT(DISTINCT email) FILTER (WHERE NOT success)::int AS failed_unique_emails
        FROM login_attempts
        WHERE created_at > now() - interval '24 hours'
      `),
    ]);

    return {
      users: {
        total: users.rows[0].n,
        active30d: activeUsers.rows[0].n,
        signups7d: signups7d.rows[0].n,
        signups30d: signups30d.rows[0].n,
        dau: dau.rows[0].n,
        wau: wau.rows[0].n,
        mau: mau.rows[0].n,
      },
      content: content.rows[0],
      tickets: tickets.rows[0],
      ai24h: ai24h.rows[0],
      logins24h: logins24h.rows[0],
    };
  });

  // ─── Time series for charts ──────────────────────────────────────────
  app.get('/zentra-ops/timeseries', guard, async (request) => {
    const q = z.object({
      metric: z.enum(['signups', 'logins', 'active_users', 'ai_calls']),
      days: z.coerce.number().int().min(1).max(365).default(30),
    }).parse(request.query);

    let sql = '';
    switch (q.metric) {
      case 'signups':
        sql = `
          SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS value
          FROM users
          WHERE created_at > now() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1
        `;
        break;
      case 'logins':
        sql = `
          SELECT date_trunc('day', created_at)::date AS day,
                 COUNT(*) FILTER (WHERE success)::int AS value
          FROM login_attempts
          WHERE created_at > now() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1
        `;
        break;
      case 'active_users':
        sql = `
          SELECT date_trunc('day', last_seen_at)::date AS day,
                 COUNT(DISTINCT id)::int AS value
          FROM users
          WHERE last_seen_at > now() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1
        `;
        break;
      case 'ai_calls':
        sql = `
          SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS value
          FROM ai_usage_events
          WHERE created_at > now() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1
        `;
        break;
    }
    const r = await app.pg.query(sql, [q.days]);
    return { points: r.rows };
  });

  // ─── Users list (NO content visible — only metadata) ──────────────────
  app.get('/zentra-ops/users', guard, async (request) => {
    const q = z.object({
      search: z.string().optional(),
      status: z.enum(['active', 'suspended', 'deleted', 'all']).default('all'),
      role: z.enum(['user', 'admin', 'all']).default('all'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);

    const where: string[] = [];
    const params: unknown[] = [];
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      where.push(`(LOWER(email) LIKE $${params.length} OR LOWER(name) LIKE $${params.length})`);
    }
    if (q.status !== 'all') {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    if (q.role !== 'all') {
      params.push(q.role);
      where.push(`role = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(q.limit, q.offset);
    const r = await app.pg.query(
      `SELECT id, email, name, role, status, auth_provider, email_verified_at, totp_enabled,
              created_at, last_seen_at, suspended_at, suspended_reason,
              (SELECT COUNT(*) FROM workspaces w WHERE w.owner_id = users.id)::int AS workspaces_owned
       FROM users
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const total = await app.pg.query(`SELECT COUNT(*)::int AS n FROM users ${whereSql}`, params.slice(0, -2));
    return { items: r.rows, total: total.rows[0].n };
  });

  // ─── User detail (counts only — never content) ────────────────────────
  app.get('/zentra-ops/users/:id', guard, async (request) => {
    const { id } = request.params as { id: string };
    const u = await app.pg.query(
      `SELECT id, email, name, role, status, auth_provider, email_verified_at, totp_enabled,
              created_at, last_seen_at, suspended_at, suspended_reason
       FROM users WHERE id = $1`,
      [id],
    );
    if (u.rows.length === 0) throw new NotFoundError('User not found');
    const counts = await app.pg.query(
      `SELECT
         (SELECT COUNT(*) FROM workspaces WHERE owner_id = $1)::int AS workspaces,
         (SELECT COUNT(*) FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE w.owner_id = $1)::int AS tasks,
         (SELECT COUNT(*) FROM appointments a JOIN workspaces w ON w.id = a.workspace_id WHERE w.owner_id = $1)::int AS appointments,
         (SELECT COUNT(*) FROM shopping_lists WHERE user_id = $1)::int AS shopping_lists,
         (SELECT COUNT(*) FROM support_tickets WHERE user_id = $1)::int AS tickets`,
      [id],
    );
    const recentLogins = await app.pg.query(
      `SELECT success, provider, failure_reason, ip, created_at
       FROM login_attempts WHERE user_id = $1 OR email = $2
       ORDER BY created_at DESC LIMIT 20`,
      [id, u.rows[0].email],
    );
    return { user: u.rows[0], counts: counts.rows[0], recentLogins: recentLogins.rows };
  });

  // ─── Suspend / unsuspend ──────────────────────────────────────────────
  app.post('/zentra-ops/users/:id/suspend', guard, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ reason: z.string().max(500).optional() }).parse(request.body ?? {});
    if (id === request.user.sub) throw new BadRequestError('Cannot suspend yourself');
    const r = await app.pg.query(
      `UPDATE users SET status = 'suspended', suspended_at = now(), suspended_reason = $2
       WHERE id = $1 AND status <> 'deleted' RETURNING id, email`,
      [id, body.reason ?? null],
    );
    if (r.rows.length === 0) throw new NotFoundError('User not found');
    // Revoke all sessions.
    await app.pg.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await audit(app, request, { action: 'user.suspend', targetType: 'user', targetId: id, metadata: { reason: body.reason } });
    return { ok: true };
  });

  app.post('/zentra-ops/users/:id/unsuspend', guard, async (request) => {
    const { id } = request.params as { id: string };
    const r = await app.pg.query(
      `UPDATE users SET status = 'active', suspended_at = NULL, suspended_reason = NULL
       WHERE id = $1 AND status = 'suspended' RETURNING id`,
      [id],
    );
    if (r.rows.length === 0) throw new NotFoundError('User not found or not suspended');
    await audit(app, request, { action: 'user.unsuspend', targetType: 'user', targetId: id });
    return { ok: true };
  });

  // ─── Promote / demote admin ───────────────────────────────────────────
  app.post('/zentra-ops/users/:id/role', guard, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ role: z.enum(['user', 'admin']) }).parse(request.body);
    if (id === request.user.sub && body.role === 'user') {
      throw new BadRequestError('Cannot demote yourself');
    }
    const r = await app.pg.query(
      `UPDATE users SET role = $2 WHERE id = $1 RETURNING id`,
      [id, body.role],
    );
    if (r.rows.length === 0) throw new NotFoundError('User not found');
    await audit(app, request, { action: 'user.role', targetType: 'user', targetId: id, metadata: { role: body.role } });
    return { ok: true };
  });

  // ─── Delete user (irreversible — cascades) ───────────────────────────
  app.delete('/zentra-ops/users/:id', guard, async (request) => {
    const { id } = request.params as { id: string };
    if (id === request.user.sub) throw new BadRequestError('Cannot delete yourself');
    const u = await app.pg.query('SELECT email FROM users WHERE id = $1', [id]);
    if (u.rows.length === 0) throw new NotFoundError('User not found');
    await app.pg.query('DELETE FROM users WHERE id = $1', [id]);
    await audit(app, request, { action: 'user.delete', targetType: 'user', targetId: id, metadata: { email: u.rows[0].email } });
    return { ok: true };
  });

  // ─── Support tickets ──────────────────────────────────────────────────
  app.get('/zentra-ops/tickets', guard, async (request) => {
    const q = z.object({
      status: z.enum(['open', 'in_progress', 'resolved', 'closed', 'all']).default('all'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status !== 'all') {
      params.push(q.status);
      where.push(`t.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(q.limit, q.offset);
    const r = await app.pg.query(
      `SELECT t.id, t.category, t.subject, t.message, t.status, t.priority,
              t.staff_response, t.responded_at, t.created_at, t.updated_at,
              u.email AS user_email, u.name AS user_name, u.id AS user_id
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
       ${whereSql}
       ORDER BY t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: r.rows };
  });

  app.patch('/zentra-ops/tickets/:id', guard, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
      priority: z.enum(['low', 'normal', 'high']).optional(),
      staffResponse: z.string().max(5000).optional(),
    }).parse(request.body);
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    if (body.status) { params.push(body.status); sets.push(`status = $${params.length}`); }
    if (body.priority) { params.push(body.priority); sets.push(`priority = $${params.length}`); }
    if (body.staffResponse !== undefined) {
      params.push(body.staffResponse);
      sets.push(`staff_response = $${params.length}`);
      sets.push(`responded_at = now()`);
    }
    params.push(id);
    const r = await app.pg.query(
      `UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params,
    );
    if (r.rows.length === 0) throw new NotFoundError('Ticket not found');
    await audit(app, request, { action: 'ticket.update', targetType: 'ticket', targetId: id, metadata: body });
    return { ok: true };
  });

  // ─── Audit log ────────────────────────────────────────────────────────
  app.get('/zentra-ops/audit', guard, async (request) => {
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
      action: z.string().optional(),
    }).parse(request.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.action) { params.push(`${q.action}%`); where.push(`action LIKE $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(q.limit, q.offset);
    const r = await app.pg.query(
      `SELECT id, actor_email, action, target_type, target_id, metadata, ip, created_at
       FROM admin_audit_log ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: r.rows };
  });

  // ─── Security: failed logins, locked accounts ─────────────────────────
  app.get('/zentra-ops/security', guard, async () => {
    const [recentFailed, topFailed, providers, locked] = await Promise.all([
      app.pg.query(
        `SELECT email, ip, failure_reason, provider, created_at
         FROM login_attempts WHERE NOT success
         ORDER BY created_at DESC LIMIT 50`,
      ),
      app.pg.query(
        `SELECT ip, COUNT(*)::int AS attempts
         FROM login_attempts
         WHERE NOT success AND created_at > now() - interval '24 hours' AND ip IS NOT NULL
         GROUP BY ip ORDER BY attempts DESC LIMIT 20`,
      ),
      app.pg.query(
        `SELECT provider,
                COUNT(*) FILTER (WHERE success)::int AS success,
                COUNT(*) FILTER (WHERE NOT success)::int AS failed
         FROM login_attempts
         WHERE created_at > now() - interval '7 days'
         GROUP BY provider`,
      ),
      app.pg.query(
        `SELECT id, email, status, suspended_at, suspended_reason
         FROM users WHERE status = 'suspended' ORDER BY suspended_at DESC LIMIT 50`,
      ),
    ]);
    return {
      recentFailed: recentFailed.rows,
      topFailedIps: topFailed.rows,
      providers: providers.rows,
      suspended: locked.rows,
    };
  });

  // ─── System health ────────────────────────────────────────────────────
  app.get('/zentra-ops/system', guard, async () => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const load = os.loadavg();
    const uptime = os.uptime();

    let disk: { total: number; free: number; used: number } | null = null;
    try {
      const stat = await fs.statfs?.('/');
      if (stat) {
        const total = Number(stat.blocks) * Number(stat.bsize);
        const free = Number(stat.bavail) * Number(stat.bsize);
        disk = { total, free, used: total - free };
      }
    } catch { /* statfs may not be available */ }

    const dbStats = await app.pg.query(`
      SELECT
        pg_database_size(current_database()) AS db_bytes,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections
    `);

    return {
      node: {
        version: process.version,
        uptimeSec: process.uptime(),
        memory: process.memoryUsage(),
      },
      os: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptimeSec: uptime,
        cpus: cpus.length,
        cpuModel: cpus[0]?.model,
        loadAvg: load,
        memTotal: totalMem,
        memFree: freeMem,
        memUsed: totalMem - freeMem,
      },
      disk,
      db: {
        bytes: Number(dbStats.rows[0].db_bytes),
        connections: dbStats.rows[0].connections,
      },
    };
  });

  // ─── Feature flags ────────────────────────────────────────────────────
  app.get('/zentra-ops/flags', guard, async () => {
    const r = await app.pg.query(`SELECT key, enabled, description, rollout_pct, updated_at FROM feature_flags ORDER BY key`);
    return { items: r.rows };
  });

  app.put('/zentra-ops/flags/:key', guard, async (request) => {
    const { key } = request.params as { key: string };
    const body = z.object({
      enabled: z.boolean(),
      description: z.string().max(500).optional(),
      rolloutPct: z.number().int().min(0).max(100).optional(),
    }).parse(request.body);
    await app.pg.query(
      `INSERT INTO feature_flags (key, enabled, description, rollout_pct, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             description = COALESCE(EXCLUDED.description, feature_flags.description),
             rollout_pct = COALESCE(EXCLUDED.rollout_pct, feature_flags.rollout_pct),
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [key, body.enabled, body.description ?? null, body.rolloutPct ?? null, request.user.sub],
    );
    await audit(app, request, { action: 'flag.set', targetType: 'flag', targetId: key, metadata: body });
    return { ok: true };
  });

  app.delete('/zentra-ops/flags/:key', guard, async (request) => {
    const { key } = request.params as { key: string };
    await app.pg.query(`DELETE FROM feature_flags WHERE key = $1`, [key]);
    await audit(app, request, { action: 'flag.delete', targetType: 'flag', targetId: key });
    return { ok: true };
  });

  // ─── Broadcasts ───────────────────────────────────────────────────────
  app.get('/zentra-ops/broadcasts', guard, async () => {
    const r = await app.pg.query(
      `SELECT id, title, body, severity, active, starts_at, ends_at, created_at
       FROM broadcasts ORDER BY created_at DESC LIMIT 100`,
    );
    return { items: r.rows };
  });

  app.post('/zentra-ops/broadcasts', guard, async (request) => {
    const body = z.object({
      title: z.string().min(1).max(160),
      body: z.string().min(1).max(2000),
      severity: z.enum(['info', 'warning', 'critical']).default('info'),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
    }).parse(request.body);
    const r = await app.pg.query(
      `INSERT INTO broadcasts (title, body, severity, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, $6)
       RETURNING id`,
      [body.title, body.body, body.severity, body.startsAt ?? null, body.endsAt ?? null, request.user.sub],
    );
    await audit(app, request, { action: 'broadcast.create', targetType: 'broadcast', targetId: r.rows[0].id, metadata: { title: body.title } });
    return { id: r.rows[0].id };
  });

  app.patch('/zentra-ops/broadcasts/:id', guard, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ active: z.boolean() }).parse(request.body);
    const r = await app.pg.query(
      `UPDATE broadcasts SET active = $2 WHERE id = $1 RETURNING id`,
      [id, body.active],
    );
    if (r.rows.length === 0) throw new NotFoundError('Broadcast not found');
    await audit(app, request, { action: 'broadcast.update', targetType: 'broadcast', targetId: id, metadata: body });
    return { ok: true };
  });

  app.delete('/zentra-ops/broadcasts/:id', guard, async (request) => {
    const { id } = request.params as { id: string };
    await app.pg.query(`DELETE FROM broadcasts WHERE id = $1`, [id]);
    await audit(app, request, { action: 'broadcast.delete', targetType: 'broadcast', targetId: id });
    return { ok: true };
  });

  // Public endpoint (any authenticated user) to fetch active broadcasts.
  app.get('/broadcasts/active', { preHandler: [app.authenticate] }, async () => {
    const r = await app.pg.query(
      `SELECT id, title, body, severity, starts_at, ends_at
       FROM broadcasts
       WHERE active = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
       ORDER BY starts_at DESC`,
    );
    return { items: r.rows };
  });
}

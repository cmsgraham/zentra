import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { BadRequestError, UnauthorizedError, NotFoundError } from '../../lib/errors.js';
import { getEnv } from '../../lib/env.js';

const signUpSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_DAYS = 14;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export default async function authRoutes(app: FastifyInstance) {
  // Sign up
  app.post('/signup', async (request, reply) => {
    const body = signUpSchema.parse(request.body);

    // Check existing
    const existing = await app.pg.query('SELECT id FROM users WHERE email = $1', [body.email]);
    if (existing.rows.length > 0) {
      throw new BadRequestError('Email already registered');
    }

    const passwordHash = await bcrypt.hash(body.password, SALT_ROUNDS);
    const result = await app.pg.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
      [body.name, body.email, passwordHash],
    );
    const user = result.rows[0];

    const accessToken = app.jwt.sign(
      { sub: user.id, email: user.email, name: user.name },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    const refreshToken = crypto.randomBytes(48).toString('hex');
    const refreshHash = hashToken(refreshToken);
    const refreshExpires = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    await app.pg.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshHash, refreshExpires],
    );

    return reply.status(201).send({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  });

  // Login
  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const result = await app.pg.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [body.email],
    );
    if (result.rows.length === 0) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const accessToken = app.jwt.sign(
      { sub: user.id, email: user.email, name: user.name },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    const refreshToken = crypto.randomBytes(48).toString('hex');
    const refreshHash = hashToken(refreshToken);
    const refreshExpires = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    await app.pg.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshHash, refreshExpires],
    );

    return reply.send({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  });

  // Logout
  app.post('/logout', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    // Revoke all refresh tokens for user
    await app.pg.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    return reply.status(204).send();
  });

  // Refresh token
  app.post('/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const tokenHash = hashToken(body.refreshToken);

    const result = await app.pg.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.email, u.name
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    const row = result.rows[0];
    if (row.revoked_at || new Date(row.expires_at) < new Date()) {
      throw new UnauthorizedError('Refresh token expired or revoked');
    }

    // Rotate: revoke old, issue new
    await app.pg.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);

    const accessToken = app.jwt.sign(
      { sub: row.user_id, email: row.email, name: row.name },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    const newRefreshToken = crypto.randomBytes(48).toString('hex');
    const newHash = hashToken(newRefreshToken);
    const refreshExpires = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    await app.pg.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [row.user_id, newHash, refreshExpires],
    );

    return reply.send({
      accessToken,
      refreshToken: newRefreshToken,
      user: { id: row.user_id, email: row.email, name: row.name },
    });
  });

  // Password reset request
  app.post('/password-reset/request', async (request, reply) => {
    const body = passwordResetRequestSchema.parse(request.body);
    // Always return 202 to avoid email enumeration
    const result = await app.pg.query('SELECT id FROM users WHERE email = $1', [body.email]);
    if (result.rows.length > 0) {
      // In production: send email with reset token
      // For MVP, log the token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      // Store in redis with 1 hour expiry
      await app.redis.set(`password_reset:${tokenHash}`, result.rows[0].id, { EX: 3600 });
      app.log.info({ resetToken: token, email: body.email }, 'Password reset token generated');
    }
    return reply.status(202).send({ message: 'If the email exists, a reset link will be sent' });
  });

  // Password reset confirm
  app.post('/password-reset/confirm', async (request, reply) => {
    const body = passwordResetConfirmSchema.parse(request.body);
    const tokenHash = hashToken(body.token);
    
    const userId = await app.redis.get(`password_reset:${tokenHash}`);
    if (!userId) {
      throw new BadRequestError('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(body.newPassword, SALT_ROUNDS);
    await app.pg.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    
    // Delete used token
    await app.redis.del(`password_reset:${tokenHash}`);
    
    // Revoke all refresh tokens
    await app.pg.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );

    return reply.status(204).send();
  });

  // Get current user
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const result = await app.pg.query(
      `SELECT id, email, name, timezone,
              task_default_priority, task_default_complexity, task_default_estimated_minutes,
              zentra_dnd_start, zentra_dnd_end, zentra_default_session_minutes,
              zentra_start_of_day_time, zentra_end_of_day_time, zentra_ai_opt_in, zentra_plus_until,
              onboarding_completed_at
       FROM users WHERE id = $1`,
      [request.user.sub],
    );
    const u = result.rows[0];
    return {
      id: u.id, email: u.email, name: u.name, timezone: u.timezone,
      taskDefaultPriority: u.task_default_priority,
      taskDefaultComplexity: u.task_default_complexity,
      taskDefaultEstimatedMinutes: u.task_default_estimated_minutes,
      zentraDndStart: u.zentra_dnd_start,
      zentraDndEnd: u.zentra_dnd_end,
      zentraDefaultSessionMinutes: u.zentra_default_session_minutes,
      zentraStartOfDayTime: u.zentra_start_of_day_time,
      zentraEndOfDayTime: u.zentra_end_of_day_time,
      zentraAiOptIn: u.zentra_ai_opt_in,
      zentraPlusUntil: u.zentra_plus_until,
      onboardingCompletedAt: u.onboarding_completed_at,
    };
  });

  // Update profile
  const updateProfileSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    timezone: z.string().min(1).max(100).optional(),
    taskDefaultPriority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    taskDefaultComplexity: z.number().int().min(1).max(3).optional(),
    taskDefaultEstimatedMinutes: z.number().int().min(1).max(480).optional().nullable(),
    zentraDndStart: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    zentraDndEnd: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    zentraDefaultSessionMinutes: z.number().int().refine((v) => [15, 25, 50].includes(v)).optional(),
    zentraStartOfDayTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    zentraEndOfDayTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    zentraAiOptIn: z.boolean().optional(),
    onboardingCompletedAt: z.string().datetime().optional().nullable(),
  });

  app.patch('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = updateProfileSchema.parse(request.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined) { sets.push(`name = $${idx++}`); params.push(body.name); }
    if (body.timezone !== undefined) { sets.push(`timezone = $${idx++}`); params.push(body.timezone); }
    if (body.taskDefaultPriority !== undefined) { sets.push(`task_default_priority = $${idx++}`); params.push(body.taskDefaultPriority); }
    if (body.taskDefaultComplexity !== undefined) { sets.push(`task_default_complexity = $${idx++}`); params.push(body.taskDefaultComplexity); }
    if (body.taskDefaultEstimatedMinutes !== undefined) { sets.push(`task_default_estimated_minutes = $${idx++}`); params.push(body.taskDefaultEstimatedMinutes); }
    if (body.zentraDndStart !== undefined) { sets.push(`zentra_dnd_start = $${idx++}`); params.push(body.zentraDndStart); }
    if (body.zentraDndEnd !== undefined) { sets.push(`zentra_dnd_end = $${idx++}`); params.push(body.zentraDndEnd); }
    if (body.zentraDefaultSessionMinutes !== undefined) { sets.push(`zentra_default_session_minutes = $${idx++}`); params.push(body.zentraDefaultSessionMinutes); }
    if (body.zentraStartOfDayTime !== undefined) { sets.push(`zentra_start_of_day_time = $${idx++}`); params.push(body.zentraStartOfDayTime); }
    if (body.zentraEndOfDayTime !== undefined) { sets.push(`zentra_end_of_day_time = $${idx++}`); params.push(body.zentraEndOfDayTime); }
    if (body.zentraAiOptIn !== undefined) { sets.push(`zentra_ai_opt_in = $${idx++}`); params.push(body.zentraAiOptIn); }
    if (body.onboardingCompletedAt !== undefined) { sets.push(`onboarding_completed_at = $${idx++}`); params.push(body.onboardingCompletedAt); }

    if (sets.length === 0) return reply.status(204).send();

    sets.push(`updated_at = now()`);
    params.push(request.user.sub);

    const result = await app.pg.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, email, name, timezone, task_default_priority, task_default_complexity, task_default_estimated_minutes`,
      params,
    );
    const u = result.rows[0];
    return {
      id: u.id, email: u.email, name: u.name, timezone: u.timezone,
      taskDefaultPriority: u.task_default_priority,
      taskDefaultComplexity: u.task_default_complexity,
      taskDefaultEstimatedMinutes: u.task_default_estimated_minutes,
    };
  });
}

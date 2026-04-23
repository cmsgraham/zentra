import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { BadRequestError, UnauthorizedError, NotFoundError } from '../../lib/errors.js';
import { getEnv } from '../../lib/env.js';
import { sendMail, verificationCodeEmail, passwordResetEmail } from '../../lib/mailer.js';
import { encryptSecret, decryptSecret } from '../../lib/fieldcrypt.js';

const strongPassword = z.string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

const signUpSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: strongPassword,
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
  newPassword: strongPassword,
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = '15m';
const ACCESS_COOKIE_MAX_AGE = 15 * 60; // 15 minutes in seconds
const REFRESH_TOKEN_DAYS = 14;
const REFRESH_COOKIE_MAX_AGE = REFRESH_TOKEN_DAYS * 24 * 60 * 60;

// Account-lockout tuning
const LOGIN_FAIL_WINDOW_SEC = 15 * 60; // 15 min rolling window
const LOGIN_FAIL_LOCK_THRESHOLD = 10;  // lock account after N failures
const LOGIN_LOCK_DURATION_SEC = 30 * 60; // 30 min lockout

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string) {
  const common = {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax' as const,
    path: '/',
  };
  reply.setCookie('zentra_access', accessToken, {
    ...common,
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });
  reply.setCookie('zentra_refresh', refreshToken, {
    ...common,
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie('zentra_access', { path: '/' });
  reply.clearCookie('zentra_refresh', { path: '/api/auth' });
}

async function isAccountLocked(app: FastifyInstance, email: string): Promise<boolean> {
  const locked = await app.redis.get(`auth:lock:${email}`);
  return locked !== null;
}

async function recordLoginFailure(app: FastifyInstance, email: string): Promise<void> {
  const key = `auth:fail:${email}`;
  const count = await app.redis.incr(key);
  if (count === 1) {
    await app.redis.expire(key, LOGIN_FAIL_WINDOW_SEC);
  }
  if (count >= LOGIN_FAIL_LOCK_THRESHOLD) {
    await app.redis.set(`auth:lock:${email}`, '1', { EX: LOGIN_LOCK_DURATION_SEC });
    await app.redis.del(key);
  }
}

async function clearLoginFailures(app: FastifyInstance, email: string): Promise<void> {
  await app.redis.del(`auth:fail:${email}`);
}

// --- Email verification --------------------------------------------------

const EMAIL_CODE_TTL_MIN = 15;

function generateEmailCode(): string {
  // 6-digit numeric code, zero-padded. Uses crypto.randomInt for unbiased output.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashEmailCode(code: string): string {
  // Short code — use SHA-256 (fine because we also rate-limit + expire).
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function issueEmailVerificationCode(
  app: FastifyInstance,
  userId: string,
  email: string,
): Promise<void> {
  const code = generateEmailCode();
  const expires = new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60 * 1000);
  await app.pg.query(
    `UPDATE users
       SET email_verification_code_hash = $1,
           email_verification_expires_at = $2
     WHERE id = $3`,
    [hashEmailCode(code), expires, userId],
  );
  const tpl = verificationCodeEmail(code);
  await sendMail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html }, app.log);
}

// --- 2FA (TOTP) ----------------------------------------------------------

const TOTP_ISSUER = 'Zentra';
const TOTP_CHALLENGE_TTL_SEC = 5 * 60;
const RECOVERY_CODE_COUNT = 10;

function buildTotp(secretBase32: string, email: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

function generateRecoveryCodes(): string[] {
  // 10 codes, format XXXX-XXXX, alphanumeric (no ambiguous chars).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const bytes = crypto.randomBytes(8);
    let s = '';
    for (let j = 0; j < 8; j++) s += alphabet[bytes[j] % alphabet.length];
    out.push(`${s.slice(0, 4)}-${s.slice(4, 8)}`);
  }
  return out;
}

async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  const hashes: string[] = [];
  for (const c of codes) {
    hashes.push(await bcrypt.hash(c, 10));
  }
  return hashes;
}

async function createTotpChallenge(app: FastifyInstance, userId: string): Promise<string> {
  const challenge = crypto.randomBytes(24).toString('hex');
  await app.redis.set(`auth:totp_challenge:${challenge}`, userId, { EX: TOTP_CHALLENGE_TTL_SEC });
  return challenge;
}

async function consumeTotpChallenge(app: FastifyInstance, challenge: string): Promise<string | null> {
  const key = `auth:totp_challenge:${challenge}`;
  const userId = await app.redis.get(key);
  if (!userId) return null;
  await app.redis.del(key);
  return userId;
}

// --- Session issue (shared by signup/login/2fa-verify/google) -----------

async function issueAuthSession(
  app: FastifyInstance,
  reply: FastifyReply,
  user: { id: string; email: string; name: string },
): Promise<void> {
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
  setAuthCookies(reply, accessToken, refreshToken);
}

export default async function authRoutes(app: FastifyInstance) {
  // Sign up
  app.post('/signup', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
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

    // Fire-and-await verification email. Failure to send is not fatal — the
    // user can request a new code from the verify-email page.
    try {
      await issueEmailVerificationCode(app, user.id, user.email);
    } catch (err) {
      app.log.warn({ err: (err as Error).message, userId: user.id }, 'failed to send verification email on signup');
    }

    await issueAuthSession(app, reply, user);
    return reply.status(201).send({
      user: { id: user.id, email: user.email, name: user.name, emailVerified: false },
    });
  });

  // Login
  app.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);

    if (await isAccountLocked(app, body.email)) {
      throw new UnauthorizedError('Account temporarily locked due to too many failed attempts. Try again later.');
    }

    const result = await app.pg.query(
      'SELECT id, email, name, password_hash, totp_enabled FROM users WHERE email = $1',
      [body.email],
    );
    if (result.rows.length === 0) {
      await recordLoginFailure(app, body.email);
      throw new UnauthorizedError('Invalid credentials');
    }

    const user = result.rows[0];
    // Users created via Google OAuth have no password_hash. Tell them how to log in.
    if (!user.password_hash) {
      throw new UnauthorizedError('This account uses Google Sign-In. Use the "Continue with Google" button.');
    }
    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      await recordLoginFailure(app, body.email);
      throw new UnauthorizedError('Invalid credentials');
    }

    await clearLoginFailures(app, body.email);

    // If 2FA is enabled, don't issue cookies yet — return a short-lived
    // challenge token the client must present with the TOTP code.
    if (user.totp_enabled) {
      const challenge = await createTotpChallenge(app, user.id);
      return reply.send({ twofaRequired: true, challenge });
    }

    await issueAuthSession(app, reply, user);
    return reply.send({
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
    clearAuthCookies(reply);
    return reply.status(204).send();
  });

  // Refresh token
  app.post('/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    // Prefer cookie; fall back to body for legacy clients during migration.
    const cookieToken = request.cookies?.zentra_refresh;
    let providedToken = cookieToken;
    if (!providedToken) {
      const parsed = refreshSchema.safeParse(request.body);
      providedToken = parsed.success ? parsed.data.refreshToken : undefined;
    }
    if (!providedToken) {
      throw new UnauthorizedError('Missing refresh token');
    }
    const tokenHash = hashToken(providedToken);

    const result = await app.pg.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.email, u.name
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      clearAuthCookies(reply);
      throw new UnauthorizedError('Invalid refresh token');
    }

    const row = result.rows[0];
    if (row.revoked_at || new Date(row.expires_at) < new Date()) {
      clearAuthCookies(reply);
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

    setAuthCookies(reply, accessToken, newRefreshToken);
    return reply.send({
      user: { id: row.user_id, email: row.email, name: row.name },
    });
  });

  // Password reset request
  app.post('/password-reset/request', {
    config: { rateLimit: { max: 3, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = passwordResetRequestSchema.parse(request.body);
    // Always return 202 to avoid email enumeration
    const result = await app.pg.query(
      'SELECT id, name FROM users WHERE email = $1',
      [body.email],
    );
    if (result.rows.length > 0) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      await app.redis.set(`password_reset:${tokenHash}`, result.rows[0].id, { EX: 3600 });
      app.log.info(
        { email: body.email, tokenFingerprint: tokenHash.slice(0, 8) },
        'password reset token generated',
      );
      const env = getEnv();
      const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
      const tpl = passwordResetEmail(resetUrl);
      try {
        await sendMail({ to: body.email, subject: tpl.subject, text: tpl.text, html: tpl.html }, app.log);
      } catch (err) {
        app.log.warn({ err: (err as Error).message }, 'failed to send password reset email');
      }
    }
    return reply.status(202).send({ message: 'If the email exists, a reset link will be sent' });
  });

  // Password reset confirm
  app.post('/password-reset/confirm', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
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
              theme, onboarding_completed_at,
              email_verified_at, totp_enabled, google_sub,
              password_hash IS NOT NULL AS has_password
       FROM users WHERE id = $1`,
      [request.user.sub],
    );
    const u = result.rows[0];
    // Postgres `time` columns return `HH:MM:SS` — truncate to `HH:MM` for the
    // frontend <input type="time"> fields and to round-trip cleanly through
    // the PATCH validator (which requires `^\d{2}:\d{2}$`).
    const toHHMM = (v: unknown): string | null =>
      typeof v === 'string' && v.length >= 5 ? v.slice(0, 5) : (v as string | null);
    return {
      id: u.id, email: u.email, name: u.name, timezone: u.timezone,
      taskDefaultPriority: u.task_default_priority,
      taskDefaultComplexity: u.task_default_complexity,
      taskDefaultEstimatedMinutes: u.task_default_estimated_minutes,
      zentraDndStart: toHHMM(u.zentra_dnd_start),
      zentraDndEnd: toHHMM(u.zentra_dnd_end),
      zentraDefaultSessionMinutes: u.zentra_default_session_minutes,
      zentraStartOfDayTime: toHHMM(u.zentra_start_of_day_time),
      zentraEndOfDayTime: toHHMM(u.zentra_end_of_day_time),
      zentraAiOptIn: u.zentra_ai_opt_in,
      zentraPlusUntil: u.zentra_plus_until,
      theme: u.theme,
      onboardingCompletedAt: u.onboarding_completed_at,
      emailVerified: !!u.email_verified_at,
      emailVerifiedAt: u.email_verified_at,
      twoFactorEnabled: !!u.totp_enabled,
      googleLinked: !!u.google_sub,
      hasPassword: !!u.has_password,
    };
  });

  // Update profile
  const updateProfileSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    timezone: z.string().min(1).max(100).optional(),
    taskDefaultPriority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    taskDefaultComplexity: z.number().int().min(1).max(3).optional(),
    taskDefaultEstimatedMinutes: z.number().int().min(1).max(480).optional().nullable(),
    zentraDndStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
    zentraDndEnd: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
    zentraDefaultSessionMinutes: z.number().int().refine((v) => [15, 25, 50].includes(v)).optional(),
    zentraStartOfDayTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    zentraEndOfDayTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    zentraAiOptIn: z.boolean().optional(),
    theme: z.enum(['light', 'dark']).optional().nullable(),
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
    if (body.theme !== undefined) { sets.push(`theme = $${idx++}`); params.push(body.theme); }
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

  // ---------------------------------------------------------------------
  // Email verification
  // ---------------------------------------------------------------------

  // Resend (or send) a 6-digit email verification code to the authenticated user
  app.post('/email/verify/request', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const row = await app.pg.query(
      'SELECT email, email_verified_at FROM users WHERE id = $1',
      [request.user.sub],
    );
    if (row.rows.length === 0) throw new NotFoundError('User not found');
    if (row.rows[0].email_verified_at) {
      return reply.status(200).send({ alreadyVerified: true });
    }
    await issueEmailVerificationCode(app, request.user.sub, row.rows[0].email);
    return reply.status(202).send({ message: 'Verification code sent' });
  });

  // Submit the 6-digit code to complete verification
  const emailVerifyConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
  app.post('/email/verify/confirm', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = emailVerifyConfirmSchema.parse(request.body);
    const row = await app.pg.query(
      `SELECT email_verification_code_hash, email_verification_expires_at, email_verified_at
       FROM users WHERE id = $1`,
      [request.user.sub],
    );
    if (row.rows.length === 0) throw new NotFoundError('User not found');
    const r = row.rows[0];
    if (r.email_verified_at) return reply.status(200).send({ alreadyVerified: true });
    if (!r.email_verification_code_hash || !r.email_verification_expires_at) {
      throw new BadRequestError('No verification code pending. Request a new one.');
    }
    if (new Date(r.email_verification_expires_at) < new Date()) {
      throw new BadRequestError('Verification code expired. Request a new one.');
    }
    // Constant-time comparison of the hex digests
    const supplied = Buffer.from(hashEmailCode(body.code), 'hex');
    const expected = Buffer.from(r.email_verification_code_hash, 'hex');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      throw new BadRequestError('Invalid verification code');
    }
    await app.pg.query(
      `UPDATE users
         SET email_verified_at = now(),
             email_verification_code_hash = NULL,
             email_verification_expires_at = NULL
       WHERE id = $1`,
      [request.user.sub],
    );
    return reply.status(200).send({ verified: true });
  });

  // ---------------------------------------------------------------------
  // 2FA (TOTP)
  // ---------------------------------------------------------------------

  // Step 1 of enrolment: generate a fresh secret, store it (not yet enabled),
  // return otpauth URI + QR data URL. If called while already enabled, 400.
  app.post('/2fa/setup', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request) => {
    const u = await app.pg.query(
      'SELECT email, totp_enabled FROM users WHERE id = $1',
      [request.user.sub],
    );
    if (u.rows.length === 0) throw new NotFoundError('User not found');
    if (u.rows[0].totp_enabled) throw new BadRequestError('2FA is already enabled');

    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const enc = encryptSecret(secret);
    await app.pg.query(
      'UPDATE users SET totp_secret_enc = $1, totp_enabled = false WHERE id = $2',
      [enc, request.user.sub],
    );
    const totp = buildTotp(secret, u.rows[0].email);
    const otpauthUrl = totp.toString();
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 256 });
    return { otpauthUrl, qrDataUrl, secret };
  });

  // Step 2: verify a code against the pending secret; on success flip enabled=true
  // and return the recovery codes (shown once, never again).
  const twofaEnableSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
  app.post('/2fa/enable', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request) => {
    const body = twofaEnableSchema.parse(request.body);
    const u = await app.pg.query(
      'SELECT email, totp_secret_enc, totp_enabled FROM users WHERE id = $1',
      [request.user.sub],
    );
    if (u.rows.length === 0) throw new NotFoundError('User not found');
    if (u.rows[0].totp_enabled) throw new BadRequestError('2FA is already enabled');
    if (!u.rows[0].totp_secret_enc) throw new BadRequestError('Run /2fa/setup first');

    const secret = decryptSecret(u.rows[0].totp_secret_enc);
    const totp = buildTotp(secret, u.rows[0].email);
    // Allow ±1 step window for clock skew
    const delta = totp.validate({ token: body.code, window: 1 });
    if (delta === null) throw new BadRequestError('Invalid code');

    const recoveryCodes = generateRecoveryCodes();
    const recoveryHashes = await hashRecoveryCodes(recoveryCodes);
    await app.pg.query(
      `UPDATE users
         SET totp_enabled = true,
             totp_recovery_hashes = $1
       WHERE id = $2`,
      [JSON.stringify(recoveryHashes), request.user.sub],
    );
    return { enabled: true, recoveryCodes };
  });

  // Disable 2FA. Requires current password (or a valid TOTP/recovery code) as a
  // second factor to prevent session-theft-to-disable escalation.
  const twofaDisableSchema = z.object({
    password: z.string().optional(),
    code: z.string().optional(),
  });
  app.post('/2fa/disable', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = twofaDisableSchema.parse(request.body);
    const u = await app.pg.query(
      'SELECT email, password_hash, totp_secret_enc, totp_enabled, totp_recovery_hashes FROM users WHERE id = $1',
      [request.user.sub],
    );
    if (u.rows.length === 0) throw new NotFoundError('User not found');
    if (!u.rows[0].totp_enabled) return reply.status(200).send({ enabled: false });

    let ok = false;
    if (body.password && u.rows[0].password_hash) {
      ok = await bcrypt.compare(body.password, u.rows[0].password_hash);
    }
    if (!ok && body.code && u.rows[0].totp_secret_enc) {
      const secret = decryptSecret(u.rows[0].totp_secret_enc);
      const totp = buildTotp(secret, u.rows[0].email);
      ok = totp.validate({ token: body.code, window: 1 }) !== null;
    }
    if (!ok) throw new UnauthorizedError('Provide current password or a valid 2FA code');

    await app.pg.query(
      `UPDATE users
         SET totp_enabled = false,
             totp_secret_enc = NULL,
             totp_recovery_hashes = '[]'::jsonb
       WHERE id = $1`,
      [request.user.sub],
    );
    return reply.status(200).send({ enabled: false });
  });

  // Second step of login when 2FA is enabled. Consumes the challenge, validates
  // the TOTP (or a recovery code), and issues auth cookies.
  const twofaVerifySchema = z.object({
    challenge: z.string().min(1),
    code: z.string().min(1),
  });
  app.post('/2fa/verify', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = twofaVerifySchema.parse(request.body);
    const userId = await consumeTotpChallenge(app, body.challenge);
    if (!userId) throw new UnauthorizedError('Challenge expired — please sign in again');

    const u = await app.pg.query(
      'SELECT id, email, name, totp_enabled, totp_secret_enc, totp_recovery_hashes FROM users WHERE id = $1',
      [userId],
    );
    if (u.rows.length === 0 || !u.rows[0].totp_enabled || !u.rows[0].totp_secret_enc) {
      throw new UnauthorizedError('2FA not enabled');
    }
    const row = u.rows[0];

    // Try TOTP first
    let ok = false;
    const looksLikeTotp = /^\d{6}$/.test(body.code);
    if (looksLikeTotp) {
      const secret = decryptSecret(row.totp_secret_enc);
      const totp = buildTotp(secret, row.email);
      ok = totp.validate({ token: body.code, window: 1 }) !== null;
    }

    let usedRecoveryCode = false;
    if (!ok) {
      // Try recovery code. Normalize: trim, uppercase; accept "XXXX-XXXX" or "XXXXXXXX".
      const raw = body.code.trim().toUpperCase().replace(/\s+/g, '');
      const normalized = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}` : raw;
      const hashes: string[] = row.totp_recovery_hashes ?? [];
      for (let i = 0; i < hashes.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        if (await bcrypt.compare(normalized, hashes[i])) {
          ok = true;
          usedRecoveryCode = true;
          hashes.splice(i, 1);
          await app.pg.query(
            'UPDATE users SET totp_recovery_hashes = $1 WHERE id = $2',
            [JSON.stringify(hashes), row.id],
          );
          break;
        }
      }
    }

    if (!ok) throw new UnauthorizedError('Invalid code');

    await issueAuthSession(app, reply, { id: row.id, email: row.email, name: row.name });
    return reply.send({
      user: { id: row.id, email: row.email, name: row.name },
      usedRecoveryCode,
    });
  });

  // ---------------------------------------------------------------------
  // Change password (while authenticated)
  // ---------------------------------------------------------------------

  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: strongPassword,
  });
  app.post('/password/change', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    const r = await app.pg.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [request.user.sub],
    );
    if (r.rows.length === 0) throw new NotFoundError('User not found');
    if (!r.rows[0].password_hash) throw new BadRequestError('This account has no password (Google Sign-In). Use the reset flow to set one.');
    const valid = await bcrypt.compare(body.currentPassword, r.rows[0].password_hash);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');
    const hash = await bcrypt.hash(body.newPassword, SALT_ROUNDS);
    await app.pg.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, request.user.sub]);
    // Revoke all refresh tokens so other sessions are kicked out
    await app.pg.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [request.user.sub],
    );
    // Re-issue fresh cookies for the current session
    await issueAuthSession(app, reply, {
      id: request.user.sub,
      email: request.user.email,
      name: request.user.name,
    });
    return reply.status(200).send({ ok: true });
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
// Argument types — derived inline so we don't depend on which sub-package
// exposes the JSON types in this version of @simplewebauthn.
type VerifyRegistrationArgs = Parameters<typeof verifyRegistrationResponse>[0];
type VerifyAuthenticationArgs = Parameters<typeof verifyAuthenticationResponse>[0];
type RegistrationResponseJSON = VerifyRegistrationArgs['response'];
type AuthenticationResponseJSON = VerifyAuthenticationArgs['response'];
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../lib/errors.js';
import { getEnv } from '../../lib/env.js';

// -----------------------------------------------------------------------
// Relying Party (RP) configuration.
//
// rpID MUST equal the eTLD+1 of the page running WebAuthn (no scheme, no port).
// Browsers refuse credentials whose RP doesn't match `window.location.host`.
// We derive it from APP_URL so dev (`localhost`) and prod (`usezentra.app`)
// both work without extra env vars.
// -----------------------------------------------------------------------
function getRp(): { rpID: string; rpName: string; origin: string } {
  const env = getEnv();
  let host: string;
  try {
    host = new URL(env.APP_URL).hostname;
  } catch {
    host = 'localhost';
  }
  return {
    rpID: host,
    rpName: 'Zentra',
    origin: env.APP_URL,
  };
}

const CHALLENGE_TTL_SEC = 5 * 60;
const REG_KEY = (uid: string) => `passkey:reg:${uid}`;
const AUTH_KEY = (cid: string) => `passkey:auth:${cid}`; // cid = challenge id

// Issue session helper — re-uses the cookie-issuing code from the main auth
// module via the exported helper. We keep the JWT signing inline here to
// avoid a circular import; constants must stay in sync.
import bcrypt from 'bcrypt'; // unused but keeps similar import shape; remove if lint complains
import crypto from 'crypto';
void bcrypt;

const ACCESS_TOKEN_TTL = '30m';
const ACCESS_COOKIE_MAX_AGE = 30 * 60;
const REFRESH_TOKEN_DAYS = 60;
const REFRESH_COOKIE_MAX_AGE = REFRESH_TOKEN_DAYS * 24 * 60 * 60;

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueSession(
  app: FastifyInstance,
  reply: import('fastify').FastifyReply,
  user: { id: string; email: string; name: string; role?: 'user' | 'admin' },
): Promise<void> {
  const accessToken = app.jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role ?? 'user' },
    { expiresIn: ACCESS_TOKEN_TTL },
  );
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const refreshHash = hashToken(refreshToken);
  const refreshExpires = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  await app.pg.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, refreshHash, refreshExpires],
  );
  const common = {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax' as const,
    path: '/',
  };
  reply.setCookie('zentra_access', accessToken, { ...common, maxAge: ACCESS_COOKIE_MAX_AGE });
  reply.setCookie('zentra_refresh', refreshToken, {
    ...common,
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
  try { await app.pg.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [user.id]); } catch { /* non-fatal */ }
}

// -----------------------------------------------------------------------

export default async function passkeyRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------
  // REGISTRATION (authed) — bind a new passkey to the current user
  // -------------------------------------------------------------------

  app.post('/passkey/register/options', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request) => {
    const userId = request.user.sub;
    const u = await app.pg.query(
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId],
    );
    if (u.rows.length === 0) throw new NotFoundError('User not found');
    const user = u.rows[0];

    // Existing credentials are excluded so the user doesn't accidentally
    // overwrite a passkey already registered on the same authenticator.
    const existing = await app.pg.query(
      'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1',
      [userId],
    );

    const { rpID, rpName } = getRp();
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email,
      userDisplayName: user.name,
      // userID must be an opaque, stable, non-PII byte sequence per spec.
      // We hash the user UUID to satisfy that and avoid leaking the raw id.
      userID: new Uint8Array(crypto.createHash('sha256').update(user.id).digest()),
      attestationType: 'none',
      authenticatorSelection: {
        // Prefer platform authenticator (Face ID / Touch ID / Windows Hello).
        // 'preferred' still allows hardware keys.
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: existing.rows.map((r) => ({
        id: r.credential_id,
        transports: r.transports ? r.transports.split(',') : undefined,
      })),
    });

    await app.redis.set(REG_KEY(userId), options.challenge, { EX: CHALLENGE_TTL_SEC });
    return options;
  });

  const registerVerifySchema = z.object({
    response: z.any(),
    nickname: z.string().max(80).optional(),
  });

  app.post('/passkey/register/verify', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request) => {
    const body = registerVerifySchema.parse(request.body);
    const userId = request.user.sub;
    const expectedChallenge = await app.redis.get(REG_KEY(userId));
    if (!expectedChallenge) throw new BadRequestError('Registration challenge expired. Try again.');

    const { rpID, origin } = getRp();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      throw new BadRequestError(`Passkey registration failed: ${(err as Error).message}`);
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestError('Passkey registration could not be verified');
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    // simplewebauthn v11+: credential is { id, publicKey, counter, transports? }
    // Fields are already base64url-encoded strings where applicable.
    const credId: string = credential.id;
    const pubKeyB64u: string = Buffer.from(credential.publicKey).toString('base64url');
    const transports = credential.transports?.join(',') ?? null;

    await app.pg.query(
      `INSERT INTO webauthn_credentials
         (user_id, credential_id, public_key, counter, transports, device_type, backed_up, nickname)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (credential_id) DO NOTHING`,
      [
        userId,
        credId,
        pubKeyB64u,
        Number(credential.counter ?? 0),
        transports,
        credentialDeviceType === 'singleDevice' ? 'platform' : 'cross-platform',
        !!credentialBackedUp,
        body.nickname?.trim() || 'Passkey',
      ],
    );

    await app.redis.del(REG_KEY(userId));
    return { ok: true };
  });

  // -------------------------------------------------------------------
  // AUTHENTICATION (unauthenticated) — sign in with a passkey
  // -------------------------------------------------------------------

  app.post('/passkey/login/options', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async () => {
    const { rpID } = getRp();
    const options = await generateAuthenticationOptions({
      rpID,
      // Discoverable credentials — no `allowCredentials`, the browser/OS shows
      // the picker. This is the "usernameless" flow that triggers Face ID
      // immediately on iPhone Safari.
      userVerification: 'preferred',
    });
    // Bind the challenge to a server-generated id so the client doesn't have
    // to roundtrip user identity until verification.
    const challengeId = crypto.randomBytes(16).toString('hex');
    await app.redis.set(AUTH_KEY(challengeId), options.challenge, { EX: CHALLENGE_TTL_SEC });
    return { challengeId, options };
  });

  const loginVerifySchema = z.object({
    challengeId: z.string().min(1),
    response: z.any(),
  });

  app.post('/passkey/login/verify', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = loginVerifySchema.parse(request.body);
    const expectedChallenge = await app.redis.get(AUTH_KEY(body.challengeId));
    if (!expectedChallenge) throw new BadRequestError('Login challenge expired. Try again.');
    await app.redis.del(AUTH_KEY(body.challengeId));

    const resp = body.response as AuthenticationResponseJSON;
    const credIdB64u = resp.id;
    if (!credIdB64u) throw new BadRequestError('Malformed passkey response');

    const credRow = await app.pg.query(
      `SELECT c.id, c.user_id, c.public_key, c.counter, c.transports,
              u.email, u.name, u.role, u.status
         FROM webauthn_credentials c
         JOIN users u ON u.id = c.user_id
        WHERE c.credential_id = $1`,
      [credIdB64u],
    );
    if (credRow.rows.length === 0) throw new UnauthorizedError('Unknown passkey');
    const row = credRow.rows[0];
    if (row.status === 'suspended') throw new UnauthorizedError('Account suspended');
    if (row.status === 'deleted') throw new UnauthorizedError('Invalid credentials');

    const { rpID, origin } = getRp();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: resp,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: row.credential_id ?? credIdB64u,
          publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
          counter: Number(row.counter),
          transports: row.transports ? row.transports.split(',') : undefined,
        },
        requireUserVerification: false,
      });
    } catch (err) {
      throw new UnauthorizedError(`Passkey verification failed: ${(err as Error).message}`);
    }

    if (!verification.verified) throw new UnauthorizedError('Passkey verification failed');

    // Update counter + last-used. Counter MUST be monotonic per spec — but
    // many platform authenticators (Apple) always send 0; in that case we
    // just store 0 and don't enforce monotonicity.
    const newCounter = Number(verification.authenticationInfo.newCounter ?? 0);
    await app.pg.query(
      'UPDATE webauthn_credentials SET counter = $1, last_used_at = now() WHERE id = $2',
      [newCounter, row.id],
    );

    // Log success in login_attempts table for the security dashboard.
    try {
      await app.pg.query(
        `INSERT INTO login_attempts (email, user_id, success, provider, ip, user_agent)
         VALUES ($1, $2, true, 'passkey', $3, $4)`,
        [
          row.email,
          row.user_id,
          request.ip ?? null,
          (request.headers['user-agent'] as string | undefined)?.slice(0, 500) ?? null,
        ],
      );
    } catch { /* non-fatal */ }

    await issueSession(app, reply, {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role || 'user',
    });

    return reply.send({
      user: { id: row.user_id, email: row.email, name: row.name, role: row.role || 'user' },
    });
  });

  // -------------------------------------------------------------------
  // MANAGEMENT (authed)
  // -------------------------------------------------------------------

  app.get('/passkeys', { preHandler: [app.authenticate] }, async (request) => {
    const r = await app.pg.query(
      `SELECT id, nickname, device_type, backed_up, transports, created_at, last_used_at
         FROM webauthn_credentials
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [request.user.sub],
    );
    return r.rows.map((c) => ({
      id: c.id,
      nickname: c.nickname,
      deviceType: c.device_type,
      backedUp: c.backed_up,
      transports: c.transports ? c.transports.split(',') : [],
      createdAt: c.created_at,
      lastUsedAt: c.last_used_at,
    }));
  });

  app.delete('/passkeys/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = await app.pg.query(
      'DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2',
      [id, request.user.sub],
    );
    if (r.rowCount === 0) throw new NotFoundError('Passkey not found');
    return reply.status(204).send();
  });

  const renameSchema = z.object({ nickname: z.string().min(1).max(80) });
  app.patch('/passkeys/:id', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = renameSchema.parse(request.body);
    const r = await app.pg.query(
      'UPDATE webauthn_credentials SET nickname = $1 WHERE id = $2 AND user_id = $3 RETURNING id',
      [body.nickname.trim(), id, request.user.sub],
    );
    if (r.rowCount === 0) throw new NotFoundError('Passkey not found');
    return { ok: true };
  });
}

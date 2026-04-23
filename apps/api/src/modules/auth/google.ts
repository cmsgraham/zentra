import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import oauth2, { type OAuth2Namespace } from '@fastify/oauth2';
import { getEnv } from '../../lib/env.js';

/**
 * Google "Sign in with Zentra" OAuth2 flow.
 *
 * GET  /auth/google              → 302 to Google consent
 * GET  /auth/google/callback     → validates, finds/creates user, sets cookies,
 *                                  302s back to `APP_URL/today`
 *
 * Registration is conditional on GOOGLE_CLIENT_ID/SECRET being configured —
 * this lets dev and mis-configured prod environments still boot cleanly.
 */
export default async function googleAuthRoutes(app: FastifyInstance) {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    app.log.warn('Google OAuth disabled (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set)');
    return;
  }

  // @ts-expect-error — PRESET is a value import that the types don't fully expose under NodeNext
  const GOOGLE_CONFIGURATION = oauth2.GOOGLE_CONFIGURATION as OAuth2Namespace['discovery'] | undefined;

  await app.register(oauth2, {
    name: 'googleOAuth2',
    credentials: {
      client: {
        id: env.GOOGLE_CLIENT_ID,
        secret: env.GOOGLE_CLIENT_SECRET,
      },
      auth: GOOGLE_CONFIGURATION ?? {
        authorizeHost: 'https://accounts.google.com',
        authorizePath: '/o/oauth2/v2/auth',
        tokenHost: 'https://oauth2.googleapis.com',
        tokenPath: '/token',
      },
    },
    scope: ['openid', 'email', 'profile'],
    startRedirectPath: '/google',
    callbackUri: `${env.APP_URL}/api/auth/google/callback`,
  });

  // Type augmentation — @fastify/oauth2 decorates the app with the namespace.
  const oauthApp = app as FastifyInstance & { googleOAuth2: OAuth2Namespace };

  app.get('/google/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    let token;
    try {
      const result = await oauthApp.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      token = result.token;
    } catch (err) {
      app.log.warn({ err: (err as Error).message }, 'google oauth: code exchange failed');
      return reply.redirect(`${env.APP_URL}/login?error=google_oauth_failed`);
    }

    // Fetch profile
    let profile: { sub: string; email: string; email_verified?: boolean; name?: string; picture?: string };
    try {
      const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!res.ok) throw new Error(`userinfo ${res.status}`);
      profile = await res.json();
    } catch (err) {
      app.log.warn({ err: (err as Error).message }, 'google oauth: userinfo fetch failed');
      return reply.redirect(`${env.APP_URL}/login?error=google_profile_failed`);
    }

    if (!profile.email) {
      return reply.redirect(`${env.APP_URL}/login?error=google_no_email`);
    }

    const email = profile.email.toLowerCase();
    const emailVerifiedByGoogle = profile.email_verified !== false;

    // Find by google_sub or by email
    let userRow = (await app.pg.query(
      `SELECT id, email, name FROM users WHERE google_sub = $1`,
      [profile.sub],
    )).rows[0];

    if (!userRow) {
      const byEmail = (await app.pg.query(
        `SELECT id, email, name, google_sub FROM users WHERE email = $1`,
        [email],
      )).rows[0];

      if (byEmail) {
        // Auto-link: Google has verified this email, so attach the google_sub
        // and mark email verified (if it wasn't already).
        await app.pg.query(
          `UPDATE users
             SET google_sub = $1,
                 email_verified_at = COALESCE(email_verified_at, now())
           WHERE id = $2`,
          [profile.sub, byEmail.id],
        );
        userRow = byEmail;
      } else {
        // Brand-new user. Create with no password_hash.
        const name = (profile.name || email.split('@')[0]).slice(0, 200);
        const inserted = await app.pg.query(
          `INSERT INTO users (name, email, google_sub, email_verified_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, name`,
          [name, email, profile.sub, emailVerifiedByGoogle ? new Date() : null],
        );
        userRow = inserted.rows[0];
      }
    }

    // Issue session (same logic as password login)
    const accessToken = app.jwt.sign(
      { sub: userRow.id, email: userRow.email, name: userRow.name },
      { expiresIn: '15m' },
    );
    const refreshToken = crypto.randomBytes(48).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const refreshExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await app.pg.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userRow.id, refreshHash, refreshExpires],
    );
    const common = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
    reply.setCookie('zentra_access', accessToken, { ...common, maxAge: 15 * 60 });
    reply.setCookie('zentra_refresh', refreshToken, {
      ...common,
      path: '/api/auth',
      maxAge: 14 * 24 * 60 * 60,
    });

    return reply.redirect(`${env.APP_URL}/today`);
  });
}

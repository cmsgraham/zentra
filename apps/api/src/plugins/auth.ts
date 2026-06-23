import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getEnv } from '../lib/env.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; name: string; role?: 'user' | 'admin' };
    user: { sub: string; email: string; name: string; role?: 'user' | 'admin' };
  }
}

export default fp(async (app: FastifyInstance) => {
  const env = getEnv();
  
  await app.register(fjwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: 'zentra_access',
      signed: false,
    },
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      // @fastify/jwt will check Authorization header first, then the configured cookie.
      await request.jwtVerify();
    } catch {
      throw new UnauthorizedError();
    }
  });

  // Admin guard — call AFTER authenticate. Verifies the user is an active
  // admin in the DB (re-checks every request; doesn't trust JWT alone).
  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedError();
    const result = await app.pg.query(
      'SELECT role, status FROM users WHERE id = $1',
      [userId],
    );
    if (result.rows.length === 0) throw new UnauthorizedError();
    const { role, status } = result.rows[0];
    if (status !== 'active') throw new ForbiddenError('Account inactive');
    if (role !== 'admin') throw new ForbiddenError('Admin only');
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

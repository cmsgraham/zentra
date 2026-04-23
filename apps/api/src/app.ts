import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import dbPlugin from './plugins/db.js';
import authPlugin from './plugins/auth.js';
import s3Plugin from './plugins/s3.js';
import redisPlugin from './plugins/redis.js';
import { AppError } from './lib/errors.js';
import { getEnv } from './lib/env.js';

import authRoutes from './modules/auth/routes.js';
import googleAuthRoutes from './modules/auth/google.js';
import workspaceRoutes from './modules/workspaces/routes.js';
import tagRoutes from './modules/tags/routes.js';
import taskRoutes from './modules/tasks/routes.js';
import commentRoutes from './modules/comments/routes.js';
import activityRoutes from './modules/activity/routes.js';
import aiImportRoutes from './modules/ai-import/routes.js';
import aiSuggestionRoutes from './modules/ai-suggestions/routes.js';
import appointmentRoutes from './modules/appointments/routes.js';
import plannerRoutes from './modules/planner/routes.js';
import layoutRoutes from './modules/planner/layout-routes.js';
import friendRoutes from './modules/friends/routes.js';
import shoppingRoutes from './modules/shopping/routes.js';
import shoppingAIRoutes from './modules/shopping/ai-routes.js';
import plannerAIRoutes from './modules/planner/ai-routes.js';
import appointmentAIRoutes from './modules/appointments/ai-routes.js';
import reminderRoutes from './modules/reminders/routes.js';
import priorityRoutes from './modules/priority/routes.js';
import focusRoutes from './modules/focus/routes.js';
import stuckRoutes from './modules/stuck/routes.js';
import reflectionRoutes from './modules/reflections/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'body.password',
          'body.newPassword',
          'body.currentPassword',
          'body.refreshToken',
          'body.token',
          'body.code',
          'resetToken',
        ],
        remove: true,
      },
    },
    trustProxy: true,
  });

  const env = getEnv();
  const allowedOrigins = new Set(
    [env.APP_URL, 'http://localhost:3000', 'http://127.0.0.1:3000']
      .filter(Boolean),
  );

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // Caddy sets CSP at edge
    crossOriginEmbedderPolicy: false,
  });

  // Cookies (HttpOnly auth tokens)
  await app.register(cookie, {
    secret: env.JWT_SECRET,
    parseOptions: {},
  });

  // CORS
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow server-to-server / curl / same-origin (no Origin header)
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  // Multipart for file uploads
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  // Plugins
  await app.register(dbPlugin);
  await app.register(authPlugin);
  await app.register(s3Plugin);
  await app.register(redisPlugin);

  // Error handler
  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.error,
        message: error.message,
      });
    }
    const err = error as Record<string, unknown>;
    if (err.statusCode === 429) {
      return reply.status(429).send({
        error: 'TooManyRequests',
        message: String(err.message ?? 'Rate limit exceeded'),
      });
    }
    if (err.validation) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: String(err.message ?? 'Validation error'),
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    });
  });

  // Health check
  app.get('/health', async () => ({ ok: true, timestamp: new Date().toISOString() }));

  // Routes
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(googleAuthRoutes, { prefix: '/auth' });
  await app.register(workspaceRoutes);
  await app.register(tagRoutes);
  await app.register(taskRoutes);
  await app.register(commentRoutes);
  await app.register(activityRoutes);
  await app.register(aiImportRoutes);
  await app.register(aiSuggestionRoutes);
  await app.register(appointmentRoutes);
  await app.register(plannerRoutes);
  await app.register(layoutRoutes);
  await app.register(friendRoutes);
  await app.register(shoppingRoutes);
  await app.register(shoppingAIRoutes);
  await app.register(plannerAIRoutes);
  await app.register(appointmentAIRoutes);
  await app.register(reminderRoutes);
  await app.register(priorityRoutes);
  await app.register(focusRoutes);
  await app.register(stuckRoutes);
  await app.register(reflectionRoutes);

  return app;
}

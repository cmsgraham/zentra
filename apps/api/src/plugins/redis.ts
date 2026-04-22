import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createClient, type RedisClientType } from 'redis';
import { getEnv } from '../lib/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: RedisClientType;
  }
}

export default fp(async (app: FastifyInstance) => {
  const env = getEnv();
  
  const redis = createClient({ url: env.REDIS_URL }) as RedisClientType;
  
  redis.on('error', (err) => app.log.error({ err }, 'Redis error'));
  
  await redis.connect();
  app.log.info('Connected to Redis');

  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    await redis.quit();
  });
});

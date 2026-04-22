import pg from 'pg';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getEnv } from '../lib/env.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

declare module 'fastify' {
  interface FastifyInstance {
    pg: pg.Pool;
  }
}

export default fp(async (app: FastifyInstance) => {
  const env = getEnv();
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

  // Test connection
  const client = await pool.connect();
  app.log.info('Connected to PostgreSQL');
  client.release();

  app.decorate('pg', pool);

  app.addHook('onClose', async () => {
    await pool.end();
  });
});

export async function runMigrations(pool: pg.Pool) {
  const { readdirSync } = await import('fs');
  let migrationsDir = join(__dirname, '../../../db/migrations');
  let files: string[];
  try {
    files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  } catch {
    migrationsDir = join(__dirname, '../../../../db/migrations');
    files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  }

  // Ensure tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Load already-applied migrations
  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(r => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
  }
}

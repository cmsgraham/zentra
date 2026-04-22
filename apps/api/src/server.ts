import { buildApp } from './app.js';
import { runMigrations } from './plugins/db.js';
import pg from 'pg';
import { getEnv } from './lib/env.js';

const start = async () => {
  const env = getEnv();

  // Run migrations
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  try {
    await runMigrations(pool);
    console.log('Migrations completed');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }

  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

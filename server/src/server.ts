import { env } from './config/env';
import { createApp } from './app';
import { pool } from './db/pool';
import { runMigrations } from './db/migrate';
import { syncSystemData } from './db/bootstrap';
import { logger } from './lib/logger';
import { startScheduler } from './jobs/scheduler';

async function main() {
  await runMigrations();
  await syncSystemData();
  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(`Dawa API listening on http://${env.HOST}:${env.PORT}`);
  });
  const stopScheduler = startScheduler();
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopScheduler();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});

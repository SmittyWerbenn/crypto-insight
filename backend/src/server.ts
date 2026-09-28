import { env } from './config/env.js';
import { closeDb, initDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { startJobs } from './jobs/scheduler.js';
import { buildApp } from './app.js';
import { marketStream } from './services/binance/stream.js';
import { cache } from './services/cache/cache.js';
import { startBacktestWorker, stopBacktestWorker } from './services/backtest/backtest.service.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info({ mock: env.MOCK_MODE, model: env.ANTHROPIC_MODEL, ai: Boolean(env.ANTHROPIC_API_KEY) }, 'Starting CryptoInsight AI backend');
  if (!env.APP_PASSWORD && env.NODE_ENV === 'production') logger.warn('APP_PASSWORD is not set: the API is open to anyone who can reach it');
  await cache.init();
  if (await initDb()) await runMigrations();
  startBacktestWorker();
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  if (env.ENABLE_WEBSOCKET) marketStream.start();
  if (env.ENABLE_JOBS) startJobs();

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'Shutting down');
    marketStream.stop();
    await app.close();
    await stopBacktestWorker();
    await cache.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  logger.fatal(e, 'Fatal startup error');
  process.exit(1);
});

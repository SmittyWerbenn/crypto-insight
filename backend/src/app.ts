import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { env } from './config/env.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { registerAuth } from './routes/auth.routes.js';
import { analysisRoutes } from './routes/analysis.routes.js';
import { backtestRoutes } from './routes/backtest.routes.js';
import { marketRoutes } from './routes/market.routes.js';
import { plannerRoutes } from './routes/planner.routes.js';
import { paperRoutes } from './routes/paper.routes.js';
import { signalRoutes } from './routes/signals.routes.js';
import { systemRoutes } from './routes/system.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { cache } from './services/cache/cache.js';
import { logger } from './utils/logger.js';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    requestTimeout: 120_000,
    bodyLimit: 256 * 1024,
    trustProxy: true,
    disableRequestLogging: env.NODE_ENV === 'test',
  });
  // API-only server: allow cross-origin reads (e.g. the GitHub Pages frontend); CORS still restricts origins.
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  const origins = env.CORS_ORIGIN.split(',').map((s) => s.trim());
  await app.register(cors, { origin: origins.includes('*') ? true : origins, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['content-type', 'authorization'] });
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis: cache.connection ?? undefined,
    allowList: (req) => req.url.startsWith('/api/stream') || req.url === '/api/health',
  });
  registerErrorHandler(app);
  registerAuth(app);
  await app.register(systemRoutes);
  await app.register(marketRoutes);
  await app.register(analysisRoutes);
  await app.register(signalRoutes);
  await app.register(backtestRoutes);
  await app.register(userRoutes);
  await app.register(plannerRoutes);
  await app.register(paperRoutes);
  return app;
}

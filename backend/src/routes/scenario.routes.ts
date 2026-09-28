import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isDbReady } from '../db/client.js';
import { AppError } from '../utils/errors.js';
import { IdParam } from '../utils/validation.js';
import { logger } from '../utils/logger.js';
import {
  evaluateScenarioRun,
  getScenarioRun,
  isScenarioRunning,
  latestScenario,
  listScenarioRuns,
  nextRunAt,
  runScenario,
  scenarioConfig,
  SCENARIO_STYLES,
} from '../services/planner/scenario.service.js';

export async function scenarioRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/scenario') && !isDbReady()) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Skenario Otomatis membutuhkan database (DATABASE_URL).');
  });

  /** Latest scan + schedule info. */
  app.get('/api/scenario', async () => ({
    config: scenarioConfig(),
    styles: SCENARIO_STYLES,
    running: await isScenarioRunning(),
    nextRunAt: new Date(nextRunAt()).toISOString(),
    latest: await latestScenario(),
  }));

  app.get('/api/scenario/runs', async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    const runs = await listScenarioRuns(limit);
    // Attach paper-trading results so the history shows how each scan's picks turned out
    return Promise.all(
      runs.map(async (r) => ({
        id: r.id,
        createdAt: r.createdAt,
        trigger: r.trigger,
        status: r.status,
        error: r.error,
        fxRate: r.fxRate,
        picksByTag: Object.fromEntries(r.styles.map((s) => [s.tag, s.picks.length])),
        evaluation: r.status === 'OK' ? (await evaluateScenarioRun(r)).totals : null,
      })),
    );
  });

  app.get('/api/scenario/runs/:id', async (req) => {
    const run = await getScenarioRun(IdParam.parse(req.params).id);
    return { ...run, evaluation: run.status === 'OK' ? await evaluateScenarioRun(run) : null };
  });

  /** Manual "scan now". Runs in the background; poll GET /api/scenario. */
  app.post('/api/scenario/run', { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (_req, reply) => {
    if (await isScenarioRunning()) throw new AppError(409, 'SCENARIO_RUNNING', 'Scan skenario sedang berjalan. Tunggu hingga selesai.');
    void runScenario('manual').catch((e) => logger.error({ err: (e as Error).message }, 'Manual scenario failed'));
    return reply.status(202).send({ started: true });
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import type { Timeframe } from '../config/timeframes.js';
import { aiStatus, analyzeCoin, dailyAnalysis, marketSummary } from '../services/analysis/analysis.service.js';
import { SymbolParam, TimeframeSchema } from '../utils/validation.js';

const TfQuery = z.object({ timeframe: z.string().default(env.ANALYSIS_TIMEFRAME).pipe(TimeframeSchema) });

export async function analysisRoutes(app: FastifyInstance) {
  app.get('/api/analysis/status', async () => aiStatus());
  app.get('/api/analysis/summary', async () => marketSummary(false));
  app.post('/api/analysis/summary', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async () => marketSummary(true));
  app.get('/api/analysis/daily', async (req) => dailyAnalysis(TfQuery.parse(req.query).timeframe as Timeframe));

  app.get('/api/analysis/:symbol', async (req) => {
    const { symbol } = SymbolParam.parse(req.params);
    const { timeframe } = TfQuery.parse(req.query);
    // GET never triggers a paid AI call: returns stored AI for this candle if present
    return analyzeCoin(symbol, timeframe as Timeframe, 'none');
  });

  // "Analyze Now": runs the full pipeline including Claude (reuses cached AI for an identical context)
  app.post('/api/analysis/:symbol', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { symbol } = SymbolParam.parse(req.params);
    const { timeframe } = TfQuery.parse(req.query);
    const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    return analyzeCoin(symbol, timeframe as Timeframe, force ? 'force' : 'auto');
  });
}

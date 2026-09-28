import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SIGNALS } from '../services/claude/schemas.js';
import { conditionStudy } from '../services/historical/condition-study.js';
import { getCandles } from '../services/market/candles.service.js';
import { listSignals, signalPerformance } from '../services/signals/signals.service.js';
import { SymbolParam, TimeframeSchema } from '../utils/validation.js';
import { cache } from '../services/cache/cache.js';
import { marketData } from '../services/binance/index.js';

const ListQuery = z.object({
  signal: z.enum(SIGNALS).optional(),
  status: z.enum(['PENDING', 'OPEN', 'TARGET_HIT', 'STOP_HIT', 'TIMEOUT', 'INVALIDATED', 'AMBIGUOUS']).optional(),
  timeframe: TimeframeSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const boolQ = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

export async function signalRoutes(app: FastifyInstance) {
  app.get('/api/signals', async (req) => listSignals(ListQuery.parse(req.query)));
  app.get('/api/signals/performance', async (req) => {
    const { timeframe } = z.object({ timeframe: TimeframeSchema.optional() }).parse(req.query);
    return (await signalPerformance({ timeframe })) ?? { unavailable: true, message: 'Signal history requires the database.' };
  });

  /** Historical condition study, e.g. BUY BTC when RSI 50-70, MACD bullish, price > MA50. */
  app.get('/api/signals/query', async (req) => {
    const q = z
      .object({
        symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/),
        timeframe: z.string().default('4h').pipe(TimeframeSchema),
        signal: z.enum(SIGNALS).optional(),
        rsiMin: z.coerce.number().min(0).max(100).optional(),
        rsiMax: z.coerce.number().min(0).max(100).optional(),
        macd: z.enum(['bullish', 'bearish']).optional(),
        priceAboveMa20: boolQ,
        priceAboveMa50: boolQ,
        priceAboveMa200: boolQ,
        volumeAboveAvg: boolQ,
        horizon: z.coerce.number().int().min(1).max(200).default(6),
        candles: z.coerce.number().int().min(300).max(5000).default(3000),
      })
      .parse(req.query);
    const { symbol, timeframe, candles: n, ...cond } = q;
    return cache.wrap(`study:${marketData.source}:${JSON.stringify(q)}`, 600, async () => {
      const candles = await getCandles(symbol, timeframe, { limit: n });
      return { symbol, ...conditionStudy(candles, timeframe, cond) };
    });
  });

  app.get('/api/signals/:symbol', async (req) => {
    const { symbol } = SymbolParam.parse(req.params);
    return listSignals({ ...ListQuery.parse(req.query), symbol });
  });
}

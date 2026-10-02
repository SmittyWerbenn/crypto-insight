import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isDbReady } from '../db/client.js';
import { AppError } from '../utils/errors.js';
import { latestScans, scanPaper, topUpPaper, updatePaperSettings } from '../services/paper/engine.js';
import { paperAssets, paperDaily, paperEquity, paperSummary, paperTradesList } from '../services/paper/paper.service.js';
import { RESEARCH_V2 } from '../services/paper/research-v2.data.js';

export async function paperRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/paper') && !req.url.startsWith('/api/paper/research') && !isDbReady())
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Paper Trading membutuhkan database (DATABASE_URL).');
  });

  /** Account summary: equity, cash, invested, P&L, drawdown, outcome stats, open positions, config. */
  app.get('/api/paper', async () => paperSummary());

  app.get('/api/paper/trades', async (req) => {
    const { limit, offset } = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return paperTradesList(limit, offset);
  });

  /** Capital ledger (every BUY/SELL + hourly mark) — the equity curve. */
  app.get('/api/paper/equity', async () => paperEquity());
  app.get('/api/paper/daily', async () => paperDaily());
  app.get('/api/paper/assets', async () => paperAssets());

  /** Hourly scan log: market filter, signals, entries, skips — explains every HOLD CASH. */
  app.get('/api/paper/scans', async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(48) }).parse(req.query);
    return latestScans(limit);
  });

  /** Run the hourly scan now (normally scheduled). */
  app.post('/api/paper/scan', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async () => {
    const r = await scanPaper();
    if (!r) throw new AppError(409, 'PAPER_BUSY', 'Paper Trading sedang memproses. Coba lagi sebentar.');
    return r;
  });

  /** Fee per side (0–1%) and compounding on/off. Applies to new trades. */
  app.put('/api/paper/settings', async (req) => {
    const b = z
      .object({ feeRatePct: z.coerce.number().min(0).max(1).optional(), compounding: z.boolean().optional() })
      .refine((v) => v.feeRatePct !== undefined || v.compounding !== undefined, 'Tidak ada pengaturan yang diubah')
      .parse(req.body ?? {});
    return updatePaperSettings({ ...(b.feeRatePct !== undefined ? { feeRate: b.feeRatePct / 100 } : {}), ...(b.compounding !== undefined ? { compounding: b.compounding } : {}) });
  });

  /** Add virtual capital (recorded as TOPUP; not counted as profit). */
  app.post('/api/paper/topup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const { amount } = z.object({ amount: z.coerce.number().min(10_000).max(100_000_000) }).parse(req.body ?? {});
    return topUpPaper(amount);
  });

  /** Research behind V2: old-system baseline, backtest/validation/test results, robustness grid. Static. */
  app.get('/api/paper/research', async () => RESEARCH_V2);
}

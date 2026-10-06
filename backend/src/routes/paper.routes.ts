import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isDbReady } from '../db/client.js';
import { AppError } from '../utils/errors.js';
import { latestScans, scanPaper, topUpPaper, updatePaperSettings } from '../services/paper/engine.js';
import { paperAssets, paperCompare, paperDaily, paperEquity, paperMonthly, paperSignalLog, paperSummary, paperTradesList } from '../services/paper/paper.service.js';
import { PROFILE_IDS } from '../services/paper/strategy.js';
import { RESEARCH_PROFILES } from '../services/paper/research-profiles.data.js';
import { RESEARCH_V2 } from '../services/paper/research-v2.data.js';

const profileQ = z.object({ profile: z.enum(PROFILE_IDS as [string, ...string[]]).default('MENENGAH') });
const profileOf = (q: unknown) => profileQ.parse(q ?? {}).profile as (typeof PROFILE_IDS)[number];

export async function paperRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/paper') && !req.url.startsWith('/api/paper/research') && !isDbReady())
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Paper Trading membutuhkan database (DATABASE_URL).');
  });

  // Every account endpoint takes ?profile=AMAN|MENENGAH|AGRESIF (default MENENGAH).
  /** Account summary: equity, cash, invested, P&L, drawdown, outcome stats, open positions, config. */
  app.get('/api/paper', async (req) => paperSummary(profileOf(req.query)));

  app.get('/api/paper/trades', async (req) => {
    const { limit, offset } = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return paperTradesList(profileOf(req.query), limit, offset);
  });

  /** Capital ledger (every BUY/SELL + hourly mark) — the equity curve. */
  app.get('/api/paper/equity', async (req) => paperEquity(profileOf(req.query)));
  app.get('/api/paper/daily', async (req) => paperDaily(profileOf(req.query)));
  app.get('/api/paper/assets', async (req) => paperAssets(profileOf(req.query)));

  /** The three profiles side by side: signal funnel, rejection reasons, outcomes, utilization. */
  app.get('/api/paper/monthly', async () => paperMonthly());
  app.get('/api/paper/compare', async (req) => {
    const { hours } = z.object({ hours: z.coerce.number().int().min(1).max(24 * 365).optional() }).parse(req.query);
    return paperCompare(hours);
  });

  /** Breakout signals with each profile's ACCEPT / REJECT and the reasons. */
  app.get('/api/paper/signals', async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return paperSignalLog(limit);
  });

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

  /** Fee per side (0–1%) and compounding on/off, for all three profiles. Applies to new trades. */
  app.put('/api/paper/settings', async (req) => {
    const b = z
      .object({ feeRatePct: z.coerce.number().min(0).max(1).optional(), compounding: z.boolean().optional() })
      .refine((v) => v.feeRatePct !== undefined || v.compounding !== undefined, 'Tidak ada pengaturan yang diubah')
      .parse(req.body ?? {});
    return updatePaperSettings({ ...(b.feeRatePct !== undefined ? { feeRate: b.feeRatePct / 100 } : {}), ...(b.compounding !== undefined ? { compounding: b.compounding } : {}) });
  });

  /** Add virtual capital to one profile (recorded as TOPUP; not counted as profit). */
  app.post('/api/paper/topup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const { amount, profile } = z.object({ amount: z.coerce.number().min(10_000).max(100_000_000), profile: z.enum(PROFILE_IDS as [string, ...string[]]).default('MENENGAH') }).parse(req.body ?? {});
    return topUpPaper(profile as (typeof PROFILE_IDS)[number], amount);
  });

  /** Research behind V2: old-system baseline, backtest/validation/test results, robustness grid. Static. */
  app.get('/api/paper/research', async () => RESEARCH_V2);
  /** Research behind the three profiles: thresholds, funnel, rejection reasons, marginal value of each step. Static. */
  app.get('/api/paper/research/profiles', async () => RESEARCH_PROFILES);
}

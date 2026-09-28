import type { FastifyInstance } from 'fastify';
import { BacktestRequestSchema } from '../services/backtest/backtest.schema.js';
import { enqueueBacktest, getBacktest, getBacktestEquity, getBacktestMetrics, getBacktestTrades, listBacktests } from '../services/backtest/backtest.service.js';
import { listStrategies } from '../services/backtest/strategies/index.js';
import { NotFoundError } from '../utils/errors.js';
import { IdParam } from '../utils/validation.js';

async function mustGet(id: string) {
  const b = await getBacktest(id);
  if (!b) throw new NotFoundError('Backtest tidak ditemukan');
  return b;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function backtestRoutes(app: FastifyInstance) {
  app.get('/api/backtest/strategies', async () => listStrategies());
  app.get('/api/backtest', async () => listBacktests(30));

  app.post('/api/backtest', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = BacktestRequestSchema.parse(req.body);
    const r = await enqueueBacktest(body);
    return reply.status(202).send(r);
  });

  app.get('/api/backtest/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const { trades: _t, equity: _e, ...b } = await mustGet(id);
    return b;
  });

  app.get('/api/backtest/:id/trades', async (req) => {
    const { id } = IdParam.parse(req.params);
    await mustGet(id);
    return getBacktestTrades(id);
  });

  app.get('/api/backtest/:id/equity', async (req) => {
    const { id } = IdParam.parse(req.params);
    const b = await mustGet(id);
    const eq = await getBacktestEquity(id);
    return { initialCapital: b.request.initialCapital, points: eq.map((e) => ({ time: e.time, equity: e.equity })) };
  });

  app.get('/api/backtest/:id/drawdown', async (req) => {
    const { id } = IdParam.parse(req.params);
    await mustGet(id);
    const eq = await getBacktestEquity(id);
    return eq.map((e) => ({ time: e.time, peak: e.peak, equity: e.equity, drawdownPct: e.drawdownPct }));
  });

  app.get('/api/backtest/:id/metrics', async (req) => {
    const { id } = IdParam.parse(req.params);
    await mustGet(id);
    return getBacktestMetrics(id);
  });

  app.get('/api/backtest/:id/export', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    await mustGet(id);
    const trades = await getBacktestTrades(id);
    const cols = ['entryTime', 'exitTime', 'symbol', 'side', 'entryPrice', 'exitPrice', 'quantity', 'grossPnl', 'fees', 'slippageCost', 'netPnl', 'returnPct', 'holdingMs', 'exitReason', 'mfePct', 'maePct', 'ambiguous', 'regime'] as const;
    const lines = [cols.join(','), ...trades.map((t) => cols.map((c) => csvCell(c.endsWith('Time') ? new Date(t[c] as number).toISOString() : t[c])).join(','))];
    return reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="backtest-${id}.csv"`).send(lines.join('\n'));
  });
}

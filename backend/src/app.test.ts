/** API integration test in MOCK_MODE (no Postgres / Redis / network required). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => app.close());

describe('API (mock mode)', () => {
  it('reports mock source in status', async () => {
    const r = await app.inject('/api/status');
    expect(r.statusCode).toBe(200);
    expect(r.json().source).toBe('mock');
  });

  it('returns market overview built from provider data', async () => {
    const r = await app.inject('/api/market/overview');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.mock).toBe(true);
    expect(b.cards.length).toBeGreaterThan(0);
    expect(b.cards[0].sparkline.length).toBe(24);
  });

  it('returns a USDT/IDR rate for display conversion', async () => {
    const r = await app.inject('/api/market/fx');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b).toMatchObject({ base: 'USDT', quote: 'IDR' });
    expect(b.rate).toBeGreaterThan(1000);
    expect(b.source).toMatch(/mock/);
  });

  it('returns klines with indicators', async () => {
    const r = await app.inject('/api/market/klines/BTCUSDT?timeframe=1h&limit=100&indicators=true');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.candles).toHaveLength(100);
    expect(b.indicators.sma200.filter((v: number | null) => v !== null).length).toBeGreaterThan(90);
  });

  it('validates input', async () => {
    expect((await app.inject('/api/market/klines/bad!sym')).statusCode).toBe(400);
    expect((await app.inject('/api/market/klines/BTCUSDT?timeframe=7m')).statusCode).toBe(400);
    const bt = await app.inject({ method: 'POST', url: '/api/backtest', payload: { symbol: 'BTCUSDT', timeframe: '1m', startDate: '2024-01-01', endDate: '2023-01-01' } });
    expect(bt.statusCode).toBe(400);
  });

  it('computes coin analysis without AI on GET', async () => {
    const r = await app.inject('/api/analysis/ETHUSDT?timeframe=4h');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.technical.technicalScore).toBeGreaterThanOrEqual(0);
    expect(b.technical.technicalScore).toBeLessThanOrEqual(100);
    expect(['NOT_REQUESTED', 'OK']).toContain(b.ai.status);
  });

  it('runs a backtest job end-to-end', async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 120 * 86_400_000);
    const r = await app.inject({ method: 'POST', url: '/api/backtest', payload: { symbol: 'BTCUSDT', timeframe: '4h', strategy: 'ma-rsi-macd', startDate: start.toISOString(), endDate: end.toISOString(), initialCapital: 10000, positionSize: 0.1, stopLoss: 0.05, takeProfit: 0.1, fee: 0.001, slippage: 0.0005 } });
    expect(r.statusCode).toBe(202);
    const { jobId } = r.json();
    let status = 'QUEUED';
    for (let i = 0; i < 100 && (status === 'QUEUED' || status === 'RUNNING'); i++) {
      await new Promise((res) => setTimeout(res, 50));
      status = (await app.inject(`/api/backtest/${jobId}`)).json().status;
    }
    expect(status).toBe('COMPLETED');
    const metrics = (await app.inject(`/api/backtest/${jobId}/metrics`)).json();
    expect(metrics.initialCapital).toBe(10000);
    const dd = (await app.inject(`/api/backtest/${jobId}/drawdown`)).json();
    expect(dd.length).toBeGreaterThan(100);
    expect((await app.inject(`/api/backtest/${jobId}/export`)).headers['content-type']).toMatch(/csv/);
  });

  it('builds a trade plan for a capital amount', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/planner', payload: { capital: 10000, risk: 'moderat', timeframe: '4h', maxPositions: 3 } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.summary.scanned).toBeGreaterThan(0);
    expect(b.summary.capitalUsed).toBeLessThanOrEqual(10000);
    for (const p of b.picks) {
      expect(p.target).toBeGreaterThan(p.entry);
      expect(p.stop).toBeLessThan(p.entry);
      expect(p.profitIfTarget).toBeGreaterThan(0);
      expect(p.lossIfStop).toBeLessThan(0);
      // Loss at stop stays near the chosen risk per trade (1% of capital) plus costs
      expect(Math.abs(p.lossIfStop)).toBeLessThanOrEqual(10000 * 0.01 * 1.1 + 5);
    }
    expect(b.picks.length + b.notRecommended.length).toBe(b.summary.scanned);
    expect((await app.inject({ method: 'POST', url: '/api/planner', payload: { capital: -1 } })).statusCode).toBe(400);
  });

  it('requires the database for user features', async () => {
    expect((await app.inject('/api/watchlist')).statusCode).toBe(503);
  });

  it('returns 404 for unknown backtests', async () => {
    expect((await app.inject('/api/backtest/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });
});

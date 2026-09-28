import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env, trackedSymbols } from '../config/env.js';
import { DEFAULT_WEIGHTS, SIGNAL_BANDS, SIGNAL_LABEL, HISTORICAL_CONFIG, TARGET_CONFIG } from '../config/scoring.js';
import { BACKTEST_TIMEFRAMES, TIMEFRAMES, type Timeframe } from '../config/timeframes.js';
import { isDbReady } from '../db/client.js';
import { aiStatus } from '../services/analysis/analysis.service.js';
import { marketData } from '../services/binance/index.js';
import { allStatuses, getStatus } from '../services/binance/status.js';
import { CHANNEL_CANDLE_CLOSED, CHANNEL_TICKER, channelKline, marketStream } from '../services/binance/stream.js';
import { cache } from '../services/cache/cache.js';
import { listStrategies } from '../services/backtest/strategies/index.js';
import { CHANNEL_ALERT } from '../services/alerts/alerts.service.js';
import { fearGreed, latestNews } from '../services/sentiment/sentiment.service.js';
import { TimeframeSchema } from '../utils/validation.js';

export async function systemRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  app.get('/api/status', async () => ({
    source: marketData.source,
    mock: env.MOCK_MODE,
    timezone: env.APP_TIMEZONE,
    binance: getStatus('binance'),
    binanceFutures: getStatus('binance_futures'),
    websocket: { ...getStatus('binance_ws'), connected: marketStream.connected },
    ai: aiStatus(),
    database: isDbReady(),
    redis: cache.isRedisReady,
    services: allStatuses(),
    serverTime: Date.now(),
  }));

  app.get('/api/config', async () => ({
    timeframes: TIMEFRAMES,
    backtestTimeframes: BACKTEST_TIMEFRAMES,
    analysisTimeframe: env.ANALYSIS_TIMEFRAME,
    trackedSymbols,
    timezone: env.APP_TIMEZONE,
    scoring: { weights: DEFAULT_WEIGHTS, bands: SIGNAL_BANDS, labels: SIGNAL_LABEL },
    historical: HISTORICAL_CONFIG,
    targets: TARGET_CONFIG,
    strategies: listStrategies(),
    mock: env.MOCK_MODE,
    aiLanguage: env.AI_LANGUAGE,
  }));

  app.get('/api/news', async (req) => {
    const { coin } = z.object({ coin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,15}$/).optional() }).parse(req.query);
    return latestNews(coin);
  });
  app.get('/api/sentiment', async () => ({ fearGreed: await fearGreed(), news: (await latestNews()).sentimentBreakdown }));

  /**
   * Server-Sent Events: live tickers, alerts, candle-close notifications and (optionally) one kline stream.
   * The browser never connects to Binance directly.
   */
  app.get('/api/stream', async (req, reply) => {
    const q = z.object({ kline: z.string().regex(/^[A-Z0-9]{2,20}:[0-9]+[mhdwDW]$/).optional() }).parse(req.query);
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': reply.getHeader('access-control-allow-origin') as string ?? '*',
    });
    const send = (event: string, data: string) => reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
    send('hello', JSON.stringify({ source: marketData.source, time: Date.now() }));
    const unsubs = [cache.subscribe(CHANNEL_TICKER, (d) => send('ticker', d)), cache.subscribe(CHANNEL_ALERT, (d) => send('alert', d)), cache.subscribe(CHANNEL_CANDLE_CLOSED, (d) => send('candle-closed', d))];
    if (q.kline) {
      const [sym, tfRaw] = q.kline.split(':');
      const tf = TimeframeSchema.parse(tfRaw) as Timeframe;
      unsubs.push(cache.subscribe(channelKline(sym, tf), (d) => send('kline', d)));
      unsubs.push(marketStream.subscribeKline(sym, tf));
    }
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubs.forEach((u) => u());
    });
    return reply;
  });
}

import cron from 'node-cron';
import { env, trackedSymbols } from '../config/env.js';
import type { Timeframe } from '../config/timeframes.js';
import { analyzeCoin, marketSummary } from '../services/analysis/analysis.service.js';
import { checkPriceAlerts, checkTechnicalAlerts } from '../services/alerts/alerts.service.js';
import { CHANNEL_TICKER, type LiveTicker } from '../services/binance/stream.js';
import { cache } from '../services/cache/cache.js';
import { trackOpenSignals } from '../services/signals/signals.service.js';
import { logger } from '../utils/logger.js';
import { getStatus } from '../services/binance/status.js';
import { isDbReady } from '../db/client.js';
import { monitorPaper, scanPaper } from '../services/paper/engine.js';

let running = false;

/**
 * AI analysis cycle (default every 15 minutes):
 * market data → indicators → score → historical similarity → sentiment → Claude → validate → store.
 * Claude is only called for a coin when a new candle has closed (or context changed); the market
 * summary is refreshed at most every AI_MARKET_SUMMARY_MINUTES. Skipped when market data is invalid.
 */
export async function runAnalysisCycle() {
  if (running) return;
  running = true;
  const t0 = Date.now();
  try {
    for (const symbol of trackedSymbols) {
      try {
        await analyzeCoin(symbol, env.ANALYSIS_TIMEFRAME as Timeframe, 'auto');
      } catch (e) {
        logger.warn({ symbol, err: (e as Error).message }, 'Analysis skipped (market data invalid or unavailable)');
      }
    }
    if (getStatus('binance').connected || env.MOCK_MODE) await marketSummary(false).catch((e) => logger.warn({ err: (e as Error).message }, 'Market summary failed'));
    await checkTechnicalAlerts();
    logger.info({ ms: Date.now() - t0 }, 'Analysis cycle complete');
  } finally {
    running = false;
  }
}

/**
 * Paper Trading V2: entry scan every hour 45 s after the 1h candle closes (exits are processed first),
 * exit monitor on every 5-minute candle in between. Both share a lock, so they never overlap.
 */
function startPaperJob() {
  if (!env.ENABLE_PAPER_JOB || !isDbReady()) return;
  const scan = () => void scanPaper().catch((e) => logger.warn({ err: (e as Error).message }, 'Paper scan failed'));
  const monitor = () => void monitorPaper().catch((e) => logger.warn({ err: (e as Error).message }, 'Paper monitor failed'));
  cron.schedule('45 0 * * * *', scan);
  cron.schedule('20 5-55/5 * * * *', monitor);
  setTimeout(monitor, 20_000);
  logger.info('Paper Trading V2 jobs scheduled (scan hourly, exits every 5 minutes)');
}

export function startJobs() {
  startPaperJob();
  cron.schedule(env.AI_ANALYSIS_CRON, () => void runAnalysisCycle(), { timezone: env.APP_TIMEZONE });
  cron.schedule(env.SIGNAL_TRACKER_CRON, () => void trackOpenSignals().catch((e) => logger.warn({ err: (e as Error).message }, 'Signal tracker failed')), { timezone: env.APP_TIMEZONE });
  // Price alerts on live ticks (throttled per symbol)
  const lastCheck = new Map<string, number>();
  cache.subscribe(CHANNEL_TICKER, (raw) => {
    const t = JSON.parse(raw) as LiveTicker;
    const now = Date.now();
    if (now - (lastCheck.get(t.symbol) ?? 0) < 5000) return;
    lastCheck.set(t.symbol, now);
    void checkPriceAlerts(t.symbol, t.price).catch(() => undefined);
  });
  // Warm-up run shortly after boot
  setTimeout(() => void runAnalysisCycle(), 5000);
  logger.info({ analysis: env.AI_ANALYSIS_CRON, tracker: env.SIGNAL_TRACKER_CRON }, 'Scheduled jobs started');
}

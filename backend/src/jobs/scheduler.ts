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
import { getScenarioRun, latestScenario, runScenario } from '../services/planner/scenario.service.js';
import { backfillChecks, processDueChecks } from '../services/planner/scenario-checks.js';

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

/** Skenario Otomatis: every SCENARIO_INTERVAL_HOURS on the WIB clock (00:00, 06:00, 12:00, 18:00 by default). */
function startScenarioJob() {
  if (!env.ENABLE_SCENARIO_JOB || !isDbReady()) return;
  const run = (trigger: 'schedule' | 'startup') => void runScenario(trigger).catch((e) => logger.warn({ err: (e as Error).message }, 'Scenario scan skipped'));
  cron.schedule(`0 */${env.SCENARIO_INTERVAL_HOURS} * * *`, () => run('schedule'), { timezone: env.APP_TIMEZONE });
  // Every minute: record the real price for picks whose estimated hold time has elapsed
  const checks = () =>
    void backfillChecks(getScenarioRun)
      .then(() => processDueChecks())
      .catch((e) => logger.warn({ err: (e as Error).message }, 'Scenario checks failed'));
  cron.schedule('* * * * *', checks, { timezone: env.APP_TIMEZONE });
  setTimeout(checks, 30_000);
  // Catch up after downtime (e.g. the machine was asleep at the scheduled time)
  setTimeout(async () => {
    const last = await latestScenario().catch(() => null);
    if (!last || Date.now() - new Date(last.createdAt).getTime() > env.SCENARIO_INTERVAL_HOURS * 3_600_000) run('startup');
  }, 60_000);
  logger.info({ everyHours: env.SCENARIO_INTERVAL_HOURS }, 'Scenario job scheduled');
}

export function startJobs() {
  startScenarioJob();
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

import { desc, eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { TIMEFRAME_MS, type Timeframe } from '../../config/timeframes.js';
import { getDb, isDbReady } from '../../db/client.js';
import { scenarioRuns } from '../../db/schema.js';
import { AppError, NotFoundError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { round } from '../../utils/math.js';
import { cache } from '../cache/cache.js';
import { getCandles } from '../market/candles.service.js';
import { usdtIdrRate } from '../market/fx.service.js';
import { getTicker } from '../market/market.service.js';
import { evaluateOutcome, type SignalStatus } from '../signals/outcome.js';
import { buildTradePlan, type PlanPick } from './planner.service.js';

/** The three trading styles scanned in every scenario run, each tagged for the UI. */
export const SCENARIO_STYLES: { timeframe: Timeframe; tag: 'Harian' | 'Swing' | 'Posisi' }[] = [
  { timeframe: '1h', tag: 'Harian' },
  { timeframe: '4h', tag: 'Swing' },
  { timeframe: '1d', tag: 'Posisi' },
];

const FEE = 0.001;
const SLIPPAGE = 0.0005;

export interface ScenarioConfig {
  capitalIdr: number;
  risk: 'konservatif' | 'moderat' | 'agresif';
  maxPositions: number;
  universe: 'tracked' | 'top';
  intervalHours: number;
  fee: number;
  slippage: number;
}

export const scenarioConfig = (): ScenarioConfig => ({
  capitalIdr: env.SCENARIO_CAPITAL_IDR,
  risk: env.SCENARIO_RISK,
  maxPositions: env.SCENARIO_MAX_POSITIONS,
  universe: env.SCENARIO_UNIVERSE,
  intervalHours: env.SCENARIO_INTERVAL_HOURS,
  fee: FEE,
  slippage: SLIPPAGE,
});

export interface ScenarioStyleResult {
  tag: string;
  timeframe: Timeframe;
  summary: Awaited<ReturnType<typeof buildTradePlan>>['summary'] | null;
  /** scanPrice = live market price at scan time, used as the simulated fill for tracking. */
  picks: (PlanPick & { tag: string; timeframe: Timeframe; scanPrice: number | null })[];
  notRecommended: number;
  sellSuggestions: Awaited<ReturnType<typeof buildTradePlan>>['sellSuggestions'];
  error: string | null;
}

export interface ScenarioRun {
  id: string;
  createdAt: string;
  trigger: string;
  status: 'OK' | 'FAILED';
  fxRate: number | null;
  capitalIdr: number;
  capitalUsdt: number | null;
  config: ScenarioConfig;
  styles: ScenarioStyleResult[];
  error: string | null;
  durationMs: number | null;
}

/** Next scheduled run: the next multiple of the interval on the Asia/Jakarta (UTC+7) clock. */
export function nextRunAt(now = Date.now(), intervalHours = env.SCENARIO_INTERVAL_HOURS): number {
  const offset = 7 * 3_600_000; // WIB has no DST
  const step = intervalHours * 3_600_000;
  return Math.floor((now + offset) / step) * step + step - offset;
}

type Row = typeof scenarioRuns.$inferSelect;
const toRun = (r: Row): ScenarioRun => {
  const res = (r.result ?? {}) as { styles?: ScenarioStyleResult[]; capitalUsdt?: number };
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    trigger: r.trigger,
    status: r.status as ScenarioRun['status'],
    fxRate: r.fxRate,
    capitalIdr: r.capitalIdr,
    capitalUsdt: res.capitalUsdt ?? null,
    config: r.config as ScenarioConfig,
    styles: res.styles ?? [],
    error: r.error,
    durationMs: r.durationMs,
  };
};

const LOCK = 'scenario:running';

export async function isScenarioRunning(): Promise<boolean> {
  return (await cache.get<boolean>(LOCK)) === true;
}

/**
 * One scenario scan: convert the Rupiah capital with the current USDT/IDR rate, then build a trade plan
 * for every trading style. Each style is an independent simulation with the full capital.
 */
export async function runScenario(trigger: 'schedule' | 'manual' | 'startup'): Promise<ScenarioRun> {
  if (!isDbReady()) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Skenario Otomatis membutuhkan database (DATABASE_URL).');
  if (await isScenarioRunning()) throw new AppError(409, 'SCENARIO_RUNNING', 'Scan skenario sedang berjalan. Tunggu hingga selesai.');
  await cache.set(LOCK, true, 15 * 60);
  const t0 = Date.now();
  const cfg = scenarioConfig();
  try {
    const fx = await usdtIdrRate();
    const capitalUsdt = cfg.capitalIdr / fx.rate;
    const styles: ScenarioStyleResult[] = [];
    for (const s of SCENARIO_STYLES) {
      try {
        const plan = await buildTradePlan({ capital: capitalUsdt, risk: cfg.risk, timeframe: s.timeframe, maxPositions: cfg.maxPositions, fee: cfg.fee, slippage: cfg.slippage, universe: cfg.universe });
        styles.push({
          tag: s.tag,
          timeframe: s.timeframe,
          summary: plan.summary,
          picks: await Promise.all(
            plan.picks.map(async (p) => ({ ...p, tag: s.tag, timeframe: s.timeframe, scanPrice: await getTicker(p.symbol).then((t) => t.lastPrice).catch(() => null) })),
          ),
          notRecommended: plan.notRecommended.length,
          sellSuggestions: plan.sellSuggestions,
          error: null,
        });
      } catch (e) {
        logger.warn({ tf: s.timeframe, err: (e as Error).message }, 'Scenario style failed');
        styles.push({ tag: s.tag, timeframe: s.timeframe, summary: null, picks: [], notRecommended: 0, sellSuggestions: [], error: (e as Error).message });
      }
    }
    const [row] = await getDb()
      .insert(scenarioRuns)
      .values({ trigger, status: 'OK', fxRate: fx.rate, capitalIdr: cfg.capitalIdr, config: cfg, result: { styles, capitalUsdt, fxSource: fx.source }, durationMs: Date.now() - t0 })
      .returning();
    logger.info({ trigger, ms: Date.now() - t0, picks: styles.map((s) => `${s.tag}:${s.picks.length}`).join(' ') }, 'Scenario scan complete');
    return toRun(row);
  } catch (e) {
    const [row] = await getDb()
      .insert(scenarioRuns)
      .values({ trigger, status: 'FAILED', capitalIdr: cfg.capitalIdr, config: cfg, error: (e as Error).message, durationMs: Date.now() - t0 })
      .returning();
    logger.error({ err: (e as Error).message }, 'Scenario scan failed');
    return toRun(row);
  } finally {
    await cache.del(LOCK);
  }
}

export async function latestScenario(): Promise<ScenarioRun | null> {
  if (!isDbReady()) return null;
  const [row] = await getDb().select().from(scenarioRuns).where(eq(scenarioRuns.status, 'OK')).orderBy(desc(scenarioRuns.createdAt)).limit(1);
  return row ? toRun(row) : null;
}

export async function listScenarioRuns(limit = 20): Promise<ScenarioRun[]> {
  if (!isDbReady()) return [];
  return (await getDb().select().from(scenarioRuns).orderBy(desc(scenarioRuns.createdAt)).limit(limit)).map(toRun);
}

export async function getScenarioRun(id: string): Promise<ScenarioRun> {
  const [row] = await getDb().select().from(scenarioRuns).where(eq(scenarioRuns.id, id));
  if (!row) throw new NotFoundError('Scan skenario tidak ditemukan');
  return toRun(row);
}

export interface PickOutcome {
  symbol: string;
  tag: string;
  timeframe: Timeframe;
  status: SignalStatus;
  entry: number;
  target: number;
  stop: number;
  exitPrice: number | null;
  exitTime: number | null;
  lastPrice: number | null;
  /** Net P&L in USDT after fees/slippage (realized for closed outcomes, mark-to-market for OPEN). */
  pnl: number | null;
  pnlPct: number | null;
  positionValue: number;
  candlesEvaluated: number;
}

/**
 * Paper-track the picks of a past scan: from the scan time forward, did price reach the target, the cut loss,
 * or the time limit first? Uses the same outcome rules as the Signal History (ambiguous candles are not counted).
 */
export async function evaluateScenarioRun(run: ScenarioRun): Promise<{ outcomes: PickOutcome[]; totals: { closed: number; open: number; targetHit: number; stopHit: number; timeout: number; realizedPnl: number; openPnl: number } }> {
  return cache.wrap(`scenario:eval:${run.id}`, 600, async () => {
    const scanTime = new Date(run.createdAt).getTime();
    const outcomes: PickOutcome[] = [];
    const cost = run.config.fee + run.config.slippage;
    for (const style of run.styles) {
      for (const p of style.picks) {
        const maxHold = Math.round(p.maxHoldMs / TIMEFRAME_MS[style.timeframe]);
        let candles: Awaited<ReturnType<typeof getCandles>> = [];
        try {
          candles = await getCandles(p.symbol, style.timeframe, { startTime: scanTime, endTime: Date.now(), includeLive: true });
        } catch {
          /* leave pending */
        }
        const closed = candles.filter((c) => c.closeTime < Date.now());
        // Simulated fill at the market price when the scan ran (falls back to the plan's entry reference)
        const fill = p.scanPrice ?? p.entry;
        const qty = p.positionValue / fill;
        const o = evaluateOutcome({ direction: 'LONG', entryPrice: fill, targetPrice: p.target, stopPrice: p.stop, candleTime: scanTime - 1 }, closed.filter((c) => c.openTime >= scanTime), maxHold);
        const last = candles.length ? candles[candles.length - 1].close : null;
        const exit = o.exitPrice ?? (o.status === 'OPEN' || o.status === 'PENDING' ? last : null);
        const pnl = exit !== null && o.status !== 'AMBIGUOUS' ? qty * (exit - fill) - cost * (p.positionValue + qty * exit) : null;
        outcomes.push({
          symbol: p.symbol,
          tag: style.tag,
          timeframe: style.timeframe,
          status: o.status,
          entry: fill,
          target: p.target,
          stop: p.stop,
          exitPrice: o.exitPrice,
          exitTime: o.exitTime,
          lastPrice: last,
          pnl: pnl === null ? null : round(pnl, 4),
          pnlPct: pnl === null ? null : round((pnl / p.positionValue) * 100, 2),
          positionValue: p.positionValue,
          candlesEvaluated: o.candlesEvaluated,
        });
      }
    }
    const isClosed = (s: SignalStatus) => s === 'TARGET_HIT' || s === 'STOP_HIT' || s === 'TIMEOUT';
    return {
      outcomes,
      totals: {
        closed: outcomes.filter((o) => isClosed(o.status)).length,
        open: outcomes.filter((o) => o.status === 'OPEN' || o.status === 'PENDING').length,
        targetHit: outcomes.filter((o) => o.status === 'TARGET_HIT').length,
        stopHit: outcomes.filter((o) => o.status === 'STOP_HIT').length,
        timeout: outcomes.filter((o) => o.status === 'TIMEOUT').length,
        realizedPnl: round(outcomes.filter((o) => isClosed(o.status)).reduce((a, o) => a + (o.pnl ?? 0), 0), 4),
        openPnl: round(outcomes.filter((o) => o.status === 'OPEN' || o.status === 'PENDING').reduce((a, o) => a + (o.pnl ?? 0), 0), 4),
      },
    };
  });
}

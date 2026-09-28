import { Queue, Worker, type Job } from 'bullmq';
import { asc, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { LOWER_TIMEFRAME, TIMEFRAME_MS, type Timeframe } from '../../config/timeframes.js';
import { getDb, isDbReady } from '../../db/client.js';
import { backtestEquity, backtestMetrics, backtestTrades, backtests } from '../../db/schema.js';
import type { Candle } from '../../types/market.js';
import { logger } from '../../utils/logger.js';
import { cache } from '../cache/cache.js';
import { getCandles } from '../market/candles.service.js';
import { resolveWithLowerTimeframe } from '../signals/outcome.js';
import { monteCarlo, runOutOfSample, runWalkForward } from './advanced.js';
import type { BacktestRequest } from './backtest.schema.js';
import { checkDataQuality } from './data-quality.js';
import { runBacktest } from './engine.js';
import { monthlyReturns, regimeBreakdown } from './metrics.js';
import { getStrategy } from './strategies/index.js';
import type { BacktestConfig, BacktestResult, DataQualityReport, EngineInput, EquityPoint, Trade } from './types.js';

export type BacktestStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
const WARMUP_CANDLES = 250;
const MEM_TTL = 24 * 3600;

export class BacktestDataError extends Error {}

interface StoredBacktest {
  id: string;
  status: BacktestStatus;
  mode: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  request: BacktestRequest;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  trades?: Trade[];
  equity?: EquityPoint[];
  metrics?: BacktestResult['metrics'] | null;
}

/* ------------------------------ persistence ------------------------------ */

async function saveMeta(b: Partial<StoredBacktest> & { id: string }) {
  if (isDbReady()) {
    const db = getDb();
    const set: Record<string, unknown> = {};
    if (b.status) set.status = b.status;
    if (b.result !== undefined) set.result = b.result;
    if (b.error !== undefined) set.error = b.error;
    if (b.progress !== undefined) set.progress = b.progress;
    if (b.startedAt) set.startedAt = new Date(b.startedAt);
    if (b.completedAt) set.completedAt = new Date(b.completedAt);
    await db.update(backtests).set(set).where(eq(backtests.id, b.id));
    return;
  }
  const cur = await cache.get<StoredBacktest>(`bt:${b.id}`);
  if (cur) await cache.set(`bt:${b.id}`, { ...cur, ...b }, MEM_TTL);
}

async function saveResults(id: string, trades: Trade[], equity: EquityPoint[], metrics: BacktestResult['metrics'] | null) {
  if (isDbReady()) {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.delete(backtestTrades).where(eq(backtestTrades.backtestId, id));
      await tx.delete(backtestEquity).where(eq(backtestEquity.backtestId, id));
      for (let i = 0; i < trades.length; i += 500) await tx.insert(backtestTrades).values(trades.slice(i, i + 500).map((t, j) => ({ backtestId: id, seq: i + j, data: t })));
      const dedup = [...new Map(equity.map((e) => [e.time, e])).values()];
      for (let i = 0; i < dedup.length; i += 1000)
        await tx.insert(backtestEquity).values(dedup.slice(i, i + 1000).map((e) => ({ backtestId: id, time: e.time, equity: e.equity, peak: e.peak, drawdownPct: e.drawdownPct })));
      if (metrics)
        await tx
          .insert(backtestMetrics)
          .values({ backtestId: id, metrics, roi: metrics.roi, winRate: metrics.winRate, profitFactor: metrics.profitFactor, maxDrawdown: metrics.maxDrawdown, sharpe: metrics.sharpe, totalTrades: metrics.totalTrades })
          .onConflictDoUpdate({ target: backtestMetrics.backtestId, set: { metrics, roi: metrics.roi, winRate: metrics.winRate } });
    });
    return;
  }
  const cur = await cache.get<StoredBacktest>(`bt:${id}`);
  if (cur) await cache.set(`bt:${id}`, { ...cur, trades, equity, metrics }, MEM_TTL);
}

export async function getBacktest(id: string): Promise<StoredBacktest | null> {
  if (isDbReady()) {
    const [row] = await getDb().select().from(backtests).where(eq(backtests.id, id));
    if (!row) return null;
    return {
      ...row,
      request: row.request as BacktestRequest,
      status: row.status as BacktestStatus,
      result: row.result as Record<string, unknown> | null,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
  return cache.get<StoredBacktest>(`bt:${id}`);
}

export async function getBacktestTrades(id: string): Promise<Trade[]> {
  if (isDbReady()) return (await getDb().select().from(backtestTrades).where(eq(backtestTrades.backtestId, id)).orderBy(asc(backtestTrades.seq))).map((r) => r.data as Trade);
  return (await cache.get<StoredBacktest>(`bt:${id}`))?.trades ?? [];
}

export async function getBacktestEquity(id: string): Promise<EquityPoint[]> {
  if (isDbReady())
    return (await getDb().select().from(backtestEquity).where(eq(backtestEquity.backtestId, id)).orderBy(asc(backtestEquity.time))).map((r) => ({ time: r.time, equity: r.equity, peak: r.peak, drawdownPct: r.drawdownPct, cash: NaN }));
  return (await cache.get<StoredBacktest>(`bt:${id}`))?.equity ?? [];
}

export async function getBacktestMetrics(id: string) {
  if (isDbReady()) {
    const [m] = await getDb().select().from(backtestMetrics).where(eq(backtestMetrics.backtestId, id));
    return m?.metrics ?? null;
  }
  return (await cache.get<StoredBacktest>(`bt:${id}`))?.metrics ?? null;
}

export async function listBacktests(limit = 20) {
  if (!isDbReady()) return [];
  const rows = await getDb()
    .select({ b: backtests, m: backtestMetrics })
    .from(backtests)
    .leftJoin(backtestMetrics, eq(backtestMetrics.backtestId, backtests.id))
    .orderBy(desc(backtests.createdAt))
    .limit(limit);
  return rows.map(({ b, m }) => ({ id: b.id, status: b.status, mode: b.mode, symbol: b.symbol, timeframe: b.timeframe, strategy: b.strategy, createdAt: b.createdAt, roi: m?.roi ?? null, winRate: m?.winRate ?? null, maxDrawdown: m?.maxDrawdown ?? null, totalTrades: m?.totalTrades ?? null, error: b.error }));
}

/* -------------------------------- execution -------------------------------- */

async function loadCandles(symbol: string, tf: Timeframe, start: number, end: number): Promise<{ candles: Candle[]; quality: DataQualityReport }> {
  const step = TIMEFRAME_MS[tf];
  const raw = await getCandles(symbol, tf, { startTime: start - WARMUP_CANDLES * step, endTime: end });
  const { candles, report } = checkDataQuality(raw, tf);
  if (report.severe) throw new BacktestDataError(`Peringatan kualitas data: ${report.warnings.join(' ')} Backtest tidak dijalankan.`);
  const inWindow = candles.filter((c) => c.openTime >= start && c.openTime <= end).length;
  if (inWindow < 30) throw new BacktestDataError(`Data historis tidak mencukupi (${inWindow} candle pada periode yang dipilih).`);
  if (report.warnings.length) logger.warn({ symbol, tf, warnings: report.warnings }, 'Backtest data quality warnings');
  return { candles, quality: report };
}

/**
 * Run a standard backtest, then resolve any stop/target-in-one-candle ambiguity using
 * lower-timeframe candles (re-running until no new unresolved candles appear).
 */
async function runWithIntrabarResolution(cfg: BacktestConfig, candles: Candle[]): Promise<BacktestResult> {
  const lowerTf = LOWER_TIMEFRAME[cfg.timeframe];
  const lower = new Map<number, Candle[]>();
  const input: EngineInput = {
    candles,
    resolveIntrabar: (c, stop, target) => {
      const lc = lower.get(c.openTime);
      return lc?.length ? resolveWithLowerTimeframe(lc, 'LONG', target, stop) : null;
    },
  };
  let result = runBacktest(cfg, input);
  for (let pass = 0; pass < 3 && lowerTf; pass++) {
    const need = result.trades.filter((t) => t.ambiguous).map((t) => t.exitTime).filter((t) => !lower.has(t));
    if (!need.length) break;
    for (const openTime of need.slice(0, 200)) {
      const parent = candles.find((c) => c.openTime === openTime);
      if (!parent) continue;
      lower.set(openTime, await getCandles(cfg.symbol, lowerTf, { startTime: parent.openTime, endTime: parent.closeTime }).catch(() => []));
    }
    result = runBacktest(cfg, input);
  }
  return result;
}

function toConfig(r: BacktestRequest, symbol = r.symbol, tf = r.timeframe as Timeframe): BacktestConfig {
  return {
    symbol,
    timeframe: tf,
    strategy: r.strategy,
    initialCapital: r.initialCapital,
    positionSize: r.positionSize,
    stopLoss: r.stopLoss || undefined,
    takeProfit: r.takeProfit || undefined,
    fee: r.fee,
    slippage: r.slippage,
    params: r.params,
    tradeFrom: r.startDate.getTime(),
    tradeTo: r.endDate.getTime(),
  };
}

const slimResult = (r: BacktestResult) => ({ params: r.params, startTime: r.startTime, endTime: r.endTime, candlesUsed: r.candlesUsed, metrics: r.metrics, monthly: r.monthly, byRegime: r.byRegime, signalDistribution: r.signalDistribution, warnings: r.warnings });

export async function executeBacktest(id: string, req: BacktestRequest, onProgress: (p: number) => Promise<void> | void = () => undefined) {
  const start = req.startDate.getTime();
  const end = Math.min(req.endDate.getTime(), Date.now());
  const tf = req.timeframe as Timeframe;
  getStrategy(req.strategy); // validate
  await saveMeta({ id, status: 'RUNNING', startedAt: new Date().toISOString(), progress: 5 });

  if (req.mode === 'matrix') {
    const rows = [];
    const combos = req.matrix!.symbols.flatMap((s) => req.matrix!.timeframes.map((t) => [s, t as Timeframe] as const));
    let done = 0;
    for (const [s, t] of combos) {
      try {
        const { candles, quality } = await loadCandles(s, t, start, end);
        const r = runBacktest(toConfig(req, s, t), { candles });
        rows.push({ symbol: s, timeframe: t, metrics: r.metrics, byRegime: r.byRegime, dataQuality: quality.warnings, error: null });
      } catch (e) {
        rows.push({ symbol: s, timeframe: t, metrics: null, byRegime: [], dataQuality: [], error: (e as Error).message });
      }
      await onProgress(Math.round((++done / combos.length) * 90) + 5);
    }
    await saveMeta({ id, status: 'COMPLETED', progress: 100, completedAt: new Date().toISOString(), result: { mode: 'matrix', matrix: rows } });
    return;
  }

  const { candles, quality } = await loadCandles(req.symbol, tf, start, end);
  await onProgress(20);
  const cfg = toConfig(req);
  let main: BacktestResult;
  let extra: Record<string, unknown> = {};

  if (req.mode === 'walk-forward') {
    const wf = runWalkForward(cfg, { candles }, {
      trainDays: req.walkForward?.trainDays ?? 90,
      testDays: req.walkForward?.testDays ?? 30,
      ranges: req.optimization?.ranges,
      objective: req.optimization?.objective,
      maxCombinations: req.optimization?.maxCombinations ?? 50,
      minTrades: req.optimization?.minTrades,
    });
    extra = { walkForward: { trainDays: wf.trainDays, testDays: wf.testDays, windows: wf.windows, overfitting: wf.overfitting, combined: wf.combined } };
    main = {
      config: cfg,
      params: {},
      startTime: wf.combinedEquity[0]?.time ?? start,
      endTime: wf.combinedEquity[wf.combinedEquity.length - 1]?.time ?? end,
      candlesUsed: wf.combinedEquity.length,
      metrics: wf.combined,
      trades: wf.combinedTrades,
      equity: wf.combinedEquity,
      monthly: monthlyReturns(wf.combinedEquity, cfg.initialCapital),
      signalDistribution: {},
      byRegime: regimeBreakdown(wf.combinedTrades),
      warnings: wf.overfitting.warnings,
    };
  } else if (req.mode === 'out-of-sample' || req.mode === 'optimization') {
    const oos = runOutOfSample(cfg, { candles }, {
      splitRatio: req.outOfSample?.splitRatio ?? 0.7,
      ranges: req.optimization?.ranges,
      objective: req.optimization?.objective,
      maxCombinations: req.optimization?.maxCombinations,
      minTrades: req.optimization?.minTrades,
    });
    extra = {
      outOfSample: {
        splitRatio: oos.splitRatio,
        splitTime: oos.splitTime,
        optimization: oos.optimization,
        inSample: slimResult(oos.inSample),
        outOfSample: slimResult(oos.outOfSample),
        overfitting: oos.overfitting,
      },
    };
    // Main curve = full period with the selected params (IS + OOS shown together, split marked in UI)
    main = await runWithIntrabarResolution({ ...cfg, params: { ...(cfg.params ?? {}), ...oos.inSample.params } }, candles);
    main.warnings.push(...oos.overfitting.warnings);
  } else {
    main = await runWithIntrabarResolution(cfg, candles);
  }
  await onProgress(80);

  const mc = monteCarlo(main.trades, cfg.initialCapital, { iterations: req.monteCarlo?.iterations, drawdownThreshold: req.monteCarlo?.drawdownThreshold });
  if (quality.warnings.length) main.warnings.unshift(...quality.warnings.map((w) => `Kualitas data: ${w}`));
  const result = {
    mode: req.mode,
    ...slimResult(main),
    strategyName: getStrategy(req.strategy).name,
    dataQuality: quality,
    monteCarlo: mc,
    ...extra,
  };
  await saveResults(id, main.trades, main.equity, main.metrics);
  await saveMeta({ id, status: 'COMPLETED', progress: 100, completedAt: new Date().toISOString(), result });
}

/* ---------------------------------- queue ---------------------------------- */

let queue: Queue | null = null;
let worker: Worker | null = null;
const localQueue: { id: string; req: BacktestRequest }[] = [];
let localRunning = false;

async function processLocal() {
  if (localRunning) return;
  localRunning = true;
  while (localQueue.length) {
    const { id, req } = localQueue.shift()!;
    await executeBacktest(id, req, (p) => saveMeta({ id, progress: p })).catch((e) => failBacktest(id, e));
  }
  localRunning = false;
}

async function failBacktest(id: string, e: unknown) {
  const msg = (e as Error).message;
  logger.warn({ id, err: msg }, 'Backtest failed');
  await saveMeta({ id, status: 'FAILED', error: `Backtest tidak dapat diselesaikan. Alasan: ${msg}`, completedAt: new Date().toISOString() });
}

export function startBacktestWorker() {
  const conn = cache.connection;
  if (!conn) return;
  queue = new Queue('backtests', { connection: conn.duplicate(), defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 1000, attempts: 1 } });
  worker = new Worker(
    'backtests',
    async (job: Job<{ id: string; req: BacktestRequest }>) => {
      const req = { ...job.data.req, startDate: new Date(job.data.req.startDate), endDate: new Date(job.data.req.endDate) };
      try {
        await executeBacktest(job.data.id, req, (p) => Promise.all([job.updateProgress(p), saveMeta({ id: job.data.id, progress: p })]).then(() => undefined));
      } catch (e) {
        await failBacktest(job.data.id, e);
      }
    },
    { connection: conn.duplicate(), concurrency: 2 },
  );
  worker.on('error', (e) => logger.error({ err: e.message }, 'Backtest worker error'));
  logger.info('Backtest worker started (BullMQ)');
}

export async function stopBacktestWorker() {
  await worker?.close();
  await queue?.close();
}

export async function enqueueBacktest(req: BacktestRequest): Promise<{ jobId: string; status: BacktestStatus }> {
  const id = randomUUID();
  const meta: StoredBacktest = {
    id,
    status: 'QUEUED',
    mode: req.mode,
    symbol: req.symbol,
    timeframe: req.timeframe,
    strategy: req.strategy,
    request: req,
    result: null,
    error: null,
    progress: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
  };
  if (isDbReady()) {
    await getDb().insert(backtests).values({ id, status: 'QUEUED', mode: req.mode, symbol: req.symbol, timeframe: req.timeframe, strategy: req.strategy, request: req });
  } else await cache.set(`bt:${id}`, meta, MEM_TTL);
  if (queue) await queue.add('run', { id, req }, { jobId: id });
  else {
    localQueue.push({ id, req });
    setImmediate(() => void processLocal());
  }
  return { jobId: id, status: 'QUEUED' };
}

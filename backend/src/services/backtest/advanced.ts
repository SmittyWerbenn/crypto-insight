import type { Candle } from '../../types/market.js';
import { percentile, round, seededRandom } from '../../utils/math.js';
import { computeSeries } from '../technical/engine.js';
import { indicatorParamsFrom, runBacktest } from './engine.js';
import { computeMetrics, maxDrawdownPct } from './metrics.js';
import { getStrategy } from './strategies/index.js';
import type { BacktestConfig, BacktestMetrics, BacktestResult, EngineInput, EquityPoint, StrategyParams, Trade } from './types.js';
import { PERIODS_PER_YEAR } from '../../config/timeframes.js';

export interface ParamRange {
  min: number;
  max: number;
  step: number;
}

export type Objective = 'sharpe' | 'roi' | 'profitFactor';

export const MAX_COMBINATIONS_HARD_LIMIT = 500;

export function expandGrid(ranges: Record<string, ParamRange>, maxCombinations: number): StrategyParams[] {
  const keys = Object.keys(ranges);
  const values = keys.map((k) => {
    const { min, max, step } = ranges[k];
    if (!(step > 0) || max < min) throw new Error(`Invalid range for ${k}`);
    const vs: number[] = [];
    for (let v = min; v <= max + 1e-9; v += step) vs.push(round(v, 6));
    return vs;
  });
  const total = values.reduce((a, v) => a * v.length, 1);
  const limit = Math.min(maxCombinations, MAX_COMBINATIONS_HARD_LIMIT);
  if (total > limit) throw new Error(`Search space has ${total} combinations, exceeding the limit of ${limit}. Narrow the ranges or increase step.`);
  const out: StrategyParams[] = [];
  const rec = (i: number, acc: StrategyParams) => {
    if (i === keys.length) {
      out.push({ ...acc });
      return;
    }
    for (const v of values[i]) rec(i + 1, { ...acc, [keys[i]]: v });
  };
  rec(0, {});
  return out;
}

function objectiveValue(m: BacktestMetrics, obj: Objective, minTrades: number): number {
  if (m.totalTrades < minTrades) return -Infinity;
  if (obj === 'roi') return m.roi;
  if (obj === 'profitFactor') return m.profitFactor ?? (m.winningTrades > 0 ? 99 : -Infinity);
  return m.sharpe ?? -Infinity;
}

/** Params that violate structural constraints (e.g. fast MA >= slow MA) are skipped. */
function validParams(p: StrategyParams): boolean {
  if (typeof p.maFast === 'number' && typeof p.maSlow === 'number' && p.maFast >= p.maSlow) return false;
  if (typeof p.macdFast === 'number' && typeof p.macdSlow === 'number' && p.macdFast >= p.macdSlow) return false;
  if (typeof p.rsiMin === 'number' && typeof p.rsiMax === 'number' && p.rsiMin >= p.rsiMax) return false;
  return true;
}

export interface OptimizationRun {
  params: StrategyParams;
  objective: number;
  metrics: BacktestMetrics;
}

/**
 * Grid search on a single window. stopLoss/takeProfit in the grid override cfg.
 * Only data in [cfg.tradeFrom, cfg.tradeTo] is traded; the caller is responsible for
 * passing a training window only (never the validation window).
 */
export function optimize(
  cfg: BacktestConfig,
  candles: Candle[],
  ranges: Record<string, ParamRange>,
  opts: { objective: Objective; maxCombinations: number; minTrades: number },
): { tested: number; skipped: number; best: OptimizationRun | null; top: OptimizationRun[] } {
  const grid = expandGrid(ranges, opts.maxCombinations);
  const strategy = getStrategy(cfg.strategy);
  const seriesCache = new Map<string, ReturnType<typeof computeSeries>>();
  const runs: OptimizationRun[] = [];
  let skipped = 0;
  for (const g of grid) {
    const params = { ...strategy.defaultParams, ...(cfg.params ?? {}), ...g };
    if (!validParams(params)) {
      skipped++;
      continue;
    }
    const ip = indicatorParamsFrom(params);
    const key = JSON.stringify(ip);
    let series = seriesCache.get(key);
    if (!series) {
      series = computeSeries(candles, cfg.timeframe, ip);
      seriesCache.set(key, series);
    }
    const { stopLoss, takeProfit, ...rest } = params;
    const r = runBacktest(
      {
        ...cfg,
        params: rest,
        stopLoss: typeof stopLoss === 'number' ? stopLoss : cfg.stopLoss,
        takeProfit: typeof takeProfit === 'number' ? takeProfit : cfg.takeProfit,
      },
      { candles, series },
    );
    runs.push({ params: g, objective: objectiveValue(r.metrics, opts.objective, opts.minTrades), metrics: r.metrics });
  }
  runs.sort((a, b) => b.objective - a.objective);
  const best = runs.find((r) => Number.isFinite(r.objective)) ?? null;
  return { tested: runs.length, skipped, best, top: runs.slice(0, 10) };
}

function applyParams(cfg: BacktestConfig, g: StrategyParams): BacktestConfig {
  const { stopLoss, takeProfit, ...rest } = g;
  return {
    ...cfg,
    params: { ...(cfg.params ?? {}), ...rest },
    stopLoss: typeof stopLoss === 'number' ? stopLoss : cfg.stopLoss,
    takeProfit: typeof takeProfit === 'number' ? takeProfit : cfg.takeProfit,
  };
}

export interface OverfitAssessment {
  overfit: boolean;
  warnings: string[];
}

export function assessOverfitting(train: BacktestMetrics, test: BacktestMetrics): OverfitAssessment {
  const warnings: string[] = [];
  if (train.roi > 0 && test.roi < 0) warnings.push('Profitable in-sample but loss-making out-of-sample.');
  if (train.sharpe !== null && test.sharpe !== null && train.sharpe > 0.5 && test.sharpe < train.sharpe * 0.4)
    warnings.push(`Sharpe dropped from ${train.sharpe} to ${test.sharpe}.`);
  if (train.winRate !== null && test.winRate !== null && train.winRate - test.winRate > 15)
    warnings.push(`Win rate dropped by ${round(train.winRate - test.winRate, 1)} percentage points.`);
  if (test.totalTrades < 10) warnings.push(`Only ${test.totalTrades} out-of-sample trades; comparison has low statistical power.`);
  const overfit = warnings.length > 0 && !(warnings.length === 1 && test.totalTrades < 10);
  return { overfit, warnings };
}

export interface OutOfSampleResult {
  splitRatio: number;
  splitTime: number;
  optimization: { tested: number; skipped: number; bestParams: StrategyParams | null; top: OptimizationRun[] } | null;
  inSample: BacktestResult;
  outOfSample: BacktestResult;
  overfitting: OverfitAssessment;
}

/**
 * Split history by time into in-sample (optimisation) and out-of-sample (validation).
 * Parameters are chosen ONLY from in-sample results; the OOS window is run exactly once.
 */
export function runOutOfSample(
  cfg: BacktestConfig,
  input: EngineInput,
  opts: { splitRatio: number; ranges?: Record<string, ParamRange>; objective?: Objective; maxCombinations?: number; minTrades?: number },
): OutOfSampleResult {
  const { candles } = input;
  const from = cfg.tradeFrom ?? candles[0].openTime;
  const to = cfg.tradeTo ?? candles[candles.length - 1].openTime;
  const window = candles.filter((c) => c.openTime >= from && c.openTime <= to);
  const splitIdx = Math.floor(window.length * opts.splitRatio);
  if (splitIdx < 10 || window.length - splitIdx < 10) throw new Error('Insufficient historical data for in-sample/out-of-sample split');
  const splitTime = window[splitIdx].openTime;
  const isCfg: BacktestConfig = { ...cfg, tradeFrom: from, tradeTo: window[splitIdx - 1].openTime };
  const oosCfg: BacktestConfig = { ...cfg, tradeFrom: splitTime, tradeTo: to };

  let chosen = cfg;
  let optimization: OutOfSampleResult['optimization'] = null;
  if (opts.ranges && Object.keys(opts.ranges).length) {
    const o = optimize(isCfg, candles, opts.ranges, { objective: opts.objective ?? 'sharpe', maxCombinations: opts.maxCombinations ?? 100, minTrades: opts.minTrades ?? 5 });
    optimization = { tested: o.tested, skipped: o.skipped, bestParams: o.best?.params ?? null, top: o.top };
    if (o.best) chosen = applyParams(cfg, o.best.params);
  }
  const inSample = runBacktest({ ...chosen, tradeFrom: isCfg.tradeFrom, tradeTo: isCfg.tradeTo }, input);
  const outOfSample = runBacktest({ ...chosen, tradeFrom: oosCfg.tradeFrom, tradeTo: oosCfg.tradeTo }, input);
  return { splitRatio: opts.splitRatio, splitTime, optimization, inSample, outOfSample, overfitting: assessOverfitting(inSample.metrics, outOfSample.metrics) };
}

export interface WalkForwardWindow {
  index: number;
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
  bestParams: StrategyParams | null;
  combinationsTested: number;
  note: string | null;
  train: BacktestMetrics;
  test: BacktestMetrics;
}

export interface WalkForwardResult {
  trainDays: number;
  testDays: number;
  windows: WalkForwardWindow[];
  combined: BacktestMetrics;
  combinedEquity: EquityPoint[];
  combinedTrades: Trade[];
  overfitting: OverfitAssessment;
}

/**
 * Rolling walk-forward: optimise on [train], evaluate once on the following [test], slide by test length.
 * Test-window results are compounded into a single out-of-sample equity curve.
 */
export function runWalkForward(
  cfg: BacktestConfig,
  input: EngineInput,
  opts: { trainDays: number; testDays: number; ranges?: Record<string, ParamRange>; objective?: Objective; maxCombinations?: number; minTrades?: number },
): WalkForwardResult {
  const { candles } = input;
  const DAY = 86_400_000;
  const start = cfg.tradeFrom ?? candles[0].openTime;
  const end = cfg.tradeTo ?? candles[candles.length - 1].openTime;
  const windows: WalkForwardWindow[] = [];
  let capital = cfg.initialCapital;
  const combinedEquity: EquityPoint[] = [];
  const combinedTrades: Trade[] = [];
  const trainMetrics: BacktestMetrics[] = [];
  let peak = capital;

  for (let trainFrom = start, i = 0; trainFrom + (opts.trainDays + opts.testDays) * DAY <= end + DAY; trainFrom += opts.testDays * DAY, i++) {
    const trainTo = trainFrom + opts.trainDays * DAY - 1;
    const testFrom = trainTo + 1;
    const testTo = Math.min(testFrom + opts.testDays * DAY - 1, end);
    let chosen: BacktestConfig = cfg;
    let bestParams: StrategyParams | null = null;
    let tested = 0;
    let note: string | null = null;
    if (opts.ranges && Object.keys(opts.ranges).length) {
      const o = optimize({ ...cfg, tradeFrom: trainFrom, tradeTo: trainTo }, candles, opts.ranges, {
        objective: opts.objective ?? 'sharpe',
        maxCombinations: opts.maxCombinations ?? 50,
        minTrades: opts.minTrades ?? 3,
      });
      tested = o.tested;
      if (o.best) {
        bestParams = o.best.params;
        chosen = applyParams(cfg, o.best.params);
      } else note = `No parameter set reached the minimum of ${opts.minTrades ?? 3} training trades; default parameters used.`;
    }
    const train = runBacktest({ ...chosen, tradeFrom: trainFrom, tradeTo: trainTo }, input);
    const test = runBacktest({ ...chosen, initialCapital: capital, tradeFrom: testFrom, tradeTo: testTo }, input);
    for (const e of test.equity) {
      peak = Math.max(peak, e.equity);
      combinedEquity.push({ ...e, peak, drawdownPct: ((e.equity - peak) / peak) * 100 });
    }
    combinedTrades.push(...test.trades);
    capital = test.metrics.finalCapital;
    trainMetrics.push(train.metrics);
    windows.push({ index: i, trainFrom, trainTo, testFrom, testTo, bestParams, combinationsTested: tested, note, train: train.metrics, test: test.metrics });
  }
  if (!windows.length) throw new Error('Insufficient historical data for walk-forward analysis with the chosen train/test lengths');

  const combined = computeMetrics({
    initialCapital: cfg.initialCapital,
    trades: combinedTrades,
    equity: combinedEquity,
    periodsPerYear: PERIODS_PER_YEAR[cfg.timeframe],
    exposurePct: NaN,
    buyAndHoldRoi: null,
  });
  // Aggregate train performance for the overfitting comparison
  const avg = (f: (m: BacktestMetrics) => number | null) => {
    const v = trainMetrics.map(f).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const trainAgg = { ...combined, roi: avg((m) => m.roi) ?? 0, sharpe: avg((m) => m.sharpe), winRate: avg((m) => m.winRate), totalTrades: trainMetrics.reduce((a, m) => a + m.totalTrades, 0) };
  return {
    trainDays: opts.trainDays,
    testDays: opts.testDays,
    windows,
    combined: { ...combined, exposurePct: NaN },
    combinedEquity,
    combinedTrades,
    overfitting: assessOverfitting(trainAgg, combined),
  };
}

export interface MonteCarloResult {
  iterations: number;
  trades: number;
  medianEndingCapital: number;
  worst5PctEndingCapital: number;
  best5PctEndingCapital: number;
  medianMaxDrawdown: number;
  worst5PctMaxDrawdown: number;
  drawdownThreshold: number;
  probDrawdownBeyondThreshold: number;
  probLoss: number;
  note: string;
}

/**
 * Bootstrap (resample with replacement) the per-trade equity returns to explore alternative
 * orderings/combinations. Deterministic seed. A simulation of past return distribution, not a forecast.
 */
export function monteCarlo(trades: Trade[], initialCapital: number, opts: { iterations?: number; drawdownThreshold?: number; seed?: number } = {}): MonteCarloResult | null {
  if (trades.length < 5) return null;
  const iterations = Math.min(opts.iterations ?? 1000, 10_000);
  const threshold = opts.drawdownThreshold ?? 20;
  const rnd = seededRandom(opts.seed ?? 42);
  const rets = trades.map((t) => t.equityReturnPct / 100);
  const ends: number[] = [];
  const dds: number[] = [];
  for (let k = 0; k < iterations; k++) {
    let eq = initialCapital;
    const path = [eq];
    for (let j = 0; j < rets.length; j++) {
      eq *= 1 + rets[Math.floor(rnd() * rets.length)];
      path.push(eq);
    }
    ends.push(eq);
    dds.push(maxDrawdownPct(path));
  }
  return {
    iterations,
    trades: trades.length,
    medianEndingCapital: round(percentile(ends, 0.5), 2),
    worst5PctEndingCapital: round(percentile(ends, 0.05), 2),
    best5PctEndingCapital: round(percentile(ends, 0.95), 2),
    medianMaxDrawdown: round(percentile(dds, 0.5), 2),
    worst5PctMaxDrawdown: round(percentile(dds, 0.05), 2),
    drawdownThreshold: threshold,
    probDrawdownBeyondThreshold: round((dds.filter((d) => d <= -threshold).length / iterations) * 100, 1),
    probLoss: round((ends.filter((e) => e < initialCapital).length / iterations) * 100, 1),
    note: 'Monte Carlo resamples historical trade returns. It assumes the past return distribution and is not a prediction of future results.',
  };
}

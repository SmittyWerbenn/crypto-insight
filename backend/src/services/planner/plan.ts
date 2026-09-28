import { SIGNAL_LABEL_ID, TARGET_CONFIG } from '../../config/scoring.js';
import { TIMEFRAME_MS, type Timeframe } from '../../config/timeframes.js';
import type { Candle } from '../../types/market.js';
import { mean, median, round } from '../../utils/math.js';
import { analyzeCandles, type TechnicalAnalysis } from '../analysis/technical-analysis.js';
import { CausalCache } from '../backtest/engine.js';
import { evaluateOutcome } from '../signals/outcome.js';
import { computeSeries } from '../technical/engine.js';

export type RiskProfile = 'konservatif' | 'moderat' | 'agresif';
export const RISK_PER_TRADE: Record<RiskProfile, number> = { konservatif: 0.005, moderat: 0.01, agresif: 0.02 };

export interface PlanHistory {
  /** Past BUY signals on which the identical plan was simulated. */
  sampleSize: number;
  targetHit: number;
  stopHit: number;
  timeout: number;
  hitRate: number | null;
  /** Median candles from entry until the target was reached (target hits only). */
  medianCandlesToTarget: number | null;
  /** Average net return per trade after fees & slippage (both sides), %. */
  expectancyNetPct: number | null;
  averageTimeoutReturnPct: number | null;
  worstReturnPct: number | null;
  reliability: 'INSUFFICIENT' | 'LIMITED' | 'MODERATE' | 'GOOD';
}

export interface SymbolPlan {
  symbol: string;
  timeframe: Timeframe;
  analysis: TechnicalAnalysis;
  eligible: boolean;
  reason: string | null;
  entry: number | null;
  target: number | null;
  stop: number | null;
  targetPct: number | null;
  stopPct: number | null;
  maxHoldCandles: number;
  history: PlanHistory | null;
}

const BUY = new Set(['BUY', 'STRONG_BUY']);

/**
 * Simulate "enter at next open after a BUY signal, exit at +targetPct / stopPct / after maxHold candles"
 * on every past BUY signal. Uses only closed history; trades never overlap. Costs: fee + slippage per side.
 * Ambiguous candles (target and stop in the same candle) are counted conservatively as stops.
 */
export function simulatePlanHistory(candles: Candle[], tf: Timeframe, targetPct: number, stopPct: number, maxHold: number, costPerSidePct: number): PlanHistory {
  const series = computeSeries(candles, tf);
  const cache = new CausalCache(candles, series);
  const rets: number[] = [];
  const toTarget: number[] = [];
  const timeouts: number[] = [];
  let target = 0;
  let stop = 0;
  let timeout = 0;
  // Exclude the most recent candle (that is the live signal itself)
  for (let i = 200; i < candles.length - 2; i++) {
    if (!cache.snapshot(i).complete || !BUY.has(cache.score(i).signal)) continue;
    const entry = candles[i + 1].open;
    const sig = { direction: 'LONG' as const, entryPrice: entry, targetPrice: entry * (1 + targetPct / 100), stopPrice: entry * (1 + stopPct / 100), candleTime: candles[i].openTime };
    const o = evaluateOutcome(sig, candles.slice(i + 1, i + 1 + maxHold), maxHold);
    if (o.status === 'OPEN' || o.status === 'PENDING') break; // not enough future data yet
    const gross = o.status === 'AMBIGUOUS' ? stopPct : (o.returnPercent ?? 0);
    const net = gross - 2 * costPerSidePct;
    rets.push(net);
    if (o.status === 'TARGET_HIT') {
      target++;
      toTarget.push(o.candlesEvaluated);
    } else if (o.status === 'TIMEOUT') {
      timeout++;
      timeouts.push(net);
    } else stop++;
    i += o.candlesEvaluated; // no overlapping trades
  }
  const n = rets.length;
  const reliability = n < 10 ? 'INSUFFICIENT' : n < 30 ? 'LIMITED' : n < 100 ? 'MODERATE' : 'GOOD';
  return {
    sampleSize: n,
    targetHit: target,
    stopHit: stop,
    timeout,
    hitRate: n ? round((target / n) * 100, 1) : null,
    medianCandlesToTarget: toTarget.length ? Math.round(median(toTarget)) : null,
    expectancyNetPct: n ? round(mean(rets), 3) : null,
    averageTimeoutReturnPct: timeouts.length ? round(mean(timeouts), 2) : null,
    worstReturnPct: n ? round(Math.min(...rets), 2) : null,
    reliability,
  };
}

/** Trade plan for one symbol from its closed candles. */
export function planSymbol(symbol: string, tf: Timeframe, candles: Candle[], costPerSidePct: number, maxHold = TARGET_CONFIG.evaluationWindow): SymbolPlan {
  const analysis = analyzeCandles(symbol, tf, candles);
  const base: SymbolPlan = { symbol, timeframe: tf, analysis, eligible: false, reason: null, entry: null, target: null, stop: null, targetPct: null, stopPct: null, maxHoldCandles: maxHold, history: null };
  const lv = analysis.levels;
  if (!BUY.has(analysis.signal)) return { ...base, reason: `Sinyal saat ini ${SIGNAL_LABEL_ID[analysis.signal]} (skor ${analysis.technicalScore}) — belum ada setup beli.` };
  if (!lv || lv.direction !== 'LONG' || lv.upsidePct === null) return { ...base, reason: 'Level target/stop tidak dapat dihitung.' };
  const history = simulatePlanHistory(candles, tf, lv.upsidePct, lv.downsidePct, maxHold, costPerSidePct);
  const plan = { ...base, entry: lv.entry, target: lv.target, stop: lv.stop, targetPct: lv.upsidePct, stopPct: lv.downsidePct, history };
  if (history.sampleSize < 10) return { ...plan, reason: `Sampel historis terlalu sedikit (${history.sampleSize}) untuk menilai rencana ini.` };
  if ((history.expectancyNetPct ?? 0) <= 0) return { ...plan, reason: `Secara historis rencana ini rata-rata merugi setelah biaya (${history.expectancyNetPct}% per trade).` };
  return { ...plan, eligible: true };
}

export const holdMs = (candles: number, tf: Timeframe) => candles * TIMEFRAME_MS[tf];

/** Ranking score: net expectancy weighted by how much history supports it. */
export const opportunityScore = (h: PlanHistory) => (h.expectancyNetPct ?? 0) * Math.sqrt(Math.min(h.sampleSize, 100) / 100);

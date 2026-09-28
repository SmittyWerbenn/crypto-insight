import { HISTORICAL_CONFIG } from '../../config/scoring.js';
import { TIMEFRAME_MS, type Timeframe } from '../../config/timeframes.js';
import type { Candle } from '../../types/market.js';
import { mean, median, round } from '../../utils/math.js';
import type { IndicatorSeries } from '../technical/engine.js';

export interface SetupFeatures {
  rsi: number;
  macdBullish: boolean;
  aboveMa20: boolean;
  aboveMa50: boolean;
  volumeAboveAvg: boolean;
}

export interface ForwardReturnStat {
  candles: number;
  hours: number;
  label: string;
  n: number;
  average: number | null;
  median: number | null;
  best: number | null;
  worst: number | null;
  positiveRate: number | null;
}

export interface SimilarityResult {
  setup: SetupFeatures | null;
  sampleSize: number;
  positive: number;
  negative: number;
  /** Share of similar historical setups with positive return at the outcome horizon. NOT a probability. */
  historicalPositiveRate: number | null;
  outcomeHorizon: number;
  forward: ForwardReturnStat[];
  maxHistoricalGain: number | null;
  maxHistoricalLoss: number | null;
  reliability: 'INSUFFICIENT' | 'LIMITED' | 'MODERATE' | 'GOOD';
  note: string;
}

export function featuresAt(s: IndicatorSeries, candles: Candle[], i: number): SetupFeatures | null {
  const rsi = s.rsi[i];
  const hist = s.macd.histogram[i];
  const ma20 = s.sma20[i];
  const ma50 = s.sma50[i];
  const vma = s.volumeMa[i];
  if (![rsi, hist, ma20, ma50, vma].every(Number.isFinite)) return null;
  const c = candles[i].close;
  return { rsi, macdBullish: hist > 0, aboveMa20: c > ma20, aboveMa50: c > ma50, volumeAboveAvg: candles[i].volume > vma };
}

const hoursOf = (candles: number, tf: Timeframe) => round((candles * TIMEFRAME_MS[tf]) / 3_600_000, 2);

export function horizonLabel(candles: number, tf: Timeframe): string {
  const ms = candles * TIMEFRAME_MS[tf];
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 48 || h % 24 !== 0) return `${round(h, 1)}H`;
  return `${h / 24}D`;
}

export function reliabilityOf(n: number): SimilarityResult['reliability'] {
  if (n < 10) return 'INSUFFICIENT';
  if (n < HISTORICAL_CONFIG.minReliableSample) return 'LIMITED';
  if (n < HISTORICAL_CONFIG.fullMetricsSample) return 'MODERATE';
  return 'GOOD';
}

/**
 * Find historical candles whose setup matches candle `t`, and measure what happened next.
 * Only candidates whose full forward window closes at or before `t` are used, so the
 * analysis never peeks beyond the evaluation candle.
 */
export function findSimilarSetups(
  candles: Candle[],
  s: IndicatorSeries,
  t: number,
  tf: Timeframe,
  horizons: number[] = HISTORICAL_CONFIG.forwardHorizons,
  rsiTolerance = HISTORICAL_CONFIG.rsiTolerance,
): SimilarityResult {
  const setup = featuresAt(s, candles, t);
  const outcomeHorizon = HISTORICAL_CONFIG.outcomeHorizon;
  const empty: SimilarityResult = {
    setup,
    sampleSize: 0,
    positive: 0,
    negative: 0,
    historicalPositiveRate: null,
    outcomeHorizon,
    forward: horizons.map((h) => ({ candles: h, hours: hoursOf(h, tf), label: horizonLabel(h, tf), n: 0, average: null, median: null, best: null, worst: null, positiveRate: null })),
    maxHistoricalGain: null,
    maxHistoricalLoss: null,
    reliability: 'INSUFFICIENT',
    note: 'Data belum cukup untuk mengevaluasi setup serupa.',
  };
  if (!setup) return empty;

  const maxH = Math.max(...horizons, outcomeHorizon);
  const matches: number[] = [];
  // Candidate i is usable only if i + maxH <= t (its outcome is already known at time t).
  // Skip adjacent matches (i within outcomeHorizon of the previous) to reduce overlap/autocorrelation.
  let last = -Infinity;
  for (let i = 0; i + maxH <= t; i++) {
    const f = featuresAt(s, candles, i);
    if (!f) continue;
    if (
      f.macdBullish === setup.macdBullish &&
      f.aboveMa20 === setup.aboveMa20 &&
      f.aboveMa50 === setup.aboveMa50 &&
      f.volumeAboveAvg === setup.volumeAboveAvg &&
      Math.abs(f.rsi - setup.rsi) <= rsiTolerance &&
      i - last >= outcomeHorizon
    ) {
      matches.push(i);
      last = i;
    }
  }
  if (!matches.length) return { ...empty, note: 'Tidak ditemukan setup historis serupa pada data yang tersedia.' };

  const ret = (i: number, h: number) => ((candles[i + h].close - candles[i].close) / candles[i].close) * 100;
  const forward = horizons.map((h) => {
    const rs = matches.map((i) => ret(i, h));
    return {
      candles: h,
      hours: hoursOf(h, tf),
      label: horizonLabel(h, tf),
      n: rs.length,
      average: round(mean(rs), 2),
      median: round(median(rs), 2),
      best: round(Math.max(...rs), 2),
      worst: round(Math.min(...rs), 2),
      positiveRate: round((rs.filter((r) => r > 0).length / rs.length) * 100, 1),
    };
  });
  const outcomes = matches.map((i) => ret(i, outcomeHorizon));
  const positive = outcomes.filter((r) => r > 0).length;
  const n = matches.length;
  const reliability = reliabilityOf(n);
  return {
    setup,
    sampleSize: n,
    positive,
    negative: n - positive,
    historicalPositiveRate: round((positive / n) * 100, 1),
    outcomeHorizon,
    forward,
    maxHistoricalGain: round(Math.max(...forward.map((f) => f.best ?? -Infinity)), 2),
    maxHistoricalLoss: round(Math.min(...forward.map((f) => f.worst ?? Infinity)), 2),
    reliability,
    note:
      reliability === 'INSUFFICIENT' || reliability === 'LIMITED'
        ? 'Sampel historis terbatas. Statistik performa mungkin kurang andal.'
        : 'Statistik historis menggambarkan perilaku masa lalu dan tidak menjamin hasil di masa depan.',
  };
}

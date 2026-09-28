/**
 * Central scoring configuration. All weights, thresholds and signal bands live here.
 * Weights must sum to 100. Scores are a weighted checklist, NOT a probability.
 */
export interface ScoringWeights {
  rsi: number;
  macd: number;
  maFastSlow: number; // MA20 vs MA50
  maSlowLong: number; // MA50 vs MA200
  volume: number;
  bollinger: number;
  momentum: number;
  priceAction: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  rsi: 15,
  macd: 20,
  maFastSlow: 15,
  maSlowLong: 15,
  volume: 10,
  bollinger: 5,
  momentum: 10,
  priceAction: 10,
};

export type SignalType = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export const SIGNAL_BANDS: { min: number; signal: SignalType }[] = [
  { min: 80, signal: 'STRONG_BUY' },
  { min: 65, signal: 'BUY' },
  { min: 45, signal: 'HOLD' },
  { min: 30, signal: 'SELL' },
  { min: 0, signal: 'STRONG_SELL' },
];

export const SIGNAL_LABEL: Record<SignalType, string> = {
  STRONG_BUY: 'STRONG BUY',
  BUY: 'BUY',
  HOLD: 'HOLD',
  SELL: 'SELL / REDUCE',
  STRONG_SELL: 'STRONG SELL',
};

/** Indonesian display labels (UI language). */
export const SIGNAL_LABEL_ID: Record<SignalType, string> = {
  STRONG_BUY: 'Beli Kuat',
  BUY: 'Beli',
  HOLD: 'Tahan',
  SELL: 'Jual / Kurangi',
  STRONG_SELL: 'Jual Kuat',
};

export const SCORING_PARAMS = {
  rsiPeriod: 14,
  macd: { fast: 12, slow: 26, signal: 9 },
  bollinger: { period: 20, stdDev: 2 },
  atrPeriod: 14,
  volumeMaPeriod: 20,
  rocPeriod: 10,
  swingLookback: 3,
  srLookback: 120,
  /** Minimum candles required before a score is considered valid (MA200 warm-up). */
  minCandles: 210,
};

export const HISTORICAL_CONFIG = {
  /** Forward horizons in candles. */
  forwardHorizons: [1, 3, 6, 12, 24],
  /** Horizon used to classify "positive outcome" of a similar setup. */
  outcomeHorizon: 6,
  /** Tolerance for RSI similarity. */
  rsiTolerance: 7.5,
  /** Below this sample count, statistics are flagged as unreliable. */
  minReliableSample: Number(process.env.MIN_RELIABLE_SAMPLE ?? 30),
  /** Full metrics shown only at or above this sample size. */
  fullMetricsSample: Number(process.env.FULL_METRICS_SAMPLE ?? 100),
};

export const TARGET_CONFIG = {
  atrStopMultiplier: 1.5,
  atrTargetMultiplier: 3,
  minRiskReward: 1.5,
  /** Signal evaluation window in candles before TIMEOUT. */
  evaluationWindow: 24,
};

export function validateWeights(w: ScoringWeights): void {
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 1e-9) throw new Error(`Scoring weights must sum to 100, got ${total}`);
}

validateWeights(DEFAULT_WEIGHTS);

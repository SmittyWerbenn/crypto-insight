import { HISTORICAL_CONFIG, SIGNAL_LABEL, type SignalType } from '../../config/scoring.js';
import { TIMEFRAME_MS, type Timeframe } from '../../config/timeframes.js';
import type { Candle } from '../../types/market.js';
import { median, round } from '../../utils/math.js';
import { checkDataQuality } from '../backtest/data-quality.js';
import type { DataQualityReport } from '../backtest/types.js';
import { findSimilarSetups, type SimilarityResult } from '../historical/similarity.js';
import { assessRisk, type RiskAssessment } from '../scoring/risk.js';
import { scoreSnapshot, type ScoreResult } from '../scoring/scoring.js';
import { computeLevels, computeScenarios, type Scenario, type TradeLevels } from '../scoring/targets.js';
import { computeSeries, snapshotAt, type TechnicalSnapshot } from '../technical/engine.js';

export interface TechnicalAnalysis {
  symbol: string;
  timeframe: Timeframe;
  candleTime: number;
  candleCloseTime: number;
  price: number;
  signal: SignalType;
  signalLabel: string;
  technicalScore: number;
  score: ScoreResult;
  dataCompleteness: number;
  snapshot: TechnicalSnapshot;
  risk: RiskAssessment;
  levels: TradeLevels | null;
  scenarios: Scenario | null;
  historical: SimilarityResult;
  regime: 'BULL' | 'BEAR' | 'SIDEWAYS';
  /** Median annualized HV over the last 100 candles (for volatility regime). */
  volatilityMedian: number | null;
  dataQuality: DataQualityReport;
  candlesAnalyzed: number;
}

/** Standard horizons plus the candle counts equal to 24h and 48h when they divide evenly. */
export function horizonsFor(tf: Timeframe): number[] {
  const hs = new Set(HISTORICAL_CONFIG.forwardHorizons);
  for (const hours of [24, 48]) {
    const n = (hours * 3_600_000) / TIMEFRAME_MS[tf];
    if (Number.isInteger(n) && n >= 1 && n <= 200) hs.add(n);
  }
  return [...hs].sort((a, b) => a - b);
}

export class InvalidMarketDataError extends Error {}

/** Pure technical pipeline on CLOSED candles: indicators → score → risk → levels → scenarios → historical similarity. */
export function analyzeCandles(symbol: string, tf: Timeframe, raw: Candle[]): TechnicalAnalysis {
  const { candles, report } = checkDataQuality(raw, tf);
  if (report.severe) throw new InvalidMarketDataError(`Market data failed quality checks: ${report.warnings.join(' ')}`);
  if (candles.length < 60) throw new InvalidMarketDataError(`Insufficient candles for analysis (${candles.length})`);
  const series = computeSeries(candles, tf);
  const t = candles.length - 1;
  const snap = snapshotAt(candles, series, t);
  const prev = snapshotAt(candles, series, t - 1);
  const score = scoreSnapshot(snap, prev);
  const sim = findSimilarSetups(candles, series, t, tf, horizonsFor(tf));
  const regime = snap.sma200 === null || snap.sma50 === null ? 'SIDEWAYS' : snap.price > snap.sma200 && snap.sma50 > snap.sma200 ? 'BULL' : snap.price < snap.sma200 && snap.sma50 < snap.sma200 ? 'BEAR' : 'SIDEWAYS';
  return {
    symbol,
    timeframe: tf,
    candleTime: candles[t].openTime,
    candleCloseTime: candles[t].closeTime,
    price: snap.price,
    signal: score.signal,
    signalLabel: SIGNAL_LABEL[score.signal],
    technicalScore: score.score,
    score,
    dataCompleteness: round(score.dataCompleteness, 3),
    snapshot: snap,
    risk: assessRisk(snap),
    levels: computeLevels(snap, score.signal),
    scenarios: computeScenarios(snap),
    historical: sim,
    regime,
    volatilityMedian: (() => {
      const w = series.hv.slice(Math.max(0, t - 100), t + 1).filter(Number.isFinite);
      return w.length ? median(w) : null;
    })(),
    dataQuality: report,
    candlesAnalyzed: candles.length,
  };
}

export const HISTORICAL_OUTCOME_HOURS = (tf: Timeframe) => (HISTORICAL_CONFIG.outcomeHorizon * TIMEFRAME_MS[tf]) / 3_600_000;

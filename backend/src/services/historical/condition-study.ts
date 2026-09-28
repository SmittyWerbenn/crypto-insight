import type { Timeframe } from '../../config/timeframes.js';
import { TIMEFRAME_MS } from '../../config/timeframes.js';
import type { Candle } from '../../types/market.js';
import { mean, median, round } from '../../utils/math.js';
import { signalFromScore, scoreSnapshot } from '../scoring/scoring.js';
import { computeSeries, snapshotAt } from '../technical/engine.js';
import { reliabilityOf } from './similarity.js';
import { maxDrawdownPct } from '../backtest/metrics.js';
import { SIGNAL_LABEL, type SignalType } from '../../config/scoring.js';

export interface ConditionQuery {
  signal?: SignalType;
  rsiMin?: number;
  rsiMax?: number;
  macd?: 'bullish' | 'bearish';
  priceAboveMa20?: boolean;
  priceAboveMa50?: boolean;
  priceAboveMa200?: boolean;
  volumeAboveAvg?: boolean;
  /** Holding period in candles. */
  horizon: number;
}

/**
 * "How did BUY BTC signals perform when RSI 50-70, MACD bullish and price > MA50?"
 * Scans closed history for candles matching the conditions (non-overlapping), enters at the next
 * candle open and exits after `horizon` candles. Stats only use data available at each point in time.
 */
export function conditionStudy(candles: Candle[], tf: Timeframe, q: ConditionQuery) {
  const series = computeSeries(candles, tf);
  const matches: { i: number; ret: number; mdd: number; time: number }[] = [];
  let nextAllowed = 0;
  for (let i = 1; i + q.horizon + 1 < candles.length; i++) {
    if (i < nextAllowed) continue;
    const s = snapshotAt(candles, series, i);
    if (!s.complete) continue;
    if (q.rsiMin !== undefined && (s.rsi === null || s.rsi < q.rsiMin)) continue;
    if (q.rsiMax !== undefined && (s.rsi === null || s.rsi > q.rsiMax)) continue;
    if (q.macd && (s.macdHistogram === null || (q.macd === 'bullish') !== s.macdHistogram > 0)) continue;
    if (q.priceAboveMa20 !== undefined && (s.sma20 === null || (s.price > s.sma20) !== q.priceAboveMa20)) continue;
    if (q.priceAboveMa50 !== undefined && (s.sma50 === null || (s.price > s.sma50) !== q.priceAboveMa50)) continue;
    if (q.priceAboveMa200 !== undefined && (s.sma200 === null || (s.price > s.sma200) !== q.priceAboveMa200)) continue;
    if (q.volumeAboveAvg !== undefined && (s.volumeRatio === null || (s.volumeRatio > 1) !== q.volumeAboveAvg)) continue;
    if (q.signal) {
      const sc = scoreSnapshot(s, snapshotAt(candles, series, i - 1));
      if (signalFromScore(sc.score) !== q.signal) continue;
    }
    const entry = candles[i + 1].open;
    const exit = candles[i + q.horizon].close;
    const short = q.signal === 'SELL' || q.signal === 'STRONG_SELL';
    const path = candles.slice(i + 1, i + q.horizon + 1).map((c) => (short ? 2 * entry - c.close : c.close));
    const ret = ((short ? entry - exit : exit - entry) / entry) * 100;
    matches.push({ i, ret, mdd: maxDrawdownPct([entry, ...path]), time: candles[i].openTime });
    nextAllowed = i + q.horizon;
  }
  const rets = matches.map((m) => m.ret);
  const n = rets.length;
  const reliability = reliabilityOf(n);
  return {
    query: { ...q, signalLabel: q.signal ? SIGNAL_LABEL[q.signal] : null },
    timeframe: tf,
    candlesScanned: candles.length,
    sampleSize: n,
    winRate: n ? round((rets.filter((r) => r > 0).length / n) * 100, 1) : null,
    averageReturn: n ? round(mean(rets), 2) : null,
    medianReturn: n ? round(median(rets), 2) : null,
    bestReturn: n ? round(Math.max(...rets), 2) : null,
    worstReturn: n ? round(Math.min(...rets), 2) : null,
    averageHoldingMs: q.horizon * TIMEFRAME_MS[tf],
    maxDrawdown: n ? round(Math.min(...matches.map((m) => m.mdd)), 2) : null,
    reliability,
    warning: reliability === 'INSUFFICIENT' || reliability === 'LIMITED' ? 'Limited historical sample. Performance statistics may be unreliable.' : null,
    recent: matches.slice(-20).map((m) => ({ time: m.time, returnPct: round(m.ret, 2) })),
    note: 'Returns exclude fees/slippage. Entry at next candle open after the matching candle; exit after the holding period.',
  };
}

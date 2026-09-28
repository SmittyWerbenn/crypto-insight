import type { Candle } from '../../types/market.js';
import { SCORING_PARAMS } from '../../config/scoring.js';
import { PERIODS_PER_YEAR, type Timeframe } from '../../config/timeframes.js';
import * as ind from './indicators.js';
import { detectPivots, priceActionAt, type Pivot, type PriceActionState } from './price-action.js';

export interface IndicatorSeries {
  closes: number[];
  sma20: number[];
  sma50: number[];
  sma200: number[];
  ema20: number[];
  ema50: number[];
  rsi: number[];
  macd: ind.MacdResult;
  stochRsi: ind.StochRsiResult;
  roc: number[];
  bb: ind.BollingerResult;
  atr: number[];
  adx: ind.AdxResult;
  hv: number[];
  volumeMa: number[];
  obv: number[];
  pivots: Pivot[];
}

export interface IndicatorParams {
  maFast: number;
  maSlow: number;
  maLong: number;
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
}

export const DEFAULT_INDICATOR_PARAMS: IndicatorParams = {
  maFast: 20,
  maSlow: 50,
  maLong: 200,
  rsiPeriod: SCORING_PARAMS.rsiPeriod,
  macdFast: SCORING_PARAMS.macd.fast,
  macdSlow: SCORING_PARAMS.macd.slow,
  macdSignal: SCORING_PARAMS.macd.signal,
};

/** Compute all indicator series once. Every series is causal (see indicators.ts). */
export function computeSeries(candles: Candle[], timeframe: Timeframe = '1d', p: IndicatorParams = DEFAULT_INDICATOR_PARAMS): IndicatorSeries {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const vols = candles.map((c) => c.volume);
  return {
    closes,
    sma20: ind.sma(closes, p.maFast),
    sma50: ind.sma(closes, p.maSlow),
    sma200: ind.sma(closes, p.maLong),
    ema20: ind.ema(closes, 20),
    ema50: ind.ema(closes, 50),
    rsi: ind.rsi(closes, p.rsiPeriod),
    macd: ind.macd(closes, p.macdFast, p.macdSlow, p.macdSignal),
    stochRsi: ind.stochRsi(closes),
    roc: ind.roc(closes, SCORING_PARAMS.rocPeriod),
    bb: ind.bollinger(closes, SCORING_PARAMS.bollinger.period, SCORING_PARAMS.bollinger.stdDev),
    atr: ind.atr(highs, lows, closes, SCORING_PARAMS.atrPeriod),
    adx: ind.adx(highs, lows, closes, 14),
    hv: ind.historicalVolatility(closes, 20, PERIODS_PER_YEAR[timeframe]),
    volumeMa: ind.sma(vols, SCORING_PARAMS.volumeMaPeriod),
    obv: ind.obv(closes, vols),
    pivots: detectPivots(candles, SCORING_PARAMS.swingLookback),
  };
}

export type MacdState = 'bullish' | 'bearish' | 'bullish_cross' | 'bearish_cross' | 'unknown';

export interface TechnicalSnapshot {
  index: number;
  time: number;
  price: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  macdState: MacdState;
  stochRsiK: number | null;
  stochRsiD: number | null;
  roc: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbPercentB: number | null;
  bbBandwidth: number | null;
  atr: number | null;
  atrPct: number | null;
  historicalVolatility: number | null;
  volume: number;
  volumeMa: number | null;
  volumeRatio: number | null;
  volumeChangePct: number | null;
  obv: number | null;
  obvSlope: number | null;
  priceAction: PriceActionState;
  /** True when all core indicators (incl. MA200) have warmed up. */
  complete: boolean;
}

const f = (v: number | undefined): number | null => (v === undefined || !Number.isFinite(v) ? null : v);

/** Snapshot at candle index t. Reads only series[0..t] / candles[0..t]. */
export function snapshotAt(candles: Candle[], s: IndicatorSeries, t: number): TechnicalSnapshot {
  const c = candles[t];
  const hist = s.macd.histogram[t];
  const prevHist = t > 0 ? s.macd.histogram[t - 1] : NaN;
  let macdState: MacdState = 'unknown';
  if (Number.isFinite(hist)) {
    if (Number.isFinite(prevHist) && prevHist <= 0 && hist > 0) macdState = 'bullish_cross';
    else if (Number.isFinite(prevHist) && prevHist >= 0 && hist < 0) macdState = 'bearish_cross';
    else macdState = hist > 0 ? 'bullish' : 'bearish';
  }
  const volMa = f(s.volumeMa[t]);
  const atrV = f(s.atr[t]);
  const obvPrev = t >= 10 ? s.obv[t - 10] : NaN;
  const snap: TechnicalSnapshot = {
    index: t,
    time: c.openTime,
    price: c.close,
    sma20: f(s.sma20[t]),
    sma50: f(s.sma50[t]),
    sma200: f(s.sma200[t]),
    ema20: f(s.ema20[t]),
    ema50: f(s.ema50[t]),
    adx: f(s.adx.adx[t]),
    plusDI: f(s.adx.plusDI[t]),
    minusDI: f(s.adx.minusDI[t]),
    rsi: f(s.rsi[t]),
    macd: f(s.macd.macd[t]),
    macdSignal: f(s.macd.signal[t]),
    macdHistogram: f(hist),
    macdState,
    stochRsiK: f(s.stochRsi.k[t]),
    stochRsiD: f(s.stochRsi.d[t]),
    roc: f(s.roc[t]),
    bbUpper: f(s.bb.upper[t]),
    bbMiddle: f(s.bb.middle[t]),
    bbLower: f(s.bb.lower[t]),
    bbPercentB: f(s.bb.percentB[t]),
    bbBandwidth: f(s.bb.bandwidth[t]),
    atr: atrV,
    atrPct: atrV !== null ? (atrV / c.close) * 100 : null,
    historicalVolatility: f(s.hv[t]),
    volume: c.volume,
    volumeMa: volMa,
    volumeRatio: volMa ? c.volume / volMa : null,
    volumeChangePct: volMa ? ((c.volume - volMa) / volMa) * 100 : null,
    obv: f(s.obv[t]),
    obvSlope: Number.isFinite(obvPrev) ? s.obv[t] - obvPrev : null,
    priceAction: priceActionAt(candles, s.pivots, t, { srLookback: SCORING_PARAMS.srLookback }),
    complete: false,
  };
  snap.complete = [snap.sma200, snap.rsi, snap.macdHistogram, snap.atr, snap.bbPercentB, snap.volumeMa].every((v) => v !== null);
  return snap;
}

export function latestSnapshot(candles: Candle[], timeframe: Timeframe): TechnicalSnapshot {
  if (!candles.length) throw new Error('No candles');
  const s = computeSeries(candles, timeframe);
  return snapshotAt(candles, s, candles.length - 1);
}

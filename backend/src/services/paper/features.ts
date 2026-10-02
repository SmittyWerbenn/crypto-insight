import type { Candle } from '../../types/market.js';
import { CausalCache } from '../backtest/engine.js';
import { computeSeries, type IndicatorSeries } from '../technical/engine.js';

/**
 * Entry features for Paper Trading V2, computed on CLOSED 1h candles only (index i = the signal candle).
 * The same function feeds the research backtest and the live engine, so both see identical numbers.
 */
export interface CoinFeatures {
  time: number; // open time of the signal candle
  close: number;
  score: number;
  signal: string;
  /** SMA50/SMA200 regime of the coin on 1h. */
  regime: 'BULL' | 'BEAR' | 'SIDEWAYS';
  rsi: number;
  macdHist: number;
  macdHistPrev: number;
  roc: number;
  volRatio: number;
  atrPct: number;
  /** Rank (0..100) of the current ATR% among the previous 720 candles (30 days) of the same coin. */
  atrPctile: number;
  /** (close − EMA20) / ATR. */
  ema20Atr: number;
  /** EMA20 above EMA50 (short-term uptrend). */
  emaUp: boolean;
  /** (close − SMA20) / ATR. */
  ma20Atr: number;
  bbPctB: number;
  adx: number;
  /** close vs highest high of the previous 20 candles, in ATR (> 0 = breakout). */
  hh20Atr: number;
  ret4h: number;
  ret24h: number;
}

export interface BtcContext {
  regime: 'BULL' | 'BEAR' | 'SIDEWAYS';
  emaUp: boolean;
  aboveEma50: boolean;
  rsi: number;
  ret1h: number;
  ret4h: number;
  ret24h: number;
  atrPct: number;
  /** Macro trend (1h candles): 7-day and 30-day return, and close vs the 30-day (720h) SMA. */
  ret7d: number;
  ret30d: number;
  aboveSma30d: boolean;
}

const ATR_WINDOW = 720;

export class FeatureSeries {
  readonly series: IndicatorSeries;
  private cache: CausalCache;
  private atrPctArr: number[];

  constructor(readonly candles: Candle[]) {
    this.series = computeSeries(candles, '1h');
    this.cache = new CausalCache(candles, this.series);
    this.atrPctArr = candles.map((c, i) => (Number.isFinite(this.series.atr[i]) ? (this.series.atr[i] / c.close) * 100 : NaN));
  }

  /** Features at signal candle i, or null while indicators are warming up. */
  at(i: number): CoinFeatures | null {
    if (i < 230 || i >= this.candles.length) return null;
    const snap = this.cache.snapshot(i);
    if (!snap.complete || snap.atr === null || snap.ema20 === null || snap.ema50 === null) return null;
    const sc = this.cache.score(i);
    const c = this.candles;
    const s = this.series;
    const atrPct = this.atrPctArr[i];
    let below = 0;
    let n = 0;
    for (let k = Math.max(0, i - ATR_WINDOW); k < i; k++) {
      const v = this.atrPctArr[k];
      if (!Number.isFinite(v)) continue;
      n++;
      if (v < atrPct) below++;
    }
    let hh = -Infinity;
    for (let k = i - 20; k < i; k++) hh = Math.max(hh, c[k].high);
    const regime = snap.sma200 === null || snap.sma50 === null ? 'SIDEWAYS' : snap.price > snap.sma200 && snap.sma50 > snap.sma200 ? 'BULL' : snap.price < snap.sma200 && snap.sma50 < snap.sma200 ? 'BEAR' : 'SIDEWAYS';
    return {
      time: c[i].openTime,
      close: c[i].close,
      score: sc.score,
      signal: sc.signal,
      regime,
      rsi: snap.rsi ?? 50,
      macdHist: snap.macdHistogram ?? 0,
      macdHistPrev: Number.isFinite(s.macd.histogram[i - 1]) ? s.macd.histogram[i - 1] : 0,
      roc: snap.roc ?? 0,
      volRatio: snap.volumeRatio ?? 1,
      atrPct,
      atrPctile: n ? (below / n) * 100 : 50,
      ema20Atr: (snap.price - snap.ema20) / snap.atr,
      emaUp: snap.ema20 > snap.ema50,
      ma20Atr: snap.sma20 !== null ? (snap.price - snap.sma20) / snap.atr : 0,
      bbPctB: snap.bbPercentB ?? 0.5,
      adx: snap.adx ?? 20,
      hh20Atr: (snap.price - hh) / snap.atr,
      ret4h: (c[i].close / c[i - 4].close - 1) * 100,
      ret24h: (c[i].close / c[i - 24].close - 1) * 100,
    };
  }

  btcAt(i: number): BtcContext | null {
    const f = this.at(i);
    if (!f) return null;
    const s = this.series;
    const c = this.candles;
    let sum = 0;
    const n = Math.min(720, i + 1);
    for (let k = i - n + 1; k <= i; k++) sum += c[k].close;
    return {
      regime: f.regime,
      emaUp: f.emaUp,
      aboveEma50: this.candles[i].close > s.ema50[i],
      rsi: f.rsi,
      ret1h: (this.candles[i].close / this.candles[i - 1].close - 1) * 100,
      ret4h: f.ret4h,
      ret24h: f.ret24h,
      atrPct: f.atrPct,
      ret7d: i >= 168 ? (c[i].close / c[i - 168].close - 1) * 100 : 0,
      ret30d: i >= 720 ? (c[i].close / c[i - 720].close - 1) * 100 : 0,
      aboveSma30d: c[i].close > sum / n,
    };
  }
}

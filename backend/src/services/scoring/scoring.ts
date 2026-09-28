import { DEFAULT_WEIGHTS, SIGNAL_BANDS, type ScoringWeights, type SignalType } from '../../config/scoring.js';
import type { TechnicalSnapshot } from '../technical/engine.js';
import { clamp, round } from '../../utils/math.js';

export interface ScoreComponent {
  key: keyof ScoringWeights;
  label: string;
  weight: number;
  /** 0..1 bullishness of this component. */
  value: number;
  points: number;
  available: boolean;
}

export interface ScoreFactor {
  type: 'positive' | 'negative' | 'neutral';
  text: string;
}

export interface ScoreResult {
  score: number;
  signal: SignalType;
  components: ScoreComponent[];
  factors: ScoreFactor[];
  /** Share of weight backed by available data (0..1). */
  dataCompleteness: number;
}

export function signalFromScore(score: number): SignalType {
  for (const b of SIGNAL_BANDS) if (score >= b.min) return b.signal;
  return 'STRONG_SELL';
}

function rsiValue(r: number): number {
  if (r < 30) return 0.3; // oversold: weak trend but bounce potential
  if (r < 40) return 0.15;
  if (r < 50) return 0.4;
  if (r < 60) return 0.8;
  if (r < 70) return 1;
  if (r < 80) return 0.55;
  return 0.3; // extremely overbought
}

/**
 * Weighted technical checklist, 0..100. NOT a probability of profit.
 * Missing components (warm-up) are scored neutral (0.5) and reduce dataCompleteness.
 */
export function scoreSnapshot(s: TechnicalSnapshot, prev: TechnicalSnapshot | null, weights: ScoringWeights = DEFAULT_WEIGHTS): ScoreResult {
  const factors: ScoreFactor[] = [];
  const comps: ScoreComponent[] = [];
  const add = (key: keyof ScoringWeights, label: string, value: number | null) => {
    const available = value !== null;
    const v = available ? clamp(value, 0, 1) : 0.5;
    comps.push({ key, label, weight: weights[key], value: round(v, 3), points: round(v * weights[key], 2), available });
  };

  // RSI
  if (s.rsi !== null) {
    add('rsi', 'RSI', rsiValue(s.rsi));
    if (s.rsi >= 50 && s.rsi < 70) factors.push({ type: 'positive', text: `RSI ${round(s.rsi, 1)} in bullish momentum zone (50–70)` });
    else if (s.rsi >= 70) factors.push({ type: 'negative', text: `RSI ${round(s.rsi, 1)} overbought (≥70)` });
    else if (s.rsi < 30) factors.push({ type: 'neutral', text: `RSI ${round(s.rsi, 1)} oversold (<30)` });
    else factors.push({ type: 'negative', text: `RSI ${round(s.rsi, 1)} below 50 (weak momentum)` });
  } else add('rsi', 'RSI', null);

  // MACD
  if (s.macdHistogram !== null) {
    const rising = prev?.macdHistogram != null && s.macdHistogram > prev.macdHistogram;
    const v = { bullish_cross: 1, bearish_cross: 0, bullish: rising ? 0.85 : 0.65, bearish: rising ? 0.35 : 0.1, unknown: 0.5 }[s.macdState];
    add('macd', 'MACD', v);
    if (s.macdState === 'bullish_cross') factors.push({ type: 'positive', text: 'MACD bullish crossover' });
    else if (s.macdState === 'bearish_cross') factors.push({ type: 'negative', text: 'MACD bearish crossover' });
    else if (s.macdState === 'bullish') factors.push({ type: 'positive', text: 'MACD above signal line' });
    else factors.push({ type: 'negative', text: 'MACD below signal line' });
  } else add('macd', 'MACD', null);

  // MA20 vs MA50
  if (s.sma20 !== null && s.sma50 !== null) {
    const up = s.sma20 > s.sma50;
    const above = s.price > s.sma20;
    add('maFastSlow', 'MA20 vs MA50', up ? (above ? 1 : 0.6) : above ? 0.4 : 0);
    factors.push(above ? { type: 'positive', text: 'Price above MA20' } : { type: 'negative', text: 'Price below MA20' });
    factors.push(up ? { type: 'positive', text: 'MA20 above MA50' } : { type: 'negative', text: 'MA20 below MA50' });
  } else add('maFastSlow', 'MA20 vs MA50', null);

  // MA50 vs MA200
  if (s.sma50 !== null && s.sma200 !== null) {
    const up = s.sma50 > s.sma200;
    const above = s.price > s.sma50;
    add('maSlowLong', 'MA50 vs MA200', up ? (above ? 1 : 0.6) : above ? 0.35 : 0);
    factors.push(above ? { type: 'positive', text: 'Price above MA50' } : { type: 'negative', text: 'Price below MA50' });
    factors.push(up ? { type: 'positive', text: 'MA50 above MA200 (long-term uptrend)' } : { type: 'negative', text: 'MA50 below MA200 (long-term downtrend)' });
  } else add('maSlowLong', 'MA50 vs MA200', null);

  // Volume (direction-aware)
  if (s.volumeRatio !== null && prev) {
    const upBar = s.price >= prev.price;
    const r = s.volumeRatio;
    let v: number;
    if (upBar) v = r >= 1.2 ? 1 : r >= 1 ? 0.75 : 0.55;
    else v = r >= 1.2 ? 0 : r >= 1 ? 0.25 : 0.45;
    if (s.obvSlope !== null) v = clamp(v + (s.obvSlope > 0 ? 0.1 : -0.1), 0, 1);
    add('volume', 'Volume', v);
    if (r >= 1) factors.push({ type: upBar ? 'positive' : 'negative', text: `Volume ${round(r, 2)}x average on ${upBar ? 'up' : 'down'} candle` });
    else factors.push({ type: 'neutral', text: `Volume below average (${round(r, 2)}x)` });
  } else add('volume', 'Volume', null);

  // Bollinger
  if (s.bbPercentB !== null) {
    const b = s.bbPercentB;
    const v = b > 1.05 ? 0.35 : b > 0.9 ? 0.6 : b >= 0.5 ? 1 : b >= 0.2 ? 0.4 : 0.2;
    add('bollinger', 'Bollinger %B', v);
    if (b > 1) factors.push({ type: 'negative', text: 'Price above upper Bollinger Band (stretched)' });
    else if (b < 0) factors.push({ type: 'neutral', text: 'Price below lower Bollinger Band' });
  } else add('bollinger', 'Bollinger %B', null);

  // Momentum: ROC + StochRSI
  if (s.roc !== null) {
    let v = clamp(0.5 + s.roc / 10, 0, 1);
    if (s.stochRsiK !== null && s.stochRsiD !== null) v = (v + (s.stochRsiK > s.stochRsiD ? 0.8 : 0.2)) / 2;
    add('momentum', 'Momentum (ROC/StochRSI)', v);
    factors.push({ type: s.roc > 0 ? 'positive' : 'negative', text: `ROC(10) ${s.roc > 0 ? '+' : ''}${round(s.roc, 2)}%` });
  } else add('momentum', 'Momentum (ROC/StochRSI)', null);

  // Price action
  const pa = s.priceAction;
  if (pa.structure !== 'UNKNOWN' || pa.breakout || pa.breakdown) {
    let v = { HH_HL: 1, LH_HL: 0.55, HH_LL: 0.45, LH_LL: 0, UNKNOWN: 0.5 }[pa.structure];
    if (pa.breakout) v = clamp(v + 0.25, 0, 1);
    if (pa.breakdown) v = 0;
    add('priceAction', 'Price Action', v);
    if (pa.structure === 'HH_HL') factors.push({ type: 'positive', text: 'Higher highs & higher lows' });
    if (pa.structure === 'LH_LL') factors.push({ type: 'negative', text: 'Lower highs & lower lows' });
    if (pa.breakout) factors.push({ type: 'positive', text: 'Breakout above 20-candle range' });
    if (pa.breakdown) factors.push({ type: 'negative', text: 'Breakdown below 20-candle range' });
  } else add('priceAction', 'Price Action', null);

  if (pa.resistance !== null && s.atr !== null && pa.resistance - s.price < s.atr) {
    factors.push({ type: 'negative', text: 'Price approaching resistance (within 1 ATR)' });
  }
  if (s.adx !== null) {
    factors.push({ type: 'neutral', text: s.adx >= 25 ? `ADX ${round(s.adx, 1)}: trending market` : `ADX ${round(s.adx, 1)}: weak / ranging trend` });
  }

  const score = round(comps.reduce((a, c) => a + c.points, 0), 1);
  const totalW = comps.reduce((a, c) => a + c.weight, 0);
  const availW = comps.filter((c) => c.available).reduce((a, c) => a + c.weight, 0);
  return { score, signal: signalFromScore(score), components: comps, factors, dataCompleteness: totalW ? availW / totalW : 0 };
}

import type { Candle } from '../../types/market.js';

/**
 * A swing pivot at index `index` needs `lookback` candles on BOTH sides to be confirmed,
 * therefore it only becomes known at `confirmedAt = index + lookback`. Any consumer
 * evaluating candle T must only use pivots with confirmedAt <= T (no look-ahead).
 */
export interface Pivot {
  index: number;
  confirmedAt: number;
  price: number;
  type: 'high' | 'low';
  time: number;
}

export function detectPivots(candles: Candle[], lookback = 3): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, confirmedAt: i + lookback, price: c.high, type: 'high', time: c.openTime });
    if (isLow) pivots.push({ index: i, confirmedAt: i + lookback, price: c.low, type: 'low', time: c.openTime });
  }
  return pivots;
}

export type Structure = 'HH_HL' | 'LH_LL' | 'HH_LL' | 'LH_HL' | 'UNKNOWN';

export interface PriceActionState {
  higherHigh: boolean;
  higherLow: boolean;
  lowerHigh: boolean;
  lowerLow: boolean;
  structure: Structure;
  breakout: boolean;
  breakdown: boolean;
  support: number | null;
  resistance: number | null;
  supportLevels: number[];
  resistanceLevels: number[];
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
}

/** Cluster nearby price levels (within tolerance fraction) and return cluster averages sorted by touch count. */
export function clusterLevels(prices: number[], tolerance = 0.006): { level: number; touches: number }[] {
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: { sum: number; n: number; last: number }[] = [];
  for (const p of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && (p - c.last) / c.last <= tolerance) {
      c.sum += p;
      c.n++;
      c.last = p;
    } else clusters.push({ sum: p, n: 1, last: p });
  }
  return clusters.map((c) => ({ level: c.sum / c.n, touches: c.n }));
}

/**
 * Price-action state at candle index `t`, using only candles[0..t] and pivots confirmed by t.
 */
export function priceActionAt(
  candles: Candle[],
  pivots: Pivot[],
  t: number,
  opts: { srLookback?: number; breakoutLookback?: number } = {},
): PriceActionState {
  const srLookback = opts.srLookback ?? 120;
  const breakoutLookback = opts.breakoutLookback ?? 20;
  // Pivots are ordered by index (and therefore by confirmedAt): binary-search the confirmed prefix.
  let lo = 0;
  let hi = pivots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pivots[mid].confirmedAt <= t) lo = mid + 1;
    else hi = mid;
  }
  const known: Pivot[] = [];
  for (let k = lo - 1; k >= 0 && pivots[k].index >= t - srLookback; k--) known.unshift(pivots[k]);
  const highs = known.filter((p) => p.type === 'high');
  const lows = known.filter((p) => p.type === 'low');
  const price = candles[t].close;

  const h1 = highs[highs.length - 1];
  const h0 = highs[highs.length - 2];
  const l1 = lows[lows.length - 1];
  const l0 = lows[lows.length - 2];
  const higherHigh = Boolean(h1 && h0 && h1.price > h0.price);
  const lowerHigh = Boolean(h1 && h0 && h1.price < h0.price);
  const higherLow = Boolean(l1 && l0 && l1.price > l0.price);
  const lowerLow = Boolean(l1 && l0 && l1.price < l0.price);
  let structure: Structure = 'UNKNOWN';
  if (higherHigh && higherLow) structure = 'HH_HL';
  else if (lowerHigh && lowerLow) structure = 'LH_LL';
  else if (higherHigh && lowerLow) structure = 'HH_LL';
  else if (lowerHigh && higherLow) structure = 'LH_HL';

  // Breakout: close above the highest high of the previous N candles (excluding t).
  let prevHigh = -Infinity;
  let prevLow = Infinity;
  for (let j = Math.max(0, t - breakoutLookback); j < t; j++) {
    prevHigh = Math.max(prevHigh, candles[j].high);
    prevLow = Math.min(prevLow, candles[j].low);
  }
  const breakout = t > 0 && price > prevHigh;
  const breakdown = t > 0 && price < prevLow;

  const levels = clusterLevels(known.map((p) => p.price));
  const resistanceLevels = levels.filter((l) => l.level > price).map((l) => l.level).sort((a, b) => a - b);
  const supportLevels = levels.filter((l) => l.level < price).map((l) => l.level).sort((a, b) => b - a);

  // Fallback to window extremes when no confirmed pivot exists on one side.
  const winStart = Math.max(0, t - srLookback);
  let winHigh = -Infinity;
  let winLow = Infinity;
  for (let j = winStart; j <= t; j++) {
    winHigh = Math.max(winHigh, candles[j].high);
    winLow = Math.min(winLow, candles[j].low);
  }

  return {
    higherHigh,
    higherLow,
    lowerHigh,
    lowerLow,
    structure,
    breakout,
    breakdown,
    support: supportLevels[0] ?? (winLow < price ? winLow : null),
    resistance: resistanceLevels[0] ?? (winHigh > price ? winHigh : null),
    supportLevels: supportLevels.slice(0, 3),
    resistanceLevels: resistanceLevels.slice(0, 3),
    lastSwingHigh: h1?.price ?? null,
    lastSwingLow: l1?.price ?? null,
  };
}

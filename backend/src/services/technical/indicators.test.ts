import { describe, expect, it } from 'vitest';
import * as ind from './indicators.js';
import { computeSeries, snapshotAt } from './engine.js';
import { randomWalk } from '../../test-utils/candles.js';

describe('SMA / EMA', () => {
  it('computes SMA with NaN warm-up', () => {
    const r = ind.sma([1, 2, 3, 4, 5], 3);
    expect(r.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(r.slice(2)).toEqual([2, 3, 4]);
  });
  it('seeds EMA with SMA and applies smoothing', () => {
    const r = ind.ema([1, 2, 3, 4, 5], 3);
    expect(r[2]).toBeCloseTo(2);
    expect(r[3]).toBeCloseTo(4 * 0.5 + 2 * 0.5);
    expect(r[4]).toBeCloseTo(5 * 0.5 + 3 * 0.5);
  });
});

describe('RSI', () => {
  // Reference data from Wilder / StockCharts RSI tutorial: first RSI(14) = 70.53
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
  it('matches the StockCharts reference values', () => {
    const r = ind.rsi(closes, 14);
    expect(Number.isNaN(r[13])).toBe(true);
    // StockCharts rounds intermediate averages to 2 decimals, so allow ±0.1
    expect(Math.abs(r[14] - 70.53)).toBeLessThan(0.1);
    expect(Math.abs(r[15] - 66.32)).toBeLessThan(0.1);
    expect(Math.abs(r[16] - 66.55)).toBeLessThan(0.1);
  });
  it('is 100 for strictly rising prices', () => {
    const r = ind.rsi(Array.from({ length: 30 }, (_, i) => 100 + i), 14);
    expect(r[29]).toBe(100);
  });
});

describe('MACD', () => {
  it('macd line equals EMA12 - EMA26 and histogram = macd - signal', () => {
    const c = randomWalk(120, 3).map((x) => x.close);
    const m = ind.macd(c);
    const e12 = ind.ema(c, 12);
    const e26 = ind.ema(c, 26);
    expect(m.macd[100]).toBeCloseTo(e12[100] - e26[100], 10);
    expect(m.histogram[100]).toBeCloseTo(m.macd[100] - m.signal[100], 10);
    expect(Number.isNaN(m.signal[30])).toBe(true);
    expect(Number.isFinite(m.signal[33])).toBe(true);
  });
});

describe('Bollinger Bands', () => {
  it('collapses to the mean for a constant series', () => {
    const b = ind.bollinger(new Array(25).fill(10), 20, 2);
    expect(b.upper[24]).toBe(10);
    expect(b.lower[24]).toBe(10);
    expect(b.percentB[24]).toBe(0.5);
  });
  it('uses population standard deviation', () => {
    const vals = [2, 4, 4, 4, 5, 5, 7, 9]; // population sd = 2, mean = 5
    const b = ind.bollinger(vals, 8, 2);
    expect(b.middle[7]).toBe(5);
    expect(b.upper[7]).toBeCloseTo(9);
    expect(b.lower[7]).toBeCloseTo(1);
  });
});

describe('ATR', () => {
  it('equals the constant true range', () => {
    const h = new Array(30).fill(12);
    const l = new Array(30).fill(10);
    const c = new Array(30).fill(11);
    const a = ind.atr(h, l, c, 14);
    expect(a[29]).toBeCloseTo(2);
    expect(Number.isNaN(a[12])).toBe(true);
  });
});

describe('Causality (no look-ahead in indicators)', () => {
  it('value at index i is identical whether or not future candles exist', () => {
    const candles = randomWalk(400, 7);
    const full = computeSeries(candles, '1d');
    for (const cut of [210, 260, 333, 399]) {
      const prefix = computeSeries(candles.slice(0, cut + 1), '1d');
      const a = snapshotAt(candles, full, cut);
      const b = snapshotAt(candles.slice(0, cut + 1), prefix, cut);
      expect(b).toEqual(a);
    }
  });
});

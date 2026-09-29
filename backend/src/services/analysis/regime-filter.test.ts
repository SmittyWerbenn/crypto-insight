import { describe, expect, it } from 'vitest';
import { analyzeCandles } from './technical-analysis.js';
import type { Candle } from '../../types/market.js';

/** Build a candle series from closes (open = previous close). */
function series(closes: number[]): Candle[] {
  return closes.map((c, i) => {
    const open = i === 0 ? c : closes[i - 1];
    return {
      openTime: Date.UTC(2024, 0, 1) + i * 86_400_000,
      closeTime: Date.UTC(2024, 0, 1) + (i + 1) * 86_400_000 - 1,
      open,
      high: Math.max(open, c) * 1.002,
      low: Math.min(open, c) * 0.998,
      close: c,
      volume: 1000,
    };
  });
}

/** Long uptrend followed by a pullback → short-term bearish, long-term still BULL. */
function bullWithPullback(downPct: number, downLen: number): Candle[] {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < 320; i++) p *= 1.005, closes.push(p);
  for (let i = 0; i < downLen; i++) p *= 1 - downPct, closes.push(p);
  return series(closes);
}

/** Long downtrend followed by a bounce → short-term bullish, long-term still BEAR. */
function bearWithBounce(bouncePct: number, bounceLen: number): Candle[] {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < 320; i++) p *= 0.995, closes.push(p);
  for (let i = 0; i < bounceLen; i++) p *= 1 + bouncePct, closes.push(p);
  return series(closes);
}

function drift(n: number, r: number): Candle[] {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) p *= r, closes.push(p);
  return series(closes);
}

describe('regime filter (counter-trend suppression)', () => {
  it('downgrades SELL/STRONG_SELL to HOLD in a BULL regime, with no trade levels', () => {
    const a = analyzeCandles('TESTUSDT', '1d', bullWithPullback(0.015, 20));
    expect(a.regime).toBe('BULL');
    expect(a.signal).toBe('HOLD');
    expect(a.suppressedSignal).not.toBeNull();
    expect(a.suppressedSignal!.original).toMatch(/SELL/);
    expect(a.levels).toBeNull();
    expect(a.score.factors.some((f) => f.text.includes('ditekan menjadi TAHAN'))).toBe(true);
  });

  it('downgrades BUY/STRONG_BUY to HOLD in a BEAR regime, with no trade levels', () => {
    const a = analyzeCandles('TESTUSDT', '1d', bearWithBounce(0.02, 15));
    expect(a.regime).toBe('BEAR');
    expect(a.signal).toBe('HOLD');
    expect(a.suppressedSignal!.original).toMatch(/BUY/);
    expect(a.levels).toBeNull();
  });

  it('keeps BUY signals in a BULL regime (trend-following)', () => {
    const a = analyzeCandles('TESTUSDT', '1d', drift(340, 1.005));
    expect(a.regime).toBe('BULL');
    expect(a.signal).toBe('BUY');
    expect(a.suppressedSignal).toBeNull();
    expect(a.levels).not.toBeNull();
  });

  it('keeps SELL signals in a BEAR regime (trend-following)', () => {
    const a = analyzeCandles('TESTUSDT', '1d', drift(340, 0.995));
    expect(a.regime).toBe('BEAR');
    expect(['SELL', 'STRONG_SELL']).toContain(a.signal);
    expect(a.suppressedSignal).toBeNull();
    expect(a.levels).not.toBeNull();
    expect(a.levels!.direction).toBe('SHORT_OR_REDUCE');
  });
});

/**
 * CRITICAL: look-ahead bias protection.
 * A decision at candle T may only use candles[0..T]. These tests prove it at three levels:
 *   1. the StrategyContext refuses to hand out future data,
 *   2. decisions up to T are identical whatever happens after T,
 *   3. fills happen strictly after the decision candle.
 */
import { describe, expect, it } from 'vitest';
import { makeCandle, randomWalk } from '../../test-utils/candles.js';
import { LookAheadError, runBacktest } from './engine.js';
import { registerStrategy } from './strategies/index.js';
import type { BacktestConfig, StrategyContext } from './types.js';
import { computeSeries } from '../technical/engine.js';
import { findSimilarSetups } from '../historical/similarity.js';

const cfg = (strategy: string): BacktestConfig => ({ symbol: 'T', timeframe: '1d', strategy, initialCapital: 1000, positionSize: 1, fee: 0, slippage: 0 });

describe('NO LOOK-AHEAD BIAS', () => {
  it('Day1=100, Day2=110, Day3=90: the Day-1 decision only knows Day 1', () => {
    const candles = [makeCandle(0, 100, 100, 100, 100), makeCandle(1, 100, 110, 100, 110), makeCandle(2, 110, 110, 90, 90)];
    const seen: { index: number; close: number; maxVisibleClose: number }[] = [];
    registerStrategy({
      id: 'la-observer',
      name: 'observer',
      description: '',
      defaultParams: {},
      evaluate: (c, ctx: StrategyContext) => {
        // Collect every candle the strategy is able to read from its context
        const visible: number[] = [];
        for (let off = 0; off <= ctx.index; off++) visible.push(ctx.candle(off).close);
        seen.push({ index: ctx.index, close: c.close, maxVisibleClose: Math.max(...visible) });
        return { action: 'NONE' };
      },
    });
    runBacktest(cfg('la-observer'), { candles });
    const day1 = seen.find((s) => s.index === 0)!;
    expect(day1.close).toBe(100);
    expect(day1.maxVisibleClose).toBe(100); // never sees 110 (Day 2) or 90 (Day 3)
    const day2 = seen.find((s) => s.index === 1)!;
    expect(day2.maxVisibleClose).toBe(110);
  });

  it('a strategy that tries to read the future throws LookAheadError', () => {
    registerStrategy({
      id: 'la-cheater',
      name: 'cheater',
      description: '',
      defaultParams: {},
      evaluate: (_c, ctx) => {
        ctx.candle(-1); // tomorrow
        return { action: 'NONE' };
      },
    });
    expect(() => runBacktest(cfg('la-cheater'), { candles: randomWalk(10) })).toThrow(LookAheadError);
    registerStrategy({ id: 'la-cheater2', name: 'c', description: '', defaultParams: {}, evaluate: (_c, ctx) => (ctx.snapshot(-2), { action: 'NONE' }) });
    expect(() => runBacktest(cfg('la-cheater2'), { candles: randomWalk(10) })).toThrow(LookAheadError);
  });

  it('decisions up to T are unchanged when all data after T is replaced', () => {
    const candles = randomWalk(600, 99, 0.001, 0.02);
    const T = 450;
    const altered = candles.map((c, i) => (i <= T ? c : { ...c, open: c.open * 3, high: c.high * 3.2, low: c.low * 2.8, close: c.close * 3, volume: c.volume * 10 }));
    for (const id of ['ma-rsi-macd', 'trend-following', 'momentum']) {
      const a = runBacktest({ ...cfg(id), tradeTo: candles[T].openTime }, { candles });
      const b = runBacktest({ ...cfg(id), tradeTo: candles[T].openTime }, { candles: altered });
      expect(b.trades).toEqual(a.trades);
      expect(b.equity).toEqual(a.equity);
      expect(b.signalDistribution).toEqual(a.signalDistribution);
    }
  });

  it('full-history indicator series equals the series computed with only past data at every T', () => {
    const candles = randomWalk(320, 5);
    const full = computeSeries(candles, '1d');
    for (let T = 200; T < 320; T += 17) {
      const past = computeSeries(candles.slice(0, T + 1), '1d');
      expect(past.rsi[T]).toBe(full.rsi[T]);
      expect(past.macd.histogram[T]).toBe(full.macd.histogram[T]);
      expect(past.sma200[T]).toBe(full.sma200[T]);
      expect(past.atr[T]).toBe(full.atr[T]);
      expect(past.bb.upper[T]).toBe(full.bb.upper[T]);
      // Pivots known by T must be the same; pivots near T are not confirmed yet
      expect(past.pivots.filter((p) => p.confirmedAt <= T)).toEqual(full.pivots.filter((p) => p.confirmedAt <= T));
    }
  });

  it('entries are always filled on a candle strictly after the signal candle', () => {
    const candles = randomWalk(500, 42, 0.002, 0.02);
    const signals: number[] = [];
    registerStrategy({
      id: 'la-every-10',
      name: '',
      description: '',
      defaultParams: {},
      evaluate: (_c, ctx) => {
        if (!ctx.inPosition && ctx.index % 10 === 0) {
          signals.push(ctx.index);
          return { action: 'ENTER_LONG', reason: '' };
        }
        if (ctx.inPosition && ctx.index % 10 === 5) return { action: 'EXIT', reason: '' };
        return { action: 'NONE' };
      },
    });
    const r = runBacktest(cfg('la-every-10'), { candles });
    for (const t of r.trades) {
      const entryIdx = candles.findIndex((c) => c.openTime === t.entryTime);
      expect(signals).toContain(entryIdx - 1);
      expect(t.entrySignalPrice).toBe(candles[entryIdx].open);
    }
  });

  it('historical similarity at T ignores setups whose outcome is not yet known at T', () => {
    const candles = randomWalk(500, 8);
    const s = computeSeries(candles, '1d');
    const T = 400;
    const a = findSimilarSetups(candles, s, T, '1d');
    const altered = candles.map((c, i) => (i <= T ? c : { ...c, close: c.close * 5 }));
    const b = findSimilarSetups(altered, computeSeries(altered, '1d'), T, '1d');
    expect(b).toEqual(a);
  });
});

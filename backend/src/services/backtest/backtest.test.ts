import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market.js';
import { makeCandle, randomWalk } from '../../test-utils/candles.js';
import { runBacktest } from './engine.js';
import { registerStrategy } from './strategies/index.js';
import type { BacktestConfig, Strategy, StrategyContext } from './types.js';
import { checkDataQuality } from './data-quality.js';
import { expandGrid, monteCarlo, runOutOfSample, runWalkForward } from './advanced.js';

/** Enters at the close of candle `enterAt`, exits at the close of `exitAt` (if given). */
function scripted(id: string, enterAt: number, exitAt?: number): Strategy {
  return {
    id,
    name: id,
    description: 'test',
    defaultParams: {},
    evaluate: (_c, ctx: StrategyContext) => {
      if (!ctx.inPosition && ctx.index === enterAt) return { action: 'ENTER_LONG', reason: 'scripted' };
      if (ctx.inPosition && ctx.index === exitAt) return { action: 'EXIT', reason: 'scripted exit' };
      return { action: 'NONE' };
    },
  };
}

const base: Omit<BacktestConfig, 'strategy'> = {
  symbol: 'TEST',
  timeframe: '1d',
  initialCapital: 10_000,
  positionSize: 1,
  fee: 0,
  slippage: 0,
};

const flat = (n: number, p = 100): Candle[] => Array.from({ length: n }, (_, i) => makeCandle(i, p, p + 1, p - 1, p));

describe('entry / exit execution', () => {
  it('fills the entry at the NEXT candle open and the exit at the following open', () => {
    registerStrategy(scripted('t-entry', 1, 3));
    const c = flat(6);
    c[2] = makeCandle(2, 101, 103, 100, 102);
    c[3] = makeCandle(3, 102, 106, 101, 105);
    c[4] = makeCandle(4, 107, 108, 106, 107);
    const r = runBacktest({ ...base, strategy: 't-entry' }, { candles: c });
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(t.entryTime).toBe(c[2].openTime);
    expect(t.entryPrice).toBe(101);
    expect(t.exitTime).toBe(c[4].openTime);
    expect(t.exitPrice).toBe(107);
    expect(t.exitReason).toBe('SIGNAL');
    expect(r.metrics.finalCapital).toBeCloseTo(10_000 * (107 / 101), 1);
    expect(r.metrics.roi).toBeCloseTo((107 / 101 - 1) * 100, 2);
  });

  it('applies trading fee and slippage on both sides', () => {
    registerStrategy(scripted('t-costs', 0, 2));
    const c = [makeCandle(0, 100, 101, 99, 100), makeCandle(1, 100, 111, 99, 110), makeCandle(2, 110, 111, 109, 110), makeCandle(3, 110, 111, 109, 110)];
    const fee = 0.001;
    const slip = 0.0005;
    const r = runBacktest({ ...base, strategy: 't-costs', fee, slippage: slip }, { candles: c });
    const t = r.trades[0];
    const entryFill = 100 * (1 + slip);
    const notional = 10_000 / (1 + fee); // position size capped so notional + fee <= cash
    const qty = notional / entryFill;
    const exitFill = 110 * (1 - slip);
    const proceeds = qty * exitFill;
    const expectedNet = proceeds - proceeds * fee - (notional + notional * fee);
    expect(t.entryPrice).toBeCloseTo(entryFill, 10);
    expect(t.exitPrice).toBeCloseTo(exitFill, 10);
    expect(t.fees).toBeCloseTo(notional * fee + proceeds * fee, 8);
    expect(t.slippageCost).toBeCloseTo(qty * 100 * slip + qty * 110 * slip, 8);
    expect(t.netPnl).toBeCloseTo(expectedNet, 8);
    expect(t.netPnl).toBeCloseTo(t.grossPnl - t.fees - t.slippageCost, 8);
    // Costs must make the result strictly worse than the frictionless run
    registerStrategy(scripted('t-costs2', 0, 2));
    const free = runBacktest({ ...base, strategy: 't-costs2' }, { candles: c });
    expect(r.metrics.finalCapital).toBeLessThan(free.metrics.finalCapital);
  });

  it('respects position size', () => {
    registerStrategy(scripted('t-size', 0, 1));
    const c = [makeCandle(0, 100, 100, 100, 100), makeCandle(1, 100, 120, 100, 120), makeCandle(2, 120, 120, 120, 120), makeCandle(3, 120, 120, 120, 120)];
    const r = runBacktest({ ...base, strategy: 't-size', positionSize: 0.1 }, { candles: c });
    expect(r.trades[0].quantity).toBeCloseTo(10, 8); // $1,000 / $100
    expect(r.metrics.finalCapital).toBeCloseTo(10_000 + 10 * 20, 6);
  });
});

describe('stop loss / take profit', () => {
  it('exits at the stop price when the low breaches it', () => {
    registerStrategy(scripted('t-sl', 0));
    const c = [makeCandle(0, 100, 101, 99, 100), makeCandle(1, 100, 101, 99, 100), makeCandle(2, 100, 100.5, 90, 92), makeCandle(3, 92, 93, 91, 92)];
    const r = runBacktest({ ...base, strategy: 't-sl', stopLoss: 0.05 }, { candles: c });
    expect(r.trades[0].exitReason).toBe('STOP_LOSS');
    expect(r.trades[0].exitPrice).toBeCloseTo(95, 8);
    expect(r.metrics.roi).toBeCloseTo(-5, 6);
  });
  it('exits at the target price when the high reaches it', () => {
    registerStrategy(scripted('t-tp', 0));
    const c = [makeCandle(0, 100, 101, 99, 100), makeCandle(1, 100, 101, 99, 100), makeCandle(2, 100, 115, 99.5, 112), makeCandle(3, 112, 113, 111, 112)];
    const r = runBacktest({ ...base, strategy: 't-tp', takeProfit: 0.1 }, { candles: c });
    expect(r.trades[0].exitReason).toBe('TAKE_PROFIT');
    expect(r.trades[0].exitPrice).toBeCloseTo(110, 8);
    expect(r.trades[0].mfePct).toBeCloseTo(10, 6);
  });
  it('fills a gap-down at the open (worse than the stop)', () => {
    registerStrategy(scripted('t-gap', 0));
    const c = [makeCandle(0, 100, 101, 99, 100), makeCandle(1, 100, 101, 99, 100), makeCandle(2, 90, 91, 88, 89), makeCandle(3, 89, 90, 88, 89)];
    const r = runBacktest({ ...base, strategy: 't-gap', stopLoss: 0.05 }, { candles: c });
    expect(r.trades[0].exitPrice).toBe(90);
  });
  it('marks stop+target in the same candle as ambiguous and assumes the stop', () => {
    registerStrategy(scripted('t-amb', 0));
    const c = [makeCandle(0, 100, 101, 99, 100), makeCandle(1, 100, 101, 99, 100), makeCandle(2, 100, 120, 80, 100), makeCandle(3, 100, 101, 99, 100)];
    const r = runBacktest({ ...base, strategy: 't-amb', stopLoss: 0.05, takeProfit: 0.1 }, { candles: c });
    expect(r.trades[0].ambiguous).toBe(true);
    expect(r.trades[0].exitReason).toBe('STOP_LOSS');
    expect(r.metrics.ambiguousTrades).toBe(1);
    const resolved = runBacktest({ ...base, strategy: 't-amb', stopLoss: 0.05, takeProfit: 0.1 }, { candles: c, resolveIntrabar: () => 'TARGET' });
    expect(resolved.trades[0].exitReason).toBe('TAKE_PROFIT');
    expect(resolved.trades[0].ambiguous).toBe(false);
  });
  it('tracks MAE during the trade', () => {
    registerStrategy(scripted('t-mae', 0, 3));
    const c = [makeCandle(0, 100, 100, 100, 100), makeCandle(1, 100, 101, 97, 99), makeCandle(2, 99, 104, 98, 103), makeCandle(3, 103, 105, 102, 104), makeCandle(4, 104, 104, 104, 104)];
    const r = runBacktest({ ...base, strategy: 't-mae' }, { candles: c });
    expect(r.trades[0].maePct).toBeCloseTo(-3, 6);
    expect(r.trades[0].mfePct).toBeCloseTo(5, 6);
  });
});

describe('equity, drawdown, ROI', () => {
  it('computes max drawdown from the mark-to-market equity curve', () => {
    registerStrategy(scripted('t-dd', 0));
    const closes = [100, 100, 120, 90, 110];
    const c = closes.map((p, i) => makeCandle(i, i === 0 ? p : closes[i - 1], Math.max(p, i === 0 ? p : closes[i - 1]), Math.min(p, i === 0 ? p : closes[i - 1]), p));
    const r = runBacktest({ ...base, strategy: 't-dd' }, { candles: c });
    // entry at open of candle 1 = 100; peak equity at 120 → trough at 90 = -25%
    expect(r.metrics.maxDrawdown).toBeCloseTo(-25, 6);
    expect(Math.min(...r.equity.map((e) => e.drawdownPct))).toBeCloseTo(-25, 6);
    expect(r.metrics.roi).toBeCloseTo(10, 6);
    expect(r.trades[0].exitReason).toBe('END_OF_DATA');
  });
});

describe('real strategies run end-to-end', () => {
  it.each(['ma-rsi-macd', 'trend-following', 'momentum'])('%s produces consistent metrics', (id) => {
    const c = randomWalk(700, 21, 0.001, 0.025);
    const r = runBacktest({ ...base, strategy: id, positionSize: 0.5, fee: 0.001, slippage: 0.0005, stopLoss: 0.05, takeProfit: 0.1 }, { candles: c });
    const sumNet = r.trades.reduce((a, t) => a + t.netPnl, 0);
    expect(r.metrics.finalCapital).toBeCloseTo(10_000 + sumNet, 1);
    expect(r.metrics.winningTrades + r.metrics.losingTrades).toBe(r.metrics.totalTrades);
    for (const t of r.trades) {
      expect(t.exitTime).toBeGreaterThan(t.entryTime);
      expect(t.fees).toBeGreaterThan(0);
    }
  });
});

describe('data quality', () => {
  it('detects duplicates, invalid OHLC and gaps', () => {
    const c = [makeCandle(0, 1, 2, 0.5, 1.5), makeCandle(0, 1, 2, 0.5, 1.5), makeCandle(1, 1, 0.5, 2, 1), makeCandle(4, 1, 2, 0.5, 1.5)];
    const { candles, report } = checkDataQuality(c, '1d');
    expect(report.duplicateCandles).toBe(1);
    expect(report.invalidCandles).toBe(1);
    expect(report.missingCandles).toBe(3);
    expect(candles).toHaveLength(2);
    expect(report.severe).toBe(true);
  });
});

describe('advanced', () => {
  it('limits grid search combinations', () => {
    expect(expandGrid({ a: { min: 1, max: 3, step: 1 }, b: { min: 0, max: 1, step: 0.5 } }, 100)).toHaveLength(9);
    expect(() => expandGrid({ a: { min: 1, max: 100, step: 1 }, b: { min: 1, max: 100, step: 1 } }, 100)).toThrow(/combinations/);
  });
  it('out-of-sample chooses params from the in-sample window only', () => {
    const c = randomWalk(800, 9, 0.001, 0.02);
    const r = runOutOfSample({ ...base, strategy: 'ma-rsi-macd', positionSize: 0.5, fee: 0.001, slippage: 0.0005 }, { candles: c }, {
      splitRatio: 0.7,
      ranges: { rsiMin: { min: 45, max: 55, step: 5 } },
      minTrades: 1,
    });
    expect(r.inSample.endTime).toBeLessThan(r.splitTime);
    expect(r.outOfSample.startTime).toBe(r.splitTime);
    expect(r.optimization?.tested).toBe(3);
    expect(r.inSample.params).toEqual(r.outOfSample.params);
  });
  it('walk-forward windows never overlap train and test', () => {
    const c = randomWalk(500, 13, 0.001, 0.02);
    const r = runWalkForward({ ...base, strategy: 'momentum', positionSize: 0.5, fee: 0.001, slippage: 0 }, { candles: c }, { trainDays: 90, testDays: 30 });
    expect(r.windows.length).toBeGreaterThan(5);
    for (const w of r.windows) {
      expect(w.trainTo).toBeLessThan(w.testFrom);
    }
    for (let i = 1; i < r.windows.length; i++) expect(r.windows[i].testFrom).toBe(r.windows[i - 1].testTo + 1);
  });
  it('monte carlo is deterministic and bounded', () => {
    const c = randomWalk(700, 21, 0.001, 0.025);
    const bt = runBacktest({ ...base, strategy: 'momentum', positionSize: 0.5, fee: 0.001, slippage: 0 }, { candles: c });
    const a = monteCarlo(bt.trades, 10_000, { iterations: 500 });
    const b = monteCarlo(bt.trades, 10_000, { iterations: 500 });
    expect(a).toEqual(b);
    expect(a!.worst5PctEndingCapital).toBeLessThanOrEqual(a!.medianEndingCapital);
    expect(a!.best5PctEndingCapital).toBeGreaterThanOrEqual(a!.medianEndingCapital);
  });
});

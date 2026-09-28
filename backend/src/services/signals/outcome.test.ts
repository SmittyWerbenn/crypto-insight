import { describe, expect, it } from 'vitest';
import { makeCandle } from '../../test-utils/candles.js';
import { evaluateOutcome, resolveWithLowerTimeframe, type TrackedSignal } from './outcome.js';

const long: TrackedSignal = { direction: 'LONG', entryPrice: 100, targetPrice: 110, stopPrice: 95, candleTime: makeCandle(0, 0, 0, 0, 0).openTime };

describe('signal outcome', () => {
  it('TARGET_HIT when target reached first', () => {
    const r = evaluateOutcome(long, [makeCandle(1, 100, 104, 98, 103), makeCandle(2, 103, 111, 102, 109)], 24);
    expect(r.status).toBe('TARGET_HIT');
    expect(r.returnPercent).toBeCloseTo(10);
    expect(r.mae).toBeCloseTo(-2);
  });
  it('STOP_HIT when stop reached first', () => {
    const r = evaluateOutcome(long, [makeCandle(1, 100, 104, 94, 96)], 24);
    expect(r.status).toBe('STOP_HIT');
    expect(r.returnPercent).toBeCloseTo(-5);
  });
  it('TIMEOUT after the evaluation window', () => {
    const cs = [1, 2, 3].map((i) => makeCandle(i, 100, 102, 99, 101));
    const r = evaluateOutcome(long, cs, 3);
    expect(r.status).toBe('TIMEOUT');
    expect(r.returnPercent).toBeCloseTo(1);
  });
  it('OPEN while running, PENDING before any candle', () => {
    expect(evaluateOutcome(long, [makeCandle(1, 100, 102, 99, 101)], 24).status).toBe('OPEN');
    expect(evaluateOutcome(long, [], 24).status).toBe('PENDING');
  });
  it('AMBIGUOUS when both levels in one candle without lower timeframe data', () => {
    const r = evaluateOutcome(long, [makeCandle(1, 100, 112, 90, 100)], 24);
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.returnPercent).toBeNull();
  });
  it('resolves ambiguity with lower timeframe candles', () => {
    const lower = [makeCandle(0, 100, 101, 94, 95), makeCandle(1, 95, 112, 95, 111)];
    expect(resolveWithLowerTimeframe(lower, 'LONG', 110, 95)).toBe('STOP');
    const r = evaluateOutcome(long, [makeCandle(1, 100, 112, 90, 100)], 24, () => resolveWithLowerTimeframe(lower, 'LONG', 110, 95));
    expect(r.status).toBe('STOP_HIT');
  });
  it('SELL signals win when price falls to the bearish target', () => {
    const short: TrackedSignal = { direction: 'SHORT_OR_REDUCE', entryPrice: 100, targetPrice: 90, stopPrice: 105, candleTime: long.candleTime };
    const r = evaluateOutcome(short, [makeCandle(1, 100, 101, 89, 90)], 24);
    expect(r.status).toBe('TARGET_HIT');
    expect(r.returnPercent).toBeCloseTo(10);
  });
  it('ignores the signal candle itself (no look-ahead into the past candle)', () => {
    const r = evaluateOutcome(long, [makeCandle(0, 100, 120, 80, 100), makeCandle(1, 100, 101, 99, 100)], 24);
    expect(r.status).toBe('OPEN');
  });
});

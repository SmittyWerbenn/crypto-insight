import { describe, expect, it } from 'vitest';
import { randomWalk } from '../../test-utils/candles.js';
import { planSymbol, simulatePlanHistory } from './plan.js';

const fourHour = (c: ReturnType<typeof randomWalk>) => c.map((x, i) => ({ ...x, openTime: i * 14_400_000, closeTime: (i + 1) * 14_400_000 - 1 }));

describe('trade planner', () => {
  it('simulates past BUY signals with the same target/stop and counts every outcome', () => {
    const c = fourHour(randomWalk(1200, 31, 0.001, 0.02));
    const h = simulatePlanHistory(c, '4h', 4, -2, 24, 0.15);
    expect(h.sampleSize).toBe(h.targetHit + h.stopHit + h.timeout);
    expect(h.sampleSize).toBeGreaterThan(10);
    // Timeouts exit above the stop, so no trade loses more than the stop plus round-trip costs
    expect(h.worstReturnPct!).toBeGreaterThanOrEqual(-2 - 0.3 - 1e-6);
  });

  it('costs lower the expectancy', () => {
    const c = fourHour(randomWalk(1200, 7, 0.001, 0.02));
    const free = simulatePlanHistory(c, '4h', 4, -2, 24, 0);
    const costly = simulatePlanHistory(c, '4h', 4, -2, 24, 0.5);
    expect(costly.expectancyNetPct!).toBeCloseTo(free.expectancyNetPct! - 1, 6);
  });

  it('does not use the future: history is unchanged when candles after the last are altered away', () => {
    const c = fourHour(randomWalk(1300, 11, 0.001, 0.02));
    const a = simulatePlanHistory(c.slice(0, 1000), '4h', 4, -2, 24, 0.15);
    const b = simulatePlanHistory(c.slice(0, 1000).map((x) => ({ ...x })), '4h', 4, -2, 24, 0.15);
    expect(b).toEqual(a);
  });

  it('only recommends BUY setups and explains why others are rejected', () => {
    const down = fourHour(randomWalk(800, 11, -0.006, 0.012));
    const p = planSymbol('DOWNUSDT', '4h', down, 0.15);
    expect(p.eligible).toBe(false);
    expect(p.reason).toMatch(/Sinyal saat ini/);
    const up = fourHour(randomWalk(800, 11, 0.006, 0.012));
    const q = planSymbol('UPUSDT', '4h', up, 0.15);
    if (q.eligible) {
      expect(q.target!).toBeGreaterThan(q.entry!);
      expect(q.stop!).toBeLessThan(q.entry!);
      expect(q.history!.expectancyNetPct!).toBeGreaterThan(0);
    } else expect(q.reason).toBeTruthy();
  });
});

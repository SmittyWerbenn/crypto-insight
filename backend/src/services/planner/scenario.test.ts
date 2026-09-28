import { describe, expect, it } from 'vitest';
import { nextRunAt } from './scenario.service.js';

const wib = (iso: string) => new Date(`${iso}+07:00`).getTime();

describe('scenario schedule', () => {
  it('runs every 6 hours on the WIB clock (00, 06, 12, 18)', () => {
    expect(nextRunAt(wib('2026-09-28T05:59:00'), 6)).toBe(wib('2026-09-28T06:00:00'));
    expect(nextRunAt(wib('2026-09-28T06:00:00'), 6)).toBe(wib('2026-09-28T12:00:00'));
    expect(nextRunAt(wib('2026-09-28T21:30:00'), 6)).toBe(wib('2026-09-29T00:00:00'));
  });
  it('supports other intervals that divide 24', () => {
    expect(nextRunAt(wib('2026-09-28T13:10:00'), 12)).toBe(wib('2026-09-29T00:00:00'));
  });
});

import { compareWithReal, planChecks } from './scenario-checks.js';

describe('estimated vs real checks', () => {
  const pick = (over: Record<string, unknown>) => ({ symbol: 'BTCUSDT', entry: 100, target: 110, stop: 95, scanPrice: 101, estimatedHoldMs: 9 * 3_600_000, maxHoldMs: 24 * 3_600_000, ...over });
  const run = (picks: Record<string, unknown>[]) => ({ id: 'r1', createdAt: '2026-09-28T00:00:00.000Z', styles: [{ tag: 'Harian', timeframe: '1h', picks }] }) as never;

  it('is due at scan time + estimated hold, compared from the scan price', () => {
    const [c] = planChecks(run([pick({})]));
    expect(c.basis).toBe('ESTIMATED_HOLD');
    expect(c.dueAt.toISOString()).toBe('2026-09-28T09:00:00.000Z');
    expect(c.entryPrice).toBe(101);
    expect(c.estimatedPrice).toBe(110);
    expect(c.estimatedReturnPct).toBeCloseTo(8.911, 3);
  });

  it('falls back to the sell-by limit when there is no hold estimate', () => {
    const [c] = planChecks(run([pick({ estimatedHoldMs: null, scanPrice: null })]));
    expect(c.basis).toBe('MAX_HOLD');
    expect(c.dueAt.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(c.entryPrice).toBe(100);
  });

  it('compares the real price with the estimate', () => {
    expect(compareWithReal(100, 110, 104.5)).toEqual({ realReturnPct: 4.5, diffPct: -5 });
    expect(compareWithReal(100, 110, 121)).toEqual({ realReturnPct: 21, diffPct: 10 });
  });
});

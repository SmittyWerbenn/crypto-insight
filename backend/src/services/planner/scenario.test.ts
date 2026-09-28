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

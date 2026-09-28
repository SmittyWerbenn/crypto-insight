import { describe, expect, it } from 'vitest';
import { fmtCompact, fmtPct, fmtPrice, fmtDuration } from './format';

describe('format', () => {
  it('formats prices by magnitude', () => {
    expect(fmtPrice(65321.4)).toBe('65,321.40');
    expect(fmtPrice(0.09762)).toBe('0.09762');
    expect(fmtPrice(null)).toBe('–');
  });
  it('formats percentages with sign', () => {
    expect(fmtPct(2.14)).toBe('+2.14%');
    expect(fmtPct(-1.5)).toBe('-1.50%');
  });
  it('formats compact values', () => {
    expect(fmtCompact(2.38e12)).toBe('$2.38T');
  });
  it('formats durations', () => {
    expect(fmtDuration(16 * 3_600_000)).toBe('16h');
  });
});

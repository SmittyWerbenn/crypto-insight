import { afterEach, describe, expect, it } from 'vitest';
import { fmtCompact, fmtPct, fmtPrice, fmtDuration, fmtPriceSym, fmtUsd, fmtNum, fromDisplay, setFxState } from './format';

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

describe('rupiah display', () => {
  afterEach(() => setFxState('USD', 1));
  it('converts USDT amounts to IDR with Indonesian formatting', () => {
    setFxState('IDR', 16_000);
    expect(fmtPrice(84_824.01)).toBe('1.357.184.160');
    expect(fmtPriceSym(84_824.01)).toBe('Rp 1.357.184.160');
    expect(fmtPrice(0.09762)).toBe('1.562');
    expect(fmtPrice(0.00001)).toBe('0,16');
    expect(fmtUsd(-12.5)).toBe('-Rp 200.000');
    expect(fmtCompact(2.89e12)).toBe('Rp 46.240 T');
    expect(fmtCompact(853.1e6)).toBe('Rp 13,65 T');
    expect(fromDisplay(160_000_000)).toBe(10_000);
  });
  it('leaves percentages and plain numbers unconverted', () => {
    setFxState('IDR', 16_000);
    expect(fmtPct(2.14)).toBe('+2.14%');
    expect(fmtNum(52.9, 1)).toBe('52,9');
  });
  it('ignores the rate in USD mode', () => {
    setFxState('USD', 16_000);
    expect(fmtPriceSym(100)).toBe('$100.00');
  });
});

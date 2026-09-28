import { describe, expect, it } from 'vitest';
import { computeSeries, snapshotAt } from '../technical/engine.js';
import { scoreSnapshot, signalFromScore } from './scoring.js';
import { computeLevels, computeScenarios } from './targets.js';
import { randomWalk } from '../../test-utils/candles.js';

function scoreOf(candles: ReturnType<typeof randomWalk>) {
  const s = computeSeries(candles, '1d');
  const t = candles.length - 1;
  return { snap: snapshotAt(candles, s, t), result: scoreSnapshot(snapshotAt(candles, s, t), snapshotAt(candles, s, t - 1)) };
}

describe('signal bands', () => {
  it('maps scores to configured signals', () => {
    expect(signalFromScore(85)).toBe('STRONG_BUY');
    expect(signalFromScore(65)).toBe('BUY');
    expect(signalFromScore(64.9)).toBe('HOLD');
    expect(signalFromScore(30)).toBe('SELL');
    expect(signalFromScore(10)).toBe('STRONG_SELL');
  });
});

describe('technical score', () => {
  it('bullish setup scores BUY or better', () => {
    const c = randomWalk(300, 11, 0.006, 0.012);
    const { result } = scoreOf(c);
    expect(result.score).toBeGreaterThanOrEqual(65);
    expect(['BUY', 'STRONG_BUY']).toContain(result.signal);
    expect(result.dataCompleteness).toBe(1);
  });
  it('bearish setup scores SELL or worse', () => {
    const c = randomWalk(300, 11, -0.006, 0.012);
    const { result } = scoreOf(c);
    expect(result.score).toBeLessThan(45);
    expect(['SELL', 'STRONG_SELL']).toContain(result.signal);
  });
  it('neutral setup stays between the extremes', () => {
    const c = randomWalk(300, 5, 0, 0.01);
    const { result } = scoreOf(c);
    expect(result.score).toBeGreaterThan(10);
    expect(result.score).toBeLessThan(90);
  });
  it('components sum to score and weights sum to 100', () => {
    const { result } = scoreOf(randomWalk(300, 2));
    const sum = result.components.reduce((a, c) => a + c.points, 0);
    expect(result.score).toBeCloseTo(sum, 0);
    expect(result.components.reduce((a, c) => a + c.weight, 0)).toBe(100);
  });
  it('flags incomplete data during warm-up', () => {
    const c = randomWalk(60, 2);
    const { result } = scoreOf(c);
    expect(result.dataCompleteness).toBeLessThan(1);
  });
});

describe('targets & scenarios', () => {
  it('long levels put stop below and target above price with R:R >= 1.5', () => {
    const { snap } = scoreOf(randomWalk(300, 11, 0.004, 0.015));
    const lv = computeLevels(snap, 'BUY')!;
    expect(lv.stop).toBeLessThan(snap.price);
    expect(lv.target).toBeGreaterThan(snap.price);
    expect(lv.upsidePct!).toBeCloseTo(((lv.target - snap.price) / snap.price) * 100, 1);
    expect(lv.downsidePct).toBeCloseTo(((lv.stop - snap.price) / snap.price) * 100, 1);
    expect(lv.riskReward!).toBeGreaterThanOrEqual(1.5);
  });
  it('sell levels have no upside and a negative downside', () => {
    const { snap } = scoreOf(randomWalk(300, 11, -0.004, 0.015));
    const lv = computeLevels(snap, 'SELL')!;
    expect(lv.upsidePct).toBeNull();
    expect(lv.downsidePct).toBeLessThan(0);
  });
  it('scenarios are ordered bearish < base range < bullish', () => {
    const { snap } = scoreOf(randomWalk(300, 4));
    const sc = computeScenarios(snap)!;
    expect(sc.bearish.target).toBeLessThan(sc.base.low);
    expect(sc.base.low).toBeLessThan(sc.base.high);
    expect(sc.bullish.target).toBeGreaterThan(sc.base.high);
  });
});

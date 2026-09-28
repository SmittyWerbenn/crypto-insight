import { TARGET_CONFIG, type SignalType } from '../../config/scoring.js';
import type { TechnicalSnapshot } from '../technical/engine.js';
import { round } from '../../utils/math.js';

export interface TradeLevels {
  direction: 'LONG' | 'SHORT_OR_REDUCE';
  entry: number;
  target: number;
  stop: number;
  /** % from current price to target (null for SELL signals where no upside is projected). */
  upsidePct: number | null;
  /** % from current price to stop / bearish target (negative). */
  downsidePct: number;
  riskReward: number | null;
  method: string[];
}

export interface Scenario {
  bullish: { target: number; potential: number; trigger: string };
  base: { low: number; high: number; description: string };
  bearish: { target: number; potential: number; trigger: string };
}

const pct = (from: number, to: number) => round(((to - from) / from) * 100, 2);

/**
 * Levels derived from confirmed support/resistance, swing points, Bollinger bands and ATR.
 * Uses only the snapshot (data up to the current candle).
 */
export function computeLevels(s: TechnicalSnapshot, signal: SignalType): TradeLevels | null {
  if (s.atr === null) return null;
  const price = s.price;
  const atr = s.atr;
  const pa = s.priceAction;
  const method: string[] = [];

  if (signal === 'SELL' || signal === 'STRONG_SELL') {
    const candidates = [...pa.supportLevels, pa.lastSwingLow ?? NaN, s.bbLower ?? NaN].filter((v) => Number.isFinite(v) && v < price - 0.5 * atr);
    const target = candidates.length ? Math.max(...candidates.filter((v) => v <= price - atr).concat(price - TARGET_CONFIG.atrTargetMultiplier * atr)) : price - TARGET_CONFIG.atrTargetMultiplier * atr;
    method.push(candidates.length ? 'Target bearish: support terdekat ≥1 ATR di bawah harga' : 'Target bearish: 3×ATR di bawah harga');
    const invalidation = pa.resistance !== null && pa.resistance - price < 3 * atr ? pa.resistance + 0.25 * atr : price + TARGET_CONFIG.atrStopMultiplier * atr;
    return {
      direction: 'SHORT_OR_REDUCE',
      entry: price,
      target: round(target, 8),
      stop: round(invalidation, 8),
      upsidePct: null,
      downsidePct: pct(price, target),
      riskReward: round((price - target) / (invalidation - price), 2),
      method,
    };
  }

  // Long-side levels (BUY / STRONG_BUY / HOLD)
  let stop: number;
  if (pa.support !== null && price - pa.support >= 0.5 * atr && price - pa.support <= 3 * atr) {
    stop = pa.support - 0.25 * atr;
    method.push('Stop: di bawah support terdekat yang terkonfirmasi (buffer −0,25 ATR)');
  } else {
    stop = price - TARGET_CONFIG.atrStopMultiplier * atr;
    method.push(`Stop: ${TARGET_CONFIG.atrStopMultiplier}×ATR di bawah harga`);
  }
  const risk = price - stop;
  const candidates = [...pa.resistanceLevels, pa.lastSwingHigh ?? NaN, s.bbUpper ?? NaN]
    .filter((v) => Number.isFinite(v) && v > price)
    .sort((a, b) => a - b);
  let target = candidates.find((c) => c - price >= TARGET_CONFIG.minRiskReward * risk);
  if (target !== undefined) method.push(`Target: level resistance/swing/band pertama dengan R:R ≥ ${TARGET_CONFIG.minRiskReward}`);
  else {
    target = price + Math.max(TARGET_CONFIG.atrTargetMultiplier * atr, TARGET_CONFIG.minRiskReward * risk);
    method.push('Target: proyeksi ATR (tidak ada resistance yang memenuhi di atas)');
  }
  return {
    direction: 'LONG',
    entry: price,
    target: round(target, 8),
    stop: round(stop, 8),
    upsidePct: pct(price, target),
    downsidePct: pct(price, stop),
    riskReward: round((target - price) / risk, 2),
    method,
  };
}

export function computeScenarios(s: TechnicalSnapshot): Scenario | null {
  if (s.atr === null) return null;
  const price = s.price;
  const atr = s.atr;
  const pa = s.priceAction;
  const res = pa.resistance ?? price + 1.5 * atr;
  const sup = pa.support ?? price - 1.5 * atr;
  const nextRes = pa.resistanceLevels.find((l) => l > res + 0.5 * atr) ?? res + 2 * atr;
  const nextSup = pa.supportLevels.find((l) => l < sup - 0.5 * atr) ?? sup - 2 * atr;
  return {
    bullish: {
      target: round(nextRes, 8),
      potential: pct(price, nextRes),
      trigger: `Close di atas resistance ${Number(res.toPrecision(6))} dengan volume di atas rata-rata`,
    },
    base: { low: round(sup, 8), high: round(res, 8), description: 'Rentang antara support dan resistance terdekat' },
    bearish: {
      target: round(nextSup, 8),
      potential: pct(price, nextSup),
      trigger: `Close di bawah support ${Number(sup.toPrecision(6))}`,
    },
  };
}

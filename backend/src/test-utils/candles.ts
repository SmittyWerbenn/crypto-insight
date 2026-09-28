import type { Candle } from '../types/market.js';
import { seededRandom } from '../utils/math.js';

export const DAY = 86_400_000;

export function candlesFromCloses(closes: number[], opts: { start?: number; step?: number; volume?: number | number[] } = {}): Candle[] {
  const start = opts.start ?? Date.UTC(2024, 0, 1);
  const step = opts.step ?? DAY;
  return closes.map((c, i) => {
    const open = i === 0 ? c : closes[i - 1];
    const vol = Array.isArray(opts.volume) ? opts.volume[i] : (opts.volume ?? 1000);
    return {
      openTime: start + i * step,
      closeTime: start + (i + 1) * step - 1,
      open,
      high: Math.max(open, c) * 1.001,
      low: Math.min(open, c) * 0.999,
      close: c,
      volume: vol,
    };
  });
}

export function makeCandle(i: number, o: number, h: number, l: number, c: number, v = 1000, start = Date.UTC(2024, 0, 1)): Candle {
  return { openTime: start + i * DAY, closeTime: start + (i + 1) * DAY - 1, open: o, high: h, low: l, close: c, volume: v };
}

/** Geometric random walk with drift. */
export function randomWalk(n: number, seed = 1, drift = 0, vol = 0.02, start = 100): Candle[] {
  const rnd = seededRandom(seed);
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const open = price;
    const r = drift + vol * (rnd() * 2 - 1) * 1.7;
    const close = open * (1 + r);
    const high = Math.max(open, close) * (1 + rnd() * vol * 0.5);
    const low = Math.min(open, close) * (1 - rnd() * vol * 0.5);
    out.push({ openTime: Date.UTC(2023, 0, 1) + i * DAY, closeTime: Date.UTC(2023, 0, 1) + (i + 1) * DAY - 1, open, high, low, close, volume: 1000 * (0.5 + rnd()) });
    price = close;
  }
  return out;
}

/**
 * Technical indicators. Every function is CAUSAL: output[i] depends only on input[0..i].
 * Warm-up positions are NaN. This property is enforced by tests (see indicators.test.ts
 * and ../backtest/lookahead.test.ts) and is the foundation of look-ahead-free backtests.
 */

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` finite values. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let start = values.findIndex((v) => Number.isFinite(v));
  if (start < 0) return out;
  let seedSum = 0;
  let count = 0;
  let prev = NaN;
  for (let i = start; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (count < period) {
      seedSum += v;
      count++;
      if (count === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (RMA). */
function rma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let count = 0;
  let sum = 0;
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (count < period) {
      sum += v;
      count++;
      if (count === period) {
        prev = sum / period;
        out[i] = prev;
      }
      continue;
    }
    prev = (prev * (period - 1) + v) / period;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const gains = new Array<number>(closes.length).fill(NaN);
  const losses = new Array<number>(closes.length).fill(NaN);
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains[i] = Math.max(d, 0);
    losses[i] = Math.max(-d, 0);
  }
  const ag = rma(gains, period);
  const al = rma(losses, period);
  return closes.map((_, i) => {
    if (!Number.isFinite(ag[i]) || !Number.isFinite(al[i])) return NaN;
    if (al[i] === 0) return ag[i] === 0 ? 50 : 100;
    const rs = ag[i] / al[i];
    return 100 - 100 / (1 + rs);
  });
}

export interface MacdResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => ef[i] - es[i]);
  const signal = ema(line, signalPeriod);
  const histogram = line.map((v, i) => v - signal[i]);
  return { macd: line, signal, histogram };
}

export function roc(values: number[], period = 10): number[] {
  return values.map((v, i) => (i >= period && values[i - period] !== 0 ? ((v - values[i - period]) / values[i - period]) * 100 : NaN));
}

function rollingMinMax(values: number[], period: number, fn: 'min' | 'max'): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let m = fn === 'min' ? Infinity : -Infinity;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j];
      if (!Number.isFinite(v)) {
        valid = false;
        break;
      }
      m = fn === 'min' ? Math.min(m, v) : Math.max(m, v);
    }
    if (valid) out[i] = m;
  }
  return out;
}

export interface StochRsiResult {
  k: number[];
  d: number[];
}

export function stochRsi(closes: number[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3): StochRsiResult {
  const r = rsi(closes, rsiPeriod);
  const lo = rollingMinMax(r, stochPeriod, 'min');
  const hi = rollingMinMax(r, stochPeriod, 'max');
  const raw = r.map((v, i) => {
    if (!Number.isFinite(lo[i]) || !Number.isFinite(hi[i])) return NaN;
    return hi[i] === lo[i] ? 50 : ((v - lo[i]) / (hi[i] - lo[i])) * 100;
  });
  const k = smaSkipNaN(raw, kSmooth);
  const d = smaSkipNaN(k, dSmooth);
  return { k, d };
}

/** SMA that starts once `period` consecutive finite values are available. */
function smaSkipNaN(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (!Number.isFinite(values[j])) {
        ok = false;
        break;
      }
      sum += values[j];
    }
    if (ok) out[i] = sum / period;
  }
  return out;
}

export interface BollingerResult {
  middle: number[];
  upper: number[];
  lower: number[];
  /** %B: 0 = lower band, 1 = upper band. */
  percentB: number[];
  bandwidth: number[];
}

export function bollinger(closes: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper = new Array<number>(closes.length).fill(NaN);
  const lower = new Array<number>(closes.length).fill(NaN);
  const percentB = new Array<number>(closes.length).fill(NaN);
  const bandwidth = new Array<number>(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (closes[j] - middle[i]) ** 2;
    const sd = Math.sqrt(s / period); // population stdev, standard for BB
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
    const w = upper[i] - lower[i];
    percentB[i] = w === 0 ? 0.5 : (closes[i] - lower[i]) / w;
    bandwidth[i] = middle[i] === 0 ? NaN : w / middle[i];
  }
  return { middle, upper, lower, percentB, bandwidth };
}

export function trueRange(high: number[], low: number[], close: number[]): number[] {
  return high.map((h, i) => {
    if (i === 0) return h - low[i];
    const pc = close[i - 1];
    return Math.max(h - low[i], Math.abs(h - pc), Math.abs(low[i] - pc));
  });
}

export function atr(high: number[], low: number[], close: number[], period = 14): number[] {
  return rma(trueRange(high, low, close), period);
}

export interface AdxResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

export function adx(high: number[], low: number[], close: number[], period = 14): AdxResult {
  const n = high.length;
  const plusDM = new Array<number>(n).fill(NaN);
  const minusDM = new Array<number>(n).fill(NaN);
  const tr = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  const str = rma(tr, period);
  const spdm = rma(plusDM, period);
  const smdm = rma(minusDM, period);
  const plusDI = str.map((t, i) => (Number.isFinite(t) && t !== 0 ? (100 * spdm[i]) / t : NaN));
  const minusDI = str.map((t, i) => (Number.isFinite(t) && t !== 0 ? (100 * smdm[i]) / t : NaN));
  const dx = plusDI.map((p, i) => {
    const m = minusDI[i];
    if (!Number.isFinite(p) || !Number.isFinite(m) || p + m === 0) return NaN;
    return (100 * Math.abs(p - m)) / (p + m);
  });
  return { adx: rma(dx, period), plusDI, minusDI };
}

/** Annualized historical volatility (%) from log returns. */
export function historicalVolatility(closes: number[], period = 20, periodsPerYear = 365): number[] {
  const lr = closes.map((c, i) => (i === 0 ? NaN : Math.log(c / closes[i - 1])));
  const out = new Array<number>(closes.length).fill(NaN);
  for (let i = period; i < closes.length; i++) {
    const w = lr.slice(i - period + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / period;
    const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (period - 1);
    out[i] = Math.sqrt(v) * Math.sqrt(periodsPerYear) * 100;
  }
  return out;
}

export function obv(closes: number[], volumes: number[]): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (!closes.length) return out;
  out[0] = 0;
  for (let i = 1; i < closes.length; i++) {
    const dir = closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0;
    out[i] = out[i - 1] + dir * volumes[i];
  }
  return out;
}

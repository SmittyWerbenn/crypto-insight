// Research library: features per 1h signal candle + 5m-accurate trade simulation.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { FeatureSeries, type BtcContext, type CoinFeatures } from '../../src/services/paper/features.ts';

export const DIR = process.env.PAPER_RESEARCH_DIR ?? new URL('./data', import.meta.url).pathname;
export const H = 3_600_000;
export const M5 = 300_000;
export const START = Date.UTC(2025, 0, 1);
export const SPLITS = { train: [Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1)], valid: [Date.UTC(2026, 0, 1), Date.UTC(2026, 6, 1)], test: [Date.UTC(2026, 6, 1), Date.UTC(2026, 9, 3)] } as const;
export type Split = keyof typeof SPLITS;
export const splitOf = (t: number): Split => (t < SPLITS.train[1] ? 'train' : t < SPLITS.valid[1] ? 'valid' : 'test');

export interface Cand extends CoinFeatures {
  sym: string;
  /** Entry decision time = close of the signal candle. */
  at: number;
  btc: BtcContext;
}

const SIGNALS_ONLY = process.env.PAPER_SIGNALS_ONLY === '1';
export const SYMS = readdirSync(`${DIR}/k1h`).map((f) => f.replace('.json', '')).sort();

export function loadCands(): Cand[] {
  const f = `${DIR}/cands.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  // One coin at a time (only BTC stays loaded), so large universes fit in memory.
  const series = (s: string) => {
    const raw: number[][] = JSON.parse(readFileSync(`${DIR}/k1h/${s}.json`, 'utf8'));
    return new FeatureSeries(raw.map((x) => ({ openTime: x[0], open: x[1], high: x[2], low: x[3], close: x[4], volume: x[5], closeTime: x[0] + H - 1, quoteVolume: x[6] })));
  };
  const BTC = series('BTCUSDT');
  const btcIdx = new Map(BTC.candles.map((c, i) => [c.openTime, i]));
  const out: Cand[] = [];
  for (const s of SYMS) {
    const F = s === 'BTCUSDT' ? BTC : series(s);
    for (let i = 0; i < F.candles.length; i++) {
      if (F.candles[i].openTime < START - H) continue;
      const f = F.at(i);
      const bi = btcIdx.get(F.candles[i].openTime);
      const btc = bi !== undefined ? BTC.btcAt(bi) : null;
      if (!f || !btc) continue;
      // PAPER_SIGNALS_ONLY=1 keeps only breakout signals (what the portfolio studies need) to fit big universes in memory.
      if (SIGNALS_ONLY && !(f.hh20Atr > 0 && f.volRatio >= 1.5)) continue;
      out.push({ ...f, sym: s, at: f.time + H, btc });
    }
    console.error('features', s, out.length);
  }
  writeFileSync(f, JSON.stringify(out));
  return out;
}

/** 5m candles as typed arrays for fast exit simulation. */
export interface Bars { t: Float64Array; o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array }
const barCache: Record<string, Bars> = {};
export function bars(sym: string): Bars {
  if (barCache[sym]) return barCache[sym];
  const raw: number[][] = JSON.parse(readFileSync(`${DIR}/k5m/${sym}.json`, 'utf8'));
  const n = raw.length;
  const b: Bars = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  raw.forEach((x, i) => { b.t[i] = x[0]; b.o[i] = x[1]; b.h[i] = x[2]; b.l[i] = x[3]; b.c[i] = x[4]; });
  return (barCache[sym] = b);
}
export function idxAt(b: Bars, t: number): number {
  let lo = 0, hi = b.t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (b.t[m] < t) lo = m + 1; else hi = m; }
  return lo;
}

export interface Exit { reason: 'TP' | 'SL' | 'TO'; pnlPct: number; exitTime: number; holdH: number; mfe: number; mae: number; entry: number; exitPrice: number }

/**
 * Long trade from `entryIdx` (fill at that 5m bar's open, or at `fillPrice`), TP/SL in % from fill.
 * A 5m bar touching both levels counts as the stop (conservative). Timeout exits at the last bar's close.
 */
export function simulate(b: Bars, entryIdx: number, tpPct: number, slPct: number, holdH: number, fillPrice?: number, firstBarInclusive = true): Exit | null {
  if (entryIdx >= b.t.length) return null;
  const entry = fillPrice ?? b.o[entryIdx];
  const start = b.t[entryIdx];
  const tp = entry * (1 + tpPct / 100), sl = entry * (1 - slPct / 100);
  const end = start + holdH * H;
  let mfe = 0, mae = 0;
  for (let k = firstBarInclusive ? entryIdx : entryIdx + 1; k < b.t.length; k++) {
    if (b.t[k] >= end) {
      const px = b.c[k - 1];
      return { reason: 'TO', pnlPct: (px / entry - 1) * 100, exitTime: end, holdH, mfe, mae, entry, exitPrice: px };
    }
    const hs = b.l[k] <= sl, ht = b.h[k] >= tp;
    if (hs) return { reason: 'SL', pnlPct: -slPct, exitTime: b.t[k] + M5, holdH: (b.t[k] + M5 - start) / H, mfe: Math.max(mfe, ht ? tpPct : (b.h[k] / entry - 1) * 100), mae: -slPct, entry, exitPrice: sl };
    if (ht) return { reason: 'TP', pnlPct: tpPct, exitTime: b.t[k] + M5, holdH: (b.t[k] + M5 - start) / H, mfe: tpPct, mae: Math.min(mae, (b.l[k] / entry - 1) * 100), entry, exitPrice: tp };
    mfe = Math.max(mfe, (b.h[k] / entry - 1) * 100);
    mae = Math.min(mae, (b.l[k] / entry - 1) * 100);
  }
  return null; // not enough future data
}

export interface Stat { n: number; tp: number; sl: number; to: number; win: number; avg: number; med: number; avgW: number; avgL: number; pf: number; hold: number; maxHold: number; tot: number }
export function stats(xs: Exit[]): Stat {
  const n = xs.length;
  if (!n) return { n: 0, tp: 0, sl: 0, to: 0, win: 0, avg: 0, med: 0, avgW: 0, avgL: 0, pf: 0, hold: 0, maxHold: 0, tot: 0 };
  const p = xs.map((x) => x.pnlPct).sort((a, b) => a - b);
  const w = p.filter((v) => v > 0), l = p.filter((v) => v <= 0);
  const sw = w.reduce((a, b) => a + b, 0), sl = -l.reduce((a, b) => a + b, 0);
  const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    n,
    tp: r((100 * xs.filter((x) => x.reason === 'TP').length) / n, 1),
    sl: r((100 * xs.filter((x) => x.reason === 'SL').length) / n, 1),
    to: r((100 * xs.filter((x) => x.reason === 'TO').length) / n, 1),
    win: r((100 * w.length) / n, 1),
    avg: r((sw - sl) / n),
    med: r(p[n >> 1]),
    avgW: r(w.length ? sw / w.length : 0, 2),
    avgL: r(l.length ? -sl / l.length : 0, 2),
    pf: r(sl ? sw / sl : 99, 2),
    hold: r(xs.reduce((a, x) => a + x.holdH, 0) / n, 1),
    maxHold: r(Math.max(...xs.map((x) => x.holdH)), 1),
    tot: r(sw - sl, 1),
  };
}
export const fmt = (s: Stat) => (s.n ? `n=${String(s.n).padStart(5)} TP=${s.tp.toFixed(1).padStart(5)}% SL=${s.sl.toFixed(1).padStart(5)}% TO=${s.to.toFixed(1).padStart(5)}% avg=${s.avg.toFixed(3).padStart(7)}% med=${s.med.toFixed(2).padStart(6)} W=${s.avgW.toFixed(2)} L=${s.avgL.toFixed(2)} PF=${s.pf.toFixed(2)} hold=${s.hold}h` : 'n=0');

export interface EntryRule { (c: Cand): boolean }
export interface ExitRule { tpAtr: number; slAtr: number; holdH: number }

/**
 * Per-trade backtest with one open position per coin (re-entry mode A).
 * entryMode 'open' = fill at the first 5m open after the signal candle closes (live scan a few seconds after close).
 * entryMode {confirmDev} = wait one 5m bar; enter at its close only if close >= signalClose*(1+dev/100).
 */
export function backtest(cands: Cand[], rule: EntryRule, ex: ExitRule, split: Split | 'all', opts: { confirmDev?: number; cooldownH?: number } = {}): Exit[] {
  const busy: Record<string, number> = {};
  const out: Exit[] = [];
  for (const c of cands) {
    if (split !== 'all' && splitOf(c.at) !== split) continue;
    if ((busy[c.sym] ?? 0) > c.at) continue;
    if (!rule(c)) continue;
    const b = bars(c.sym);
    let i = idxAt(b, c.at);
    if (i >= b.t.length || b.t[i] - c.at > 10 * 60_000) continue;
    let fill: number | undefined;
    let first = true;
    if (opts.confirmDev !== undefined) {
      const px = b.c[i];
      if (px < c.close * (1 + opts.confirmDev / 100)) continue;
      fill = px; first = false;
    }
    const e = simulate(b, i, ex.tpAtr * c.atrPct, ex.slAtr * c.atrPct, ex.holdH, fill, first);
    if (!e) continue;
    out.push(e);
    busy[c.sym] = e.exitTime + (opts.cooldownH ?? 0) * H;
  }
  return out;
}

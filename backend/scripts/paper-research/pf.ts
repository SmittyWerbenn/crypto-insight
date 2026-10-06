// Portfolio simulation of Rp1.000.000 with the shared backend modules (strategy + portfolio ledger).
import { bars, idxAt, loadCands, H, M5, type Cand } from './lib.ts';
import { entryCheck, isSignal, levelsFor, rejectReasons, type RejectCode, type StrategyConfig } from '../../src/services/paper/strategy.ts';
import { PaperPortfolio, type MoneyConfig, type ClosedTrade } from '../../src/services/paper/portfolio.ts';

let CANDS: Cand[] | null = null;
let BY_KEY: Map<string, Cand> | null = null;
export function cands() {
  if (!CANDS) {
    CANDS = loadCands().sort((a, b) => a.at - b.at);
    BY_KEY = new Map(CANDS.map((c) => [`${c.sym}:${c.at}`, c]));
  }
  return { C: CANDS, K: BY_KEY! };
}

export type LayerMode = 'none' | 'strength' | 'dynamic';
export interface RunOpts { from: number; to: number; strat: StrategyConfig; money: MoneyConfig; layerMode?: LayerMode; extraRule?: (c: Cand) => boolean; accept?: (c: Cand) => boolean; rank?: (c: Cand) => number; /** Profile mode: every breakout signal is judged by rejectReasons(strat) and counted in the funnel. */ funnel?: boolean }

export function runPortfolio(o: RunOpts) {
  const { C, K } = cands();
  const pf = new PaperPortfolio(o.money);
  const skipped: Record<string, number> = {};
  const byHour = new Map<number, Cand[]>();
  const funnel = { signals: 0, ruleRejected: 0, rulePassed: 0, entered: 0, moneySkipped: 0, reasons: {} as Partial<Record<RejectCode, number>>, primary: {} as Partial<Record<RejectCode, number>>, money: {} as Partial<Record<RejectCode, number>> };
  for (const c of C) {
    if (c.at < o.from || c.at >= o.to) continue;
    if (o.funnel) {
      if (!isSignal(c)) continue;
      funnel.signals++;
      const rr = rejectReasons(c, c.btc, o.strat);
      if (rr.length) {
        funnel.ruleRejected++;
        funnel.primary[rr[0].code] = (funnel.primary[rr[0].code] ?? 0) + 1;
        for (const r of rr) funnel.reasons[r.code] = (funnel.reasons[r.code] ?? 0) + 1;
        continue;
      }
      funnel.rulePassed++;
    } else if (o.accept ? !o.accept(c) : entryCheck(c, c.btc, o.strat) !== null) continue;
    if (o.extraRule && !o.extraRule(c)) continue;
    (byHour.get(c.at) ?? byHour.set(c.at, []).get(c.at)!).push(c);
  }
  const ptr: Record<string, number> = {};
  const priceAt = (sym: string, t: number): number | null => {
    const b = bars(sym);
    const i = idxAt(b, t);
    return i < b.t.length && b.t[i] - t < 30 * 60_000 ? b.o[i] : null;
  };
  pf.mark(o.from, {}, 'START');
  let invSum = 0, invN = 0, invMax = 0, cashSum = 0;
  const util: number[] = [];
  for (let t = o.from; t < o.to; t += M5) {
    // 1) exits on the 5m bar that starts at t
    for (const p of [...pf.state.positions]) {
      const b = bars(p.symbol);
      let i = ptr[p.id] ?? idxAt(b, t);
      while (i < b.t.length && b.t[i] < t) i++;
      ptr[p.id] = i;
      if (i >= b.t.length || b.t[i] !== t) continue;
      if (t >= p.timeoutAt) { pf.close(p, t, b.o[i], 'TIMEOUT'); continue; }
      const hitSl = b.l[i] <= p.sl, hitTp = p.tp !== null && b.h[i] >= p.tp;
      if (hitSl) { p.low = Math.min(p.low, p.sl); pf.close(p, t + M5, p.sl, 'CUTLOSS'); continue; } // same-bar tie → stop (conservative)
      if (hitTp) { p.high = Math.max(p.high, p.tp!); pf.close(p, t + M5, p.tp!, 'TARGET'); continue; }
      p.high = Math.max(p.high, b.h[i]); p.low = Math.min(p.low, b.l[i]);
    }
    if (t % H !== 0) continue;
    // 2) entry layers on open positions (valid add only)
    if (o.layerMode && o.layerMode !== 'none') for (const p of pf.state.positions) {
      if (p.layers.length >= o.money.layers.length) continue;
      const f = K.get(`${p.symbol}:${t}`);
      const px = priceAt(p.symbol, t);
      if (!f || px === null) continue;
      const stillValid = f.regime === 'BULL' && f.btc.ret30d > o.strat.btcRet30dMin && f.emaUp && f.macdHist > 0;
      const strong = o.layerMode === 'dynamic' ? f.volRatio > 1.5 && f.hh20Atr > 0 : true;
      if (!stillValid || !strong) continue;
      if (px < p.layers[p.layers.length - 1].price) continue; // only add when price is above the previous layer
      pf.addLayer(p, t, px);
    }
    // 3) new entries, strongest volume first
    const list = (byHour.get(t) ?? []).slice().sort((a, b) => (o.rank ? o.rank(b) - o.rank(a) : b.volRatio - a.volRatio));
    for (const c of list) {
      const px = priceAt(c.sym, t);
      if (px === null) continue;
      const lv = levelsFor(px, c.atrPct, o.strat);
      const r = pf.open({ symbol: c.sym, time: t, price: px, tp: lv.tp, sl: lv.sl, slPct: lv.slPct, atrPct: c.atrPct, maxHoldH: o.strat.maxHoldH, meta: { score: c.score, volRatio: c.volRatio, rsi: c.rsi, atrPct: c.atrPct, atrPctile: c.atrPctile, regime: c.regime, btcRet30d: c.btc.ret30d, btcRegime: c.btc.regime, macdHist: c.macdHist, roc: c.roc } });
      if (r.reason) skipped[r.reason.replace(/[\d.]+/g, '#')] = (skipped[r.reason.replace(/[\d.]+/g, '#')] ?? 0) + 1;
      if (r.code) { funnel.moneySkipped++; funnel.money[r.code] = (funnel.money[r.code] ?? 0) + 1; } else funnel.entered++;
    }
    // 4) hourly mark-to-market
    const prices: Record<string, number> = {};
    for (const p of pf.state.positions) { const px = priceAt(p.symbol, t); if (px !== null) prices[p.symbol] = px; }
    const m = pf.mark(t, prices);
    invSum += pf.invested; invN++;
    invMax = Math.max(invMax, m.invested / m.equity); cashSum += m.cash / m.equity; util.push(m.invested / m.equity);
  }
  // close anything still open at the end at market (end of the period)
  for (const p of [...pf.state.positions]) { const px = priceAt(p.symbol, o.to - M5) ?? p.layers[0].price; pf.close(p, o.to, px, 'TIMEOUT'); }
  pf.mark(o.to, {});
  return { pf, skipped, funnel, utilization: invSum / invN / o.money.baseCapital, avgInvestedPct: (100 * util.reduce((a, b) => a + b, 0)) / (util.length || 1), maxInvestedPct: 100 * invMax, avgCashPct: (100 * cashSum) / (invN || 1), hoursInvestedPct: (100 * util.filter((u) => u > 0).length) / (util.length || 1) };
}

export function summarize(pf: PaperPortfolio, base: number) {
  const T = pf.closed;
  const n = T.length;
  const w = T.filter((t) => t.pnl > 0), l = T.filter((t) => t.pnl <= 0);
  const sw = w.reduce((a, t) => a + t.pnl, 0), sl = -l.reduce((a, t) => a + t.pnl, 0);
  const pnls = T.map((t) => t.pnl).sort((a, b) => a - b);
  const eq = pf.ledger[pf.ledger.length - 1].equity;
  let peak = base, trough = base, maxDd = 0, peakAt = base, troughAt = base;
  for (const r of pf.ledger) { if (r.equity > peak) peak = r.equity; const dd = (r.equity - peak) / peak; if (dd < maxDd) { maxDd = dd; peakAt = peak; troughAt = r.equity; } }
  let streakW = 0, streakL = 0, cw = 0, cl = 0;
  for (const t of T) { if (t.pnl > 0) { cw++; cl = 0; } else { cl++; cw = 0; } streakW = Math.max(streakW, cw); streakL = Math.max(streakL, cl); }
  const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    trades: n,
    targetPct: r((100 * T.filter((t) => t.exitReason === 'TARGET').length) / (n || 1), 1),
    cutlossPct: r((100 * T.filter((t) => t.exitReason === 'CUTLOSS').length) / (n || 1), 1),
    timeoutPct: r((100 * T.filter((t) => t.exitReason === 'TIMEOUT').length) / (n || 1), 1),
    winRate: r((100 * w.length) / (n || 1), 1),
    avgPnl: r((sw - sl) / (n || 1), 0),
    medianPnl: r(pnls[n >> 1] ?? 0, 0),
    avgWin: r(w.length ? sw / w.length : 0, 0),
    avgLoss: r(l.length ? -sl / l.length : 0, 0),
    expectancyPct: r(T.reduce((a, t) => a + t.pnlPct, 0) / (n || 1), 3),
    profitFactor: r(sl ? sw / sl : 99, 2),
    totalPnl: r(eq - base, 0),
    returnPct: r(((eq - base) / base) * 100, 2),
    finalEquity: r(eq, 0),
    peakEquity: r(Math.max(...pf.ledger.map((x) => x.equity)), 0),
    maxDrawdownPct: r(maxDd * 100, 2),
    ddPeak: r(peakAt, 0),
    ddTrough: r(troughAt, 0),
    avgHoldH: r(T.reduce((a, t) => a + t.holdH, 0) / (n || 1), 2),
    maxHoldH: r(Math.max(0, ...T.map((t) => t.holdH)), 2),
    longestWinStreak: streakW,
    longestLossStreak: streakL,
  };
}

export const tradesOf = (pf: PaperPortfolio): ClosedTrade[] => pf.closed;

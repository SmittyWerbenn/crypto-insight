import { writeFileSync } from 'node:fs';
import { runPortfolio, summarize, cands } from './pf.ts';
import { DIR, SPLITS, backtest, stats, type Cand } from './lib.ts';
import { STRATEGY_V2 } from '../../src/services/paper/strategy.ts';
import { MONEY_V2 } from '../../src/services/paper/portfolio.ts';
const S = STRATEGY_V2, M = MONEY_V2;
const periods = { train: SPLITS.train, valid: SPLITS.valid, test: SPLITS.test, full: [SPLITS.train[0], SPLITS.test[1]] } as Record<string, readonly number[]>;
// OLD strategy approximation at portfolio level: engine BUY + coin !BEAR, TP 3 ATR / SL 1.5 ATR, 24h, risk 2%, 5 positions, no reserve/cluster caps
const OLD_S = { ...S, minVolRatio: 0, tpAtr: 3, slAtr: 1.5, maxHoldH: 24, coinRegime: 'ANY' as const, btcRet30dMin: -1e9 };
const OLD_M = { ...M, riskPerTrade: 0.02, maxPerCoin: 0.2, maxPositions: 5, cashReserve: 0, maxExposure: 1, maxClusterExposure: 1 };
const oldRule = (c: Cand) => (c.signal === 'BUY' || c.signal === 'STRONG_BUY') && c.regime !== 'BEAR';
const out: any = { generatedAt: new Date().toISOString(), strategy: S, money: M, periods: Object.fromEntries(Object.entries(periods).map(([k, v]) => [k, v.map((x) => new Date(x).toISOString())])) };
out.compare = {};
for (const [k, [a, b]] of Object.entries(periods)) {
  const n = runPortfolio({ from: a, to: b, strat: S, money: M });
  const o = runPortfolio({ from: a, to: b, strat: OLD_S, money: OLD_M, extraRule: oldRule, rank: (c) => c.score });
  out.compare[k] = { v2: { ...summarize(n.pf, 1e6), utilization: n.utilization, skipped: n.skipped }, old: { ...summarize(o.pf, 1e6), utilization: o.utilization } };
  console.log(k.padEnd(6), 'V2 ', JSON.stringify(out.compare[k].v2).slice(0, 420));
  console.log(k.padEnd(6), 'OLD', JSON.stringify(out.compare[k].old).slice(0, 420));
}
// Robustness (per-period portfolio): TP x SL neighbourhood, volume, hold
out.robust = [];
const rb = (lab: string, strat: any, money = M) => { const r: any = { lab }; for (const k of ['train', 'valid', 'test']) { const s = summarize(runPortfolio({ from: periods[k][0], to: periods[k][1], strat, money }).pf, 1e6); r[k] = { n: s.trades, pf: s.profitFactor, ret: s.returnPct, dd: s.maxDrawdownPct, tp: s.targetPct, cl: s.cutlossPct, exp: s.expectancyPct }; } out.robust.push(r); console.log(lab.padEnd(26), ['train', 'valid', 'test'].map((k) => `${k} PF=${r[k].pf} ret=${r[k].ret}% CL=${r[k].cl}%`).join(' | ')); };
for (const tp of [0.6, 0.7, 0.75, 0.8, 0.9]) for (const sl of [1.5, 1.75, 2, 2.25, 2.5, 2.75]) rb(`TP${tp} SL${sl}`, { ...S, tpAtr: tp, slAtr: sl });
for (const v of [2, 2.5, 3, 3.5, 4]) rb(`vol>=${v}`, { ...S, minVolRatio: v });
for (const h of [2, 4, 6, 8, 12, 24]) rb(`hold ${h}h`, { ...S, maxHoldH: h });
for (const r of [0.005, 0.0075, 0.01, 0.0125]) rb(`risk ${r * 100}%`, S, { ...M, riskPerTrade: r });
for (const c of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) rb(`reserve ${c * 100}%`, S, { ...M, cashReserve: c, maxExposure: 1 - c });
// Full continuous run for the equity curve / daily / per-asset / trade log
const full = runPortfolio({ from: periods.full[0], to: periods.full[1], strat: S, money: M });
const pf = full.pf;
out.full = summarize(pf, 1e6);
const day = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10); // WIB
const marks = pf.ledger;
const curve: any[] = [];
let lastDay = '';
for (const r of marks) { const d = day(r.time); if (d !== lastDay) { curve.push({ t: r.time, ...r }); lastDay = d; } else curve[curve.length - 1] = { t: r.time, ...r }; }
out.equityDaily = curve.map((r) => ({ date: day(r.time), equity: Math.round(r.equity), cash: Math.round(r.cash), invested: Math.round(r.invested), realized: Math.round(r.realizedPnl), unrealized: Math.round(r.unrealizedPnl), hwm: Math.round(r.highWaterMark), dd: +r.drawdownPct.toFixed(2) }));
const daily: Record<string, any> = {};
for (const t of pf.closed) { const d = day(t.closedAt); const x = (daily[d] ??= { date: d, buys: 0, sells: 0, target: 0, cutloss: 0, timeout: 0, pnl: 0 }); x.sells++; x.pnl += t.pnl; x[t.exitReason === 'TARGET' ? 'target' : t.exitReason === 'CUTLOSS' ? 'cutloss' : 'timeout']++; }
for (const t of pf.closed) { const d = day(t.openedAt); (daily[d] ??= { date: d, buys: 0, sells: 0, target: 0, cutloss: 0, timeout: 0, pnl: 0 }).buys++; }
let eq = 1e6;
out.daily = Object.values(daily).sort((a: any, b: any) => (a.date < b.date ? -1 : 1)).map((x: any) => { const start = eq; eq += x.pnl; return { ...x, pnl: Math.round(x.pnl), startEquity: Math.round(start), endEquity: Math.round(eq), returnPct: +((x.pnl / start) * 100).toFixed(3) }; });
const per: Record<string, any> = {};
for (const t of pf.closed) { const x = (per[t.symbol] ??= { symbol: t.symbol, cluster: t.cluster, trades: 0, target: 0, cutloss: 0, timeout: 0, invested: 0, pnl: 0, maxAlloc: 0 }); x.trades++; x.invested += t.cost; x.pnl += t.pnl; x.maxAlloc = Math.max(x.maxAlloc, t.cost); x[t.exitReason === 'TARGET' ? 'target' : t.exitReason === 'CUTLOSS' ? 'cutloss' : 'timeout']++; }
out.perAsset = Object.values(per).map((x: any) => ({ ...x, invested: Math.round(x.invested), pnl: Math.round(x.pnl), maxAlloc: Math.round(x.maxAlloc), returnOnInvested: +((x.pnl / x.invested) * 100).toFixed(3) })).sort((a: any, b: any) => b.pnl - a.pnl);
out.trades = pf.closed.map((t) => ({ id: t.id, symbol: t.symbol, cluster: t.cluster, openedAt: t.openedAt, closedAt: t.closedAt, entry: t.avgEntry, exit: t.exitPrice, tp: t.tp, sl: t.sl, cost: Math.round(t.cost), pnl: Math.round(t.pnl), pnlPct: +t.pnlPct.toFixed(3), reason: t.exitReason, holdH: +t.holdH.toFixed(2), mfePct: +t.mfePct.toFixed(3), maePct: +t.maePct.toFixed(3), equityAfter: Math.round(t.equityAfter), cashAfter: Math.round(t.cashAfter), ...t.meta }));
out.skippedFull = full.skipped; out.utilizationFull = full.utilization;
// per-month returns
const mon: Record<string, number> = {}; for (const t of pf.closed) { const m = day(t.closedAt).slice(0, 7); mon[m] = (mon[m] ?? 0) + t.pnl; } out.monthly = Object.entries(mon).map(([m, p]) => ({ month: m, pnl: Math.round(p) }));
writeFileSync(`${DIR}/report.json`, JSON.stringify(out));
console.log('FULL', JSON.stringify(out.full)); console.log('monthly', JSON.stringify(out.monthly)); console.log('perAsset', JSON.stringify(out.perAsset.map((x: any) => [x.symbol, x.trades, x.pnl])));

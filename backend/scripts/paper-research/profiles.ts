// Three profiles (Aman / Menengah / Agresif): portfolio results, signal funnel with rejection reasons,
// capital utilization, threshold evidence and the marginal value of each loosening step.
// Writes data/profiles-report.json (copied into src/services/paper/research-profiles.data.ts).
import { writeFileSync } from 'node:fs';
import { runPortfolio, summarize, cands } from './pf.ts';
import { DIR, SPLITS, backtest, type Cand, type Split } from './lib.ts';
import { PROFILES, PROFILE_IDS, STRATEGY_V2, btcState, isSignal, rejectReasons, type ProfileId, type StrategyConfig } from '../../src/services/paper/strategy.ts';
import { MONEY_PROFILES, MONEY_V2, PAPER_CAPITAL } from '../../src/services/paper/portfolio.ts';

const FEE = 0.001;
const periods: Record<string, readonly number[]> = { train: SPLITS.train, valid: SPLITS.valid, test: SPLITS.test, full: [SPLITS.train[0], SPLITS.test[1]] };
const months = (k: string) => (periods[k][1] - periods[k][0]) / (30.44 * 86_400_000);
const r2 = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const out: any = { generatedAt: new Date().toISOString(), feeRate: FEE, periods: Object.fromEntries(Object.entries(periods).map(([k, v]) => [k, v.map((x) => new Date(x).toISOString())])) };
out.profiles = Object.fromEntries(PROFILE_IDS.map((p) => [p, { strategy: PROFILES[p], money: MONEY_PROFILES[p] }]));

// 1) Portfolio per profile × period (fee 0.1% and 0%), no compounding: funnel + outcomes + utilization
out.results = {};
for (const p of PROFILE_IDS) {
  out.results[p] = {};
  for (const fee of [FEE, 0]) {
    for (const [k, [a, b]] of Object.entries(periods)) {
      const r = runPortfolio({ from: a, to: b, strat: PROFILES[p], money: { ...MONEY_PROFILES[p], feeRate: fee, compounding: false }, funnel: true });
      const s = summarize(r.pf, PAPER_CAPITAL);
      const row = {
        ...s,
        perMonth: { signals: r2(r.funnel.signals / months(k), 1), trades: r2(s.trades / months(k), 1) },
        funnel: r.funnel,
        acceptedPct: r2((100 * r.funnel.rulePassed) / (r.funnel.signals || 1), 1),
        avgInvestedPct: r2(r.avgInvestedPct),
        maxInvestedPct: r2(r.maxInvestedPct),
        avgCashPct: r2(r.avgCashPct),
        hoursInvestedPct: r2(r.hoursInvestedPct, 1),
        feesPaid: Math.round(r.pf.state.feesPaid),
      };
      (out.results[p][fee ? 'fee' : 'noFee'] ??= {})[k] = row;
      if (k === 'full' && fee) {
        const day = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
        const curve = new Map<string, number>();
        for (const l of r.pf.ledger) curve.set(day(l.time), Math.round(l.equity));
        (out.equity ??= {})[p] = [...curve].map(([date, equity]) => ({ date, equity }));
        const mon: Record<string, number> = {};
        for (const t of r.pf.closed) { const m = day(t.closedAt).slice(0, 7); mon[m] = (mon[m] ?? 0) + t.pnl; }
        (out.monthly ??= {})[p] = Object.entries(mon).map(([month, pnl]) => ({ month, pnl: Math.round(pnl) }));
      }
      console.log(p.padEnd(9), (fee ? 'fee ' : 'nofee'), k.padEnd(5), `sig ${r.funnel.signals} acc ${r.funnel.rulePassed} n ${s.trades} T ${s.targetPct} CL ${s.cutlossPct} exp ${s.expectancyPct} ret ${s.returnPct}% DD ${s.maxDrawdownPct}% util ${r2(r.avgInvestedPct)}%`);
    }
  }
}

// 2) Threshold evidence: per-trade net expectancy (fee 0.1%/side) of signal slices, one position per coin
const { C } = cands();
const ex = { tpAtr: 2, slAtr: 2, holdH: 12 };
const exA = { tpAtr: PROFILES.AMAN.tpAtr, slAtr: PROFILES.AMAN.slAtr, holdH: PROFILES.AMAN.maxHoldH };
const SIG = C.filter(isSignal);
const cell = (rule: (c: Cand) => boolean, sp: Split, e = ex) => {
  const xs = backtest(SIG, rule, e, sp);
  const n = xs.length;
  const net = xs.map((x) => x.pnlPct - 2 * FEE * 100);
  return { n, perMonth: r2(n / months(sp), 1), expNet: r2(net.reduce((a, b) => a + b, 0) / (n || 1), 3), expGross: r2(xs.reduce((a, x) => a + x.pnlPct, 0) / (n || 1), 3), targetPct: r2((100 * xs.filter((x) => x.reason === 'TP').length) / (n || 1), 1), cutlossPct: r2((100 * xs.filter((x) => x.reason === 'SL').length) / (n || 1), 1) };
};
const row = (label: string, rule: (c: Cand) => boolean, e = ex) => {
  const r: any = { label };
  for (const sp of ['train', 'valid', 'test'] as Split[]) r[sp] = cell(rule, sp, e);
  console.log(label.padEnd(44), ['train', 'valid', 'test'].map((k) => `${k} n${r[k].n} net ${r[k].expNet} CL ${r[k].cutlossPct}`).join(' | '));
  return r;
};
// base filter for one-dimension slices: the Agresif rules minus the dimension being tested
const AG = PROFILES.AGRESIF;
const without = (cfg: StrategyConfig, drop: Partial<StrategyConfig>) => (c: Cand) => rejectReasons(c, c.btc, { ...cfg, ...drop }).length === 0;
out.evidence = {
  volume: [[1.5, 2], [2, 2.5], [2.5, 3], [3, 4], [4, 6], [6, 1e9]].map(([lo, hi]) => row(`Volume ${lo}x–${hi > 1e8 ? '∞' : hi + 'x'}`, (c) => without(AG, {})(c) && c.volRatio >= lo && c.volRatio < hi)),
  btc: (['BULL', 'NEUTRAL', 'BEAR'] as const).map((s) => row(`BTC ${s}`, (c) => without(AG, { btcRet30dMin: null })(c) && btcState(c.btc) === s)),
  regime: (['BULL', 'SIDEWAYS', 'BEAR'] as const).map((g) => row(`Koin ${g}`, (c) => without(AG, { regimes: ['BULL', 'SIDEWAYS', 'BEAR'] })(c) && c.regime === g)),
  ema: [true, false].map((u) => row(`EMA20 ${u ? '>' : '<'} EMA50`, (c) => without(AG, { requireEmaUp: false })(c) && c.emaUp === u)),
  atr: [[0, 0.8], [0.8, 1], [1, 1.5], [1.5, 2.5], [2.5, 4], [4, 6], [6, 1e9]].map(([lo, hi]) => row(`ATR ${lo}–${hi > 1e8 ? '∞' : hi}%`, (c) => without(AG, { minAtrPct: 0, maxAtrPct: 1e9 })(c) && c.atrPct >= lo && c.atrPct < hi)),
  breakout: [[0, 0.25], [0.25, 0.5], [0.5, 1], [1, 1e9]].map(([lo, hi]) => row(`Breakout ${lo}–${hi > 1e8 ? '∞' : hi} ATR`, (c) => without(AG, {})(c) && c.hh20Atr >= lo && c.hh20Atr < hi)),
  score: [[0, 60], [60, 70], [70, 80], [80, 90], [90, 101]].map(([lo, hi]) => row(`Skor engine ${lo}–${hi > 100 ? 100 : hi}`, (c) => without(AG, {})(c) && c.score >= lo && c.score < hi)),
};

// 3) Marginal value of each loosening step, and of the slices every profile rejects
const ok = (p: ProfileId) => (c: Cand) => rejectReasons(c, c.btc, PROFILES[p]).length === 0;
out.marginal = [
  row('Aman (exit Aman 0.75/2.5 ATR)', ok('AMAN'), exA),
  row('Aman dengan exit 2/2 ATR', ok('AMAN')),
  row('Diterima Menengah, ditolak Aman', (c) => ok('MENENGAH')(c) && !ok('AMAN')(c)),
  row('Diterima Agresif, ditolak Menengah', (c) => ok('AGRESIF')(c) && !ok('MENENGAH')(c)),
  row('Ditolak semua: BTC Neutral (lainnya lolos Agresif)', (c) => without(AG, { btcRet30dMin: -5 })(c) && btcState(c.btc) === 'NEUTRAL'),
  row('Ditolak semua: koin SIDEWAYS', (c) => without(AG, { regimes: ['SIDEWAYS'] })(c)),
  row('Ditolak semua: ATR < 1%', (c) => without(AG, { minAtrPct: 0 })(c) && c.atrPct < 1),
  row('Ditolak semua: EMA20 < EMA50', (c) => without(AG, { requireEmaUp: false })(c) && !c.emaUp),
];

// 4) Baseline: the first V2 rules with the same fee, for reference
out.baselineV2 = summarize(runPortfolio({ from: periods.full[0], to: periods.full[1], strat: STRATEGY_V2, money: { ...MONEY_V2, baseCapital: PAPER_CAPITAL, feeRate: FEE, compounding: false } }).pf, PAPER_CAPITAL);

writeFileSync(`${DIR}/profiles-report.json`, JSON.stringify(out));
console.log('written', `${DIR}/profiles-report.json`);

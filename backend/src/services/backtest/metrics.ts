import { mean, percentile, round } from '../../utils/math.js';
import type { BacktestMetrics, EquityPoint, MonthlyReturn, RegimeBreakdown, Trade } from './types.js';

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export function maxDrawdownPct(equity: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    mdd = Math.min(mdd, ((e - peak) / peak) * 100);
  }
  return mdd;
}

export function computeMetrics(args: {
  initialCapital: number;
  trades: Trade[];
  equity: EquityPoint[];
  periodsPerYear: number;
  exposurePct: number;
  buyAndHoldRoi: number | null;
}): BacktestMetrics {
  const { initialCapital, trades, equity, periodsPerYear } = args;
  const finalCapital = equity.length ? equity[equity.length - 1].equity : initialCapital;
  const netProfit = finalCapital - initialCapital;
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0));

  const eqVals = [initialCapital, ...equity.map((e) => e.equity)];
  const rets: number[] = [];
  for (let i = 1; i < eqVals.length; i++) rets.push(eqVals[i] / eqVals[i - 1] - 1);
  const m = mean(rets);
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / (rets.length - 1)) : NaN;
  const downside = rets.length ? Math.sqrt(rets.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / rets.length) : NaN;
  const sharpe = sd > 0 ? (m / sd) * Math.sqrt(periodsPerYear) : null;
  const sortino = downside > 0 ? (m / downside) * Math.sqrt(periodsPerYear) : null;

  const mdd = maxDrawdownPct(eqVals);
  const years = equity.length > 1 ? (equity[equity.length - 1].time - equity[0].time) / YEAR_MS : 0;
  const cagr = years > 0.05 && finalCapital > 0 ? (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100 : null;
  const calmar = cagr !== null && mdd < 0 ? cagr / Math.abs(mdd) : null;

  let maxConsec = 0;
  let cur = 0;
  for (const t of trades) {
    cur = t.netPnl <= 0 ? cur + 1 : 0;
    maxConsec = Math.max(maxConsec, cur);
  }
  const n = trades.length;
  const r = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? null : round(v, d));

  return {
    initialCapital,
    finalCapital: round(finalCapital, 2),
    netProfit: round(netProfit, 2),
    roi: round((netProfit / initialCapital) * 100, 2),
    cagr: r(cagr),
    totalTrades: n,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: n ? round((wins.length / n) * 100, 2) : null,
    averageWin: wins.length ? round(grossWin / wins.length, 2) : null,
    averageLoss: losses.length ? round(-grossLoss / losses.length, 2) : null,
    averageWinPct: wins.length ? round(mean(wins.map((t) => t.returnPct)), 2) : null,
    averageLossPct: losses.length ? round(mean(losses.map((t) => t.returnPct)), 2) : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : wins.length ? null : null,
    expectancy: n ? round((grossWin - grossLoss) / n, 2) : null,
    expectancyPct: n ? round(mean(trades.map((t) => t.returnPct)), 3) : null,
    maxDrawdown: round(mdd, 2),
    sharpe: r(sharpe),
    sortino: r(sortino),
    calmar: r(calmar),
    largestWin: wins.length ? round(Math.max(...wins.map((t) => t.netPnl)), 2) : null,
    largestLoss: losses.length ? round(Math.min(...losses.map((t) => t.netPnl)), 2) : null,
    averageHoldingMs: n ? Math.round(mean(trades.map((t) => t.holdingMs))) : null,
    totalFees: round(trades.reduce((a, t) => a + t.fees, 0), 2),
    totalSlippage: round(trades.reduce((a, t) => a + t.slippageCost, 0), 2),
    maxConsecutiveLosses: maxConsec,
    valueAtRisk95: rets.length >= 20 ? round(-percentile(rets, 0.05) * 100, 3) : null,
    exposurePct: round(args.exposurePct, 2),
    ambiguousTrades: trades.filter((t) => t.ambiguous).length,
    buyAndHoldRoi: r(args.buyAndHoldRoi),
    avgMfePct: n ? round(mean(trades.map((t) => t.mfePct)), 2) : null,
    avgMaePct: n ? round(mean(trades.map((t) => t.maePct)), 2) : null,
  };
}

export function monthlyReturns(equity: EquityPoint[], initialCapital: number): MonthlyReturn[] {
  const byMonth = new Map<string, number>();
  for (const e of equity) {
    const d = new Date(e.time);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, e.equity); // last equity of month
  }
  const out: MonthlyReturn[] = [];
  let prev = initialCapital;
  for (const [month, eq] of byMonth) {
    out.push({ month, returnPct: round(((eq - prev) / prev) * 100, 2) });
    prev = eq;
  }
  return out;
}

export function regimeBreakdown(trades: Trade[]): RegimeBreakdown[] {
  const groups: Record<string, Trade[]> = {
    'Bull Market': trades.filter((t) => t.regime === 'BULL'),
    'Bear Market': trades.filter((t) => t.regime === 'BEAR'),
    'Sideways Market': trades.filter((t) => t.regime === 'SIDEWAYS'),
    'High Volatility': trades.filter((t) => t.volatilityRegime === 'HIGH'),
    'Low Volatility': trades.filter((t) => t.volatilityRegime === 'LOW'),
  };
  return Object.entries(groups).map(([regime, ts]) => ({
    regime,
    trades: ts.length,
    winRate: ts.length ? round((ts.filter((t) => t.netPnl > 0).length / ts.length) * 100, 1) : null,
    avgReturnPct: ts.length ? round(mean(ts.map((t) => t.returnPct)), 2) : null,
  }));
}

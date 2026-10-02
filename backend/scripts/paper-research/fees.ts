// V2 rules under realistic costs: fee per side × compounding on/off, per period.
import { runPortfolio, summarize } from './pf.ts';
import { SPLITS } from './lib.ts';
import { STRATEGY_V2 } from '../../src/services/paper/strategy.ts';
import { MONEY_V2 } from '../../src/services/paper/portfolio.ts';
const periods: Record<string, readonly number[]> = { train: SPLITS.train, valid: SPLITS.valid, test: SPLITS.test, full: [SPLITS.train[0], SPLITS.test[1]] };
for (const fee of [0, 0.00075, 0.001]) for (const compounding of [false, true]) {
  const money = { ...MONEY_V2, feeRate: fee, compounding };
  const row = Object.entries(periods).map(([k, [a, b]]) => { const s = summarize(runPortfolio({ from: a, to: b, strat: STRATEGY_V2, money }).pf, 1e6); return `${k} PF=${s.profitFactor} ret=${s.returnPct}% DD=${s.maxDrawdownPct}% exp=${s.expectancyPct}%`; });
  console.log(`fee ${(fee * 100).toFixed(3)}%/sisi compounding=${compounding ? 'ON ' : 'OFF'} | ${row.join(' | ')}`);
}

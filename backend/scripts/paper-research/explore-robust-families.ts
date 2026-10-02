import { loadCands, backtest, stats, type Cand } from './lib.ts';
const C = loadCands().sort((a, b) => a.at - b.at);
const BUY = (c: Cand) => c.signal === 'BUY' || c.signal === 'STRONG_BUY';
const dip = (c: Cand) => (c.rsi < 35 || c.bbPctB < 0 || c.ema20Atr < -1.5);
const E: Record<string, (c: Cand) => boolean> = {
  'ALL': () => true, 'BUY': BUY, 'BUY coinBULL': (c) => BUY(c) && c.regime === 'BULL',
  'DIP': dip, 'DIP coin!BEAR': (c) => dip(c) && c.regime !== 'BEAR', 'DIP rsi<30': (c) => c.rsi < 30,
  'BREAKOUT hh20>0 vol>1.5': (c) => c.hh20Atr > 0 && c.volRatio > 1.5,
  'BREAKOUT coinBULL': (c) => c.hh20Atr > 0 && c.volRatio > 1.5 && c.regime === 'BULL',
  'PULLBACK coinBULL ema20<-1': (c) => c.regime === 'BULL' && c.ema20Atr < -1,
  'MOMO ret24h>2atr coinBULL': (c) => c.ret24h > 2 * c.atrPct && c.regime === 'BULL',
};
const B: Record<string, (c: Cand) => boolean> = {
  'any': () => true,
  'btc7d>0': (c) => c.btc.ret7d > 0, 'btc30d>0': (c) => c.btc.ret30d > 0, 'btc>sma30d': (c) => c.btc.aboveSma30d,
  'btc>sma30d&24h>0': (c) => c.btc.aboveSma30d && c.btc.ret24h > 0, 'btc7d>0&24h>0': (c) => c.btc.ret7d > 0 && c.btc.ret24h > 0,
  'btc>sma30d&7d>0': (c) => c.btc.aboveSma30d && c.btc.ret7d > 0, 'btc BULL&>sma30d': (c) => c.btc.regime === 'BULL' && c.btc.aboveSma30d,
};
const Xs = [{ tpAtr: 1, slAtr: 3, holdH: 12 }, { tpAtr: 0.75, slAtr: 2, holdH: 8 }, { tpAtr: 1, slAtr: 1.5, holdH: 12 }];
const out: string[] = [];
for (const [en, ef] of Object.entries(E)) for (const [bn, bf] of Object.entries(B)) for (const x of Xs) {
  const r = (['train', 'valid', 'test'] as const).map((sp) => stats(backtest(C, (c) => ef(c) && bf(c), x, sp)));
  const robust = r[0].pf > 1 && r[1].pf > 1 ? 'ROBUST(tr+va)' : '';
  out.push(`${(en + ' | ' + bn + ` | TP${x.tpAtr}/SL${x.slAtr}/${x.holdH}h`).padEnd(60)} ` + r.map((s, k) => `${['TR', 'VA', 'TE'][k]} n=${String(s.n).padStart(4)} TP=${s.tp.toFixed(0)}% SL=${s.sl.toFixed(0)}% avg=${s.avg.toFixed(3).padStart(6)} PF=${s.pf.toFixed(2)}`).join(' | ') + ' ' + robust);
}
console.log(out.join('\n'));

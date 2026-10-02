import { loadCands, backtest, stats, type Cand } from './lib.ts';
const C = loadCands().sort((a, b) => a.at - b.at);
const BUY = (c: Cand) => c.signal === 'BUY' || c.signal === 'STRONG_BUY';
const E: Record<string, (c: Cand) => boolean> = {
  'ALL (random)': () => true,
  'BUY': BUY,
  'BUY coin!BEAR': (c) => BUY(c) && c.regime !== 'BEAR',
  'BUY coinBULL': (c) => BUY(c) && c.regime === 'BULL',
  'score>=80': (c) => c.score >= 80,
  'PULLBACK emaUp,-1.5<ema20Atr<0,rsi<50': (c) => c.emaUp && c.ema20Atr < 0 && c.ema20Atr > -1.5 && c.rsi < 50,
  'PULLBACK coinBULL,ema20Atr<-1': (c) => c.regime === 'BULL' && c.ema20Atr < -1,
  'DIP rsi<30': (c) => c.rsi < 30,
  'DIP rsi<30 coin!BEAR': (c) => c.rsi < 30 && c.regime !== 'BEAR',
  'DIP bb<0 coinBULL': (c) => c.bbPctB < 0 && c.regime === 'BULL',
  'DIP ret4h<-2atr': (c) => c.ret4h < -2 * c.atrPct,
  'BREAKOUT hh20>0 vol>1.5': (c) => c.hh20Atr > 0 && c.volRatio > 1.5,
  'BREAKOUT hh20>0 vol>1.5 coinBULL': (c) => c.hh20Atr > 0 && c.volRatio > 1.5 && c.regime === 'BULL',
};
const B: Record<string, (c: Cand) => boolean> = {
  'btc:any': () => true,
  'btc:BULL': (c) => c.btc.regime === 'BULL',
  'btc:!BEAR': (c) => c.btc.regime !== 'BEAR',
  'btc:emaUp': (c) => c.btc.emaUp,
  'btc:>ema50': (c) => c.btc.aboveEma50,
  'btc:ret4h>0': (c) => c.btc.ret4h > 0,
  'btc:ret24h>0': (c) => c.btc.ret24h > 0,
  'btc:rsi>50': (c) => c.btc.rsi > 50,
  'btc:BEAR(!)': (c) => c.btc.regime === 'BEAR',
};
const X = [{ tpAtr: 0.5, slAtr: 1.5, holdH: 12 }, { tpAtr: 1, slAtr: 1, holdH: 12 }];
const rows: string[] = [];
for (const [en, ef] of Object.entries(E)) for (const [bn, bf] of Object.entries(B)) {
  const r = X.map((x) => stats(backtest(C, (c) => ef(c) && bf(c), x, 'train')));
  rows.push(`${(en + ' | ' + bn).padEnd(58)} TP.5/SL1.5: n=${String(r[0].n).padStart(5)} TP=${r[0].tp}% SL=${r[0].sl}% avg=${r[0].avg.toFixed(3)} PF=${r[0].pf} || TP1/SL1: TP=${r[1].tp}% SL=${r[1].sl}% avg=${r[1].avg.toFixed(3)} PF=${r[1].pf}`);
}
console.log(rows.join('\n'));

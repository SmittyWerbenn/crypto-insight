import { loadCands, backtest, stats, type Cand } from './lib.ts';
const C = loadCands().sort((a, b) => a.at - b.at);
const mk = (v: number) => (c: Cand) => c.hh20Atr > 0 && c.volRatio > v && c.regime === 'BULL' && c.btc.ret30d > 0;
console.log('### volume threshold sweep (TP0.75/SL2/8h)');
for (const v of [1.5, 2, 2.5, 3, 3.5, 4, 5]) {
  const r = (['train', 'valid', 'test'] as const).map((sp) => stats(backtest(C, mk(v), { tpAtr: 0.75, slAtr: 2, holdH: 8 }, sp)));
  console.log(`vol>${v}`.padEnd(8), r.map((s, k) => `${['TR', 'VA', 'TE'][k]} n=${String(s.n).padStart(4)} TP=${s.tp.toFixed(0)}% SL=${s.sl.toFixed(0)}% avg=${s.avg.toFixed(3)} PF=${s.pf.toFixed(2)}`).join(' | '));
}
const rule = mk(2.5);
console.log('### exit grid, vol>2.5. cells = avg% / SL% / PF  (TR | VA)');
const grid: any[] = [];
for (const h of [2, 4, 6, 8, 12, 24]) {
  console.log(`--- hold ${h}h`);
  for (const tp of [0.3, 0.5, 0.75, 1, 1.25, 1.5]) {
    const cells: string[] = [];
    for (const sl of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      const tr = stats(backtest(C, rule, { tpAtr: tp, slAtr: sl, holdH: h }, 'train'));
      const va = stats(backtest(C, rule, { tpAtr: tp, slAtr: sl, holdH: h }, 'valid'));
      grid.push({ tp, sl, h, tr, va });
      cells.push(`${tr.avg.toFixed(2)}/${tr.sl.toFixed(0)}|${va.avg.toFixed(2)}/${va.sl.toFixed(0)}`.padStart(22));
    }
    console.log(`TP${tp}`.padEnd(7), cells.join(''));
  }
}
console.log('### best by min(TR,VA) expectancy');
grid.sort((a, b) => Math.min(b.tr.avg, b.va.avg) - Math.min(a.tr.avg, a.va.avg));
for (const g of grid.slice(0, 15)) console.log(`TP${g.tp} SL${g.sl} ${g.h}h  TR TP=${g.tr.tp}% SL=${g.tr.sl}% avg=${g.tr.avg} PF=${g.tr.pf} hold=${g.tr.hold}h | VA TP=${g.va.tp}% SL=${g.va.sl}% avg=${g.va.avg} PF=${g.va.pf} hold=${g.va.hold}h`);
console.log('### CUTLOSS<=10% in both TR and VA with avg>0 in both');
for (const g of grid.filter((g) => g.tr.sl <= 10 && g.va.sl <= 10 && g.tr.avg > 0 && g.va.avg > 0).sort((a, b) => Math.min(b.tr.avg, b.va.avg) - Math.min(a.tr.avg, a.va.avg)).slice(0, 12)) console.log(`TP${g.tp} SL${g.sl} ${g.h}h  TR TP=${g.tr.tp}% SL=${g.tr.sl}% TO=${g.tr.to}% avg=${g.tr.avg} PF=${g.tr.pf} hold=${g.tr.hold}h | VA TP=${g.va.tp}% SL=${g.va.sl}% TO=${g.va.to}% avg=${g.va.avg} PF=${g.va.pf}`);

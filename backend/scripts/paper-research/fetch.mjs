import { writeFileSync, existsSync } from 'node:fs';
const [,, tf, startIso, outDir] = process.argv;
const syms = 'BTCUSDT ETHUSDT SOLUSDT BNBUSDT XRPUSDT DOGEUSDT ADAUSDT AVAXUSDT LINKUSDT NEARUSDT SUIUSDT HBARUSDT ENAUSDT WLDUSDT QNTUSDT MOVRUSDT AAVEUSDT UNIUSDT XLMUSDT ZECUSDT PUMPUSDT'.split(' ');
const end = Date.UTC(2026, 9, 2, 12); // closed candles up to 2026-10-02 12:00 UTC
async function get(u) { for (let k = 0; k < 6; k++) { try { const r = await fetch(u); if (r.ok) return r.json(); } catch {} await new Promise(r => setTimeout(r, 1000 * (k + 1))); } throw new Error('fail ' + u); }
async function one(s) {
  const f = `${outDir}/${s}.json`; if (existsSync(f)) return;
  let t = Date.parse(startIso); const rows = [];
  while (t < end) {
    const k = await get(`https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${tf}&startTime=${t}&limit=1000`);
    if (!k.length) break;
    for (const x of k) if (x[6] < end) rows.push([x[0], +x[1], +x[2], +x[3], +x[4], +x[5], +x[7]]);
    t = k[k.length - 1][0] + 1; if (k.length < 1000) break;
  }
  writeFileSync(f, JSON.stringify(rows)); console.log(s, rows.length);
}
const q = [...syms]; await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) await one(q.shift()); }));

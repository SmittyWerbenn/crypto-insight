import { asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { paperLedger, paperState, paperTrades } from '../../db/schema.js';
import { median } from '../../utils/math.js';
import { getTicker } from '../market/market.service.js';
import { loadPaperPortfolio, paperSettingsOf } from './engine.js';
import { MONEY_V2 } from './portfolio.js';
import { STRATEGY_V2 } from './strategy.js';

const TZ_OFFSET = 7 * 3_600_000; // WIB
const wibDate = (t: Date | number) => new Date(new Date(t).getTime() + TZ_OFFSET).toISOString().slice(0, 10);

type TradeRow = typeof paperTrades.$inferSelect;

export function tradeStats(trades: Pick<TradeRow, 'pnl' | 'pnlPct' | 'exitReason' | 'holdH'>[]) {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0);
  const gl = -losses.reduce((a, t) => a + t.pnl, 0);
  const pct = (k: string) => (n ? (trades.filter((t) => t.exitReason === k).length / n) * 100 : 0);
  return {
    trades: n,
    targetPct: pct('TARGET'),
    cutlossPct: pct('CUTLOSS'),
    timeoutPct: pct('TIMEOUT'),
    winRate: n ? (wins.length / n) * 100 : 0,
    avgPnl: n ? (gw - gl) / n : 0,
    medianPnl: n ? median(trades.map((t) => t.pnl)) : 0,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: losses.length ? -gl / losses.length : 0,
    /** Average net return per trade on the money put in, %. */
    expectancyPct: n ? trades.reduce((a, t) => a + t.pnlPct, 0) / n : 0,
    profitFactor: gl ? gw / gl : n ? null : 0,
    avgHoldH: n ? trades.reduce((a, t) => a + t.holdH, 0) / n : 0,
    maxHoldH: n ? Math.max(...trades.map((t) => t.holdH)) : 0,
  };
}

export async function paperSummary() {
  const pf = await loadPaperPortfolio();
  const db = getDb();
  const [st] = await db.select().from(paperState).where(eq(paperState.id, 1));
  const trades = await db.select().from(paperTrades);
  const base = MONEY_V2.baseCapital;
  const paidIn = base + pf.state.deposits;
  const positions = await Promise.all(
    pf.state.positions.map(async (p) => {
      const qty = p.layers.reduce((a, l) => a + l.qty, 0);
      const cost = p.layers.reduce((a, l) => a + l.cost, 0);
      const price = await getTicker(p.symbol)
        .then((t) => t.lastPrice)
        .catch(() => null);
      const value = price !== null ? qty * price : cost;
      return {
        id: p.id,
        symbol: p.symbol,
        cluster: p.cluster,
        openedAt: new Date(p.openedAt).toISOString(),
        timeoutAt: new Date(p.timeoutAt).toISOString(),
        entry: cost / qty,
        price,
        tp: p.tp,
        sl: p.sl,
        cost,
        value,
        unrealizedPnl: value - cost,
        unrealizedPct: ((value - cost) / cost) * 100,
        allocationPct: (cost / pf.sizingBase) * 100,
        layers: p.layers,
        meta: p.meta,
      };
    }),
  );
  const invested = positions.reduce((a, p) => a + p.cost, 0);
  const unrealized = positions.reduce((a, p) => a + p.unrealizedPnl, 0);
  const equity = pf.state.cash + invested + unrealized;
  const peak = Math.max(st.highWaterMark, equity);
  return {
    startedAt: st.startedAt.toISOString(),
    lastScanAt: st.lastScanAt?.toISOString() ?? null,
    baseCapital: base,
    deposits: pf.state.deposits,
    paidInCapital: paidIn,
    sizingBase: pf.sizingBase,
    feesPaid: pf.state.feesPaid,
    equity,
    cash: pf.state.cash,
    invested,
    realizedPnl: pf.state.realizedPnl,
    unrealizedPnl: unrealized,
    totalPnl: equity - paidIn,
    returnPct: ((equity - paidIn) / paidIn) * 100,
    peakEquity: peak,
    drawdownPct: ((equity - peak) / peak) * 100,
    maxDrawdownPct: Math.min(st.maxDrawdownPct, ((equity - peak) / peak) * 100),
    stats: tradeStats(trades),
    positions,
    config: { strategy: STRATEGY_V2, money: pf.cfg, settings: paperSettingsOf(st.config) },
  };
}

export async function paperTradesList(limit = 200, offset = 0) {
  const rows = await getDb().select().from(paperTrades).orderBy(desc(paperTrades.closedAt)).limit(limit).offset(offset);
  return rows.map((t) => ({ ...t, openedAt: t.openedAt.toISOString(), closedAt: t.closedAt.toISOString() }));
}

export async function paperEquity() {
  const rows = await getDb().select().from(paperLedger).orderBy(asc(paperLedger.time), asc(paperLedger.id));
  return rows.map((r) => ({ time: r.time.getTime(), event: r.event, symbol: r.symbol, equity: r.equity, cash: r.cash, invested: r.invested, realizedPnl: r.realizedPnl, unrealizedPnl: r.unrealizedPnl, drawdownPct: r.drawdownPct, highWaterMark: r.highWaterMark, openPositions: r.openPositions }));
}

/** Per WIB day: buys, sells, outcomes, realized P&L; equity carries over day to day (base capital never changes). */
export async function paperDaily() {
  const db = getDb();
  const trades = await db.select().from(paperTrades).orderBy(asc(paperTrades.closedAt));
  const flows = await db.select({ time: paperLedger.time, event: paperLedger.event, amount: paperLedger.amount }).from(paperLedger).where(inArray(paperLedger.event, ['BUY', 'TOPUP']));
  const days = new Map<string, { date: string; buys: number; sells: number; target: number; cutloss: number; timeout: number; pnl: number; fees: number; topUp: number }>();
  const day = (d: string) => days.get(d) ?? days.set(d, { date: d, buys: 0, sells: 0, target: 0, cutloss: 0, timeout: 0, pnl: 0, fees: 0, topUp: 0 }).get(d)!;
  for (const f of flows) {
    if (f.event === 'BUY') day(wibDate(f.time)).buys++;
    else day(wibDate(f.time)).topUp += f.amount;
  }
  for (const t of trades) {
    const d = day(wibDate(t.closedAt));
    d.sells++;
    d.pnl += t.pnl;
    d.fees += t.fees;
    if (t.exitReason === 'TARGET') d.target++;
    else if (t.exitReason === 'CUTLOSS') d.cutloss++;
    else d.timeout++;
  }
  let equity = MONEY_V2.baseCapital;
  return [...days.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => {
      const start = equity + d.topUp;
      equity = start + d.pnl;
      return { ...d, startEquity: start, endEquity: equity, returnPct: (d.pnl / start) * 100 };
    });
}

export async function paperAssets() {
  const trades = await getDb().select().from(paperTrades);
  const pf = await loadPaperPortfolio();
  const per = new Map<string, { symbol: string; cluster: string; trades: number; target: number; cutloss: number; timeout: number; invested: number; pnl: number; maxAllocation: number; openAllocation: number }>();
  const get = (s: string, c: string) => per.get(s) ?? per.set(s, { symbol: s, cluster: c, trades: 0, target: 0, cutloss: 0, timeout: 0, invested: 0, pnl: 0, maxAllocation: 0, openAllocation: 0 }).get(s)!;
  for (const t of trades) {
    const a = get(t.symbol, t.cluster);
    a.trades++;
    a.invested += t.cost;
    a.pnl += t.pnl;
    a.maxAllocation = Math.max(a.maxAllocation, t.cost);
    if (t.exitReason === 'TARGET') a.target++;
    else if (t.exitReason === 'CUTLOSS') a.cutloss++;
    else a.timeout++;
  }
  for (const p of pf.state.positions) get(p.symbol, p.cluster).openAllocation += p.layers.reduce((a, l) => a + l.cost, 0);
  return [...per.values()].map((a) => ({ ...a, returnPct: a.invested ? (a.pnl / a.invested) * 100 : 0 })).sort((a, b) => b.pnl - a.pnl);
}

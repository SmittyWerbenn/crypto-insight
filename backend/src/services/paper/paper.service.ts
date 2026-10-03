import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { paperLedger, paperScans, paperSignals, paperState, paperTrades } from '../../db/schema.js';
import { median } from '../../utils/math.js';
import { getTicker } from '../market/market.service.js';
import { loadPaperPortfolio, paperSettingsOf } from './engine.js';
import { MONEY_PROFILES } from './portfolio.js';
import { PROFILE_IDS, PROFILES, REJECT_LABEL, type ProfileId, type RejectCode } from './strategy.js';

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

export async function paperSummary(profile: ProfileId) {
  const pf = await loadPaperPortfolio(profile);
  const db = getDb();
  const [st] = await db.select().from(paperState).where(eq(paperState.profile, profile));
  const trades = await db.select().from(paperTrades).where(eq(paperTrades.profile, profile));
  const base = MONEY_PROFILES[profile].baseCapital;
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
    profile,
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
    config: { strategy: PROFILES[profile], money: pf.cfg, settings: paperSettingsOf(st.config) },
  };
}

export async function paperTradesList(profile: ProfileId, limit = 200, offset = 0) {
  const rows = await getDb().select().from(paperTrades).where(eq(paperTrades.profile, profile)).orderBy(desc(paperTrades.closedAt)).limit(limit).offset(offset);
  return rows.map((t) => ({ ...t, openedAt: t.openedAt.toISOString(), closedAt: t.closedAt.toISOString() }));
}

export async function paperEquity(profile: ProfileId) {
  const rows = await getDb().select().from(paperLedger).where(eq(paperLedger.profile, profile)).orderBy(asc(paperLedger.time), asc(paperLedger.id));
  return rows.map((r) => ({ time: r.time.getTime(), event: r.event, symbol: r.symbol, equity: r.equity, cash: r.cash, invested: r.invested, realizedPnl: r.realizedPnl, unrealizedPnl: r.unrealizedPnl, drawdownPct: r.drawdownPct, highWaterMark: r.highWaterMark, openPositions: r.openPositions }));
}

/** Per WIB day: buys, sells, outcomes, realized P&L; equity carries over day to day (base capital never changes). */
export async function paperDaily(profile: ProfileId) {
  const db = getDb();
  const trades = await db.select().from(paperTrades).where(eq(paperTrades.profile, profile)).orderBy(asc(paperTrades.closedAt));
  const flows = await db
    .select({ time: paperLedger.time, event: paperLedger.event, amount: paperLedger.amount })
    .from(paperLedger)
    .where(and(eq(paperLedger.profile, profile), inArray(paperLedger.event, ['BUY', 'TOPUP'])));
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
  let equity = MONEY_PROFILES[profile].baseCapital;
  return [...days.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => {
      const start = equity + d.topUp;
      equity = start + d.pnl;
      return { ...d, startEquity: start, endEquity: equity, returnPct: (d.pnl / start) * 100 };
    });
}

export async function paperAssets(profile: ProfileId) {
  const trades = await getDb().select().from(paperTrades).where(eq(paperTrades.profile, profile));
  const pf = await loadPaperPortfolio(profile);
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

/** Capital utilization from the hourly marks: how much of the equity was actually invested. */
async function utilization(profile: ProfileId) {
  const rows = await getDb()
    .select({ invested: paperLedger.invested, cash: paperLedger.cash, equity: paperLedger.equity })
    .from(paperLedger)
    .where(and(eq(paperLedger.profile, profile), inArray(paperLedger.event, ['MARK', 'START'])));
  const n = rows.length || 1;
  const inv = rows.map((r) => (r.equity ? r.invested / r.equity : 0));
  return {
    marks: rows.length,
    avgInvestedPct: (100 * inv.reduce((a, b) => a + b, 0)) / n,
    maxInvestedPct: 100 * Math.max(0, ...inv),
    avgInvested: rows.reduce((a, r) => a + r.invested, 0) / n,
    maxInvested: Math.max(0, ...rows.map((r) => r.invested)),
    avgCashPct: (100 * rows.reduce((a, r) => a + (r.equity ? r.cash / r.equity : 1), 0)) / n,
    hoursInvestedPct: (100 * inv.filter((v) => v > 0).length) / n,
  };
}

/**
 * Side-by-side view of the three profiles: signal funnel (available → accepted → bought), rejection reasons,
 * outcomes, P&L, drawdown and capital utilization. `sinceHours` limits the signal funnel window.
 */
export async function paperCompare(sinceHours?: number) {
  const db = getDb();
  // Only count scans since the profile accounts exist (older scans belong to the single-account V2 run)
  const [first] = await db.select({ t: sql<Date>`min(${paperState.startedAt})` }).from(paperState).where(inArray(paperState.profile, PROFILE_IDS));
  const start = first?.t ? new Date(first.t).getTime() : 0;
  const since = new Date(Math.max(start, sinceHours ? Date.now() - sinceHours * 3_600_000 : 0));
  const scans = await db
    .select({ n: sql<number>`count(*)::int`, withSignal: sql<number>`count(*) filter (where ${paperScans.signals} > 0)::int`, signals: sql<number>`coalesce(sum(${paperScans.signals}), 0)::int` })
    .from(paperScans)
    .where(gte(paperScans.time, since));
  const decisions = await db
    .select({ profile: paperSignals.profile, decision: paperSignals.decision, stage: paperSignals.stage, reasons: paperSignals.reasons })
    .from(paperSignals)
    .where(gte(paperSignals.time, since));
  const profiles = [];
  for (const profile of PROFILE_IDS) {
    const mine = decisions.filter((d) => d.profile === profile);
    const reasons: Partial<Record<RejectCode, number>> = {};
    const primary: Partial<Record<RejectCode, number>> = {};
    for (const d of mine) {
      if (d.decision !== 'REJECT') continue;
      const rs = d.reasons as { code: RejectCode }[];
      if (rs[0]) primary[rs[0].code] = (primary[rs[0].code] ?? 0) + 1;
      for (const r of rs) reasons[r.code] = (reasons[r.code] ?? 0) + 1;
    }
    const summary = await paperSummary(profile);
    const signals = mine.length;
    const ruleRejected = mine.filter((d) => d.stage === 'RULE').length;
    const accepted = signals - ruleRejected;
    const entered = mine.filter((d) => d.decision === 'ACCEPT').length;
    profiles.push({
      profile,
      funnel: { signals, ruleRejected, accepted, acceptedPct: signals ? (accepted / signals) * 100 : 0, moneyRejected: accepted - entered, entered },
      reasons: Object.entries(reasons)
        .map(([code, n]) => ({ code, label: REJECT_LABEL[code as RejectCode], n, primary: primary[code as RejectCode] ?? 0 }))
        .sort((a, b) => b.n - a.n),
      stats: summary.stats,
      equity: summary.equity,
      totalPnl: summary.totalPnl,
      returnPct: summary.returnPct,
      maxDrawdownPct: summary.maxDrawdownPct,
      openPositions: summary.positions.length,
      cash: summary.cash,
      invested: summary.invested,
      feesPaid: summary.feesPaid,
      startedAt: summary.startedAt,
      utilization: await utilization(profile),
    });
  }
  return { since: since.toISOString(), scans: scans[0], profiles };
}

/** Recent breakout signals with every profile's decision side by side. */
export async function paperSignalLog(limit = 100) {
  const rows = await getDb().select().from(paperSignals).orderBy(desc(paperSignals.time), desc(paperSignals.id)).limit(limit * PROFILE_IDS.length);
  const bySignal = new Map<string, { time: string; symbol: string; features: unknown; decisions: Partial<Record<ProfileId, { decision: string; stage: string; reasons: unknown }>> }>();
  for (const r of rows) {
    const key = `${r.time.getTime()}:${r.symbol}`;
    const s = bySignal.get(key) ?? bySignal.set(key, { time: r.time.toISOString(), symbol: r.symbol, features: r.features, decisions: {} }).get(key)!;
    s.decisions[r.profile as ProfileId] = { decision: r.decision, stage: r.stage, reasons: r.reasons };
  }
  return [...bySignal.values()].slice(0, limit);
}

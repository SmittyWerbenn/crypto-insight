import { asc, desc, eq } from 'drizzle-orm';
import { getDb, isDbReady } from '../../db/client.js';
import { paperLedger, paperPositions, paperScans, paperState, paperTrades } from '../../db/schema.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { cache } from '../cache/cache.js';
import { getCandles } from '../market/candles.service.js';
import { getTicker } from '../market/market.service.js';
import { FeatureSeries } from './features.js';
import { MONEY_V2, PaperPortfolio, type ClosedTrade, type Layer, type LedgerRow, type Position } from './portfolio.js';
import { entryCheck, levelsFor, STRATEGY_V2, UNIVERSE_V2 } from './strategy.js';

/**
 * Live Paper Trading V2 engine. Runs the exact rules of the research backtest:
 *  - every 5 minutes: walk each open position through the newly closed 5m candles (stop before target in a tie,
 *    timeout at the hold limit) — same as the backtest's exit simulation;
 *  - every hour, right after the 1h candle closes: compute features on closed candles, apply the entry rules,
 *    buy the strongest volume breakouts at the live price within the money-management caps, then mark to market.
 */
const STATE_ID = 1;
const LOCK = 'paper:lock';
const H = 3_600_000;
const M5 = 300_000;

async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!isDbReady()) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Paper Trading membutuhkan database (DATABASE_URL).');
  if ((await cache.get<boolean>(LOCK)) === true) return null;
  await cache.set(LOCK, true, 10 * 60);
  try {
    return await fn();
  } finally {
    await cache.del(LOCK);
  }
}

/** Load the account (creating it with the base capital on first use). */
async function load(at = Date.now()): Promise<PaperPortfolio> {
  const db = getDb();
  let [st] = await db.select().from(paperState).where(eq(paperState.id, STATE_ID));
  if (!st) {
    const now = new Date(at);
    [st] = await db
      .insert(paperState)
      .values({ id: STATE_ID, startedAt: now, config: { strategy: STRATEGY_V2, money: MONEY_V2 }, cash: MONEY_V2.baseCapital, highWaterMark: MONEY_V2.baseCapital })
      .returning();
    const b = MONEY_V2.baseCapital;
    await db.insert(paperLedger).values({ time: now, event: 'START', symbol: null, amount: b, cash: b, invested: 0, realizedPnl: 0, unrealizedPnl: 0, equity: b, openPositions: 0, highWaterMark: b, drawdownPct: 0 });
    logger.info({ base: b }, 'Paper Trading V2 started');
  }
  const rows = await db.select().from(paperPositions).orderBy(asc(paperPositions.openedAt));
  const positions: Position[] = rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    cluster: r.cluster,
    openedAt: r.openedAt.getTime(),
    plannedCost: r.plannedCost,
    layers: r.layers as Layer[],
    tp: r.tp,
    sl: r.sl,
    timeoutAt: r.timeoutAt.getTime(),
    atrPct: r.atrPct,
    high: r.high,
    low: r.low,
    meta: r.meta as Record<string, unknown>,
    lastBarTime: r.lastBarTime,
  }));
  return new PaperPortfolio(MONEY_V2, { cash: st.cash, realizedPnl: st.realizedPnl, highWaterMark: st.highWaterMark, maxDrawdownPct: st.maxDrawdownPct, positions, seq: st.seq });
}

/** Write back the account, the open positions, and everything the portfolio logged since it was loaded. */
async function save(pf: PaperPortfolio, scanAt?: Date) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const s = pf.state;
    await tx
      .update(paperState)
      .set({ cash: s.cash, realizedPnl: s.realizedPnl, highWaterMark: s.highWaterMark, maxDrawdownPct: s.maxDrawdownPct, seq: s.seq, updatedAt: new Date(), ...(scanAt ? { lastScanAt: scanAt } : {}) })
      .where(eq(paperState.id, STATE_ID));
    await tx.delete(paperPositions);
    if (s.positions.length)
      await tx.insert(paperPositions).values(
        s.positions.map((p) => ({
          id: p.id,
          symbol: p.symbol,
          cluster: p.cluster,
          openedAt: new Date(p.openedAt),
          plannedCost: p.plannedCost,
          layers: p.layers,
          tp: p.tp,
          sl: p.sl,
          timeoutAt: new Date(p.timeoutAt),
          atrPct: p.atrPct,
          high: p.high,
          low: p.low,
          meta: p.meta,
          lastBarTime: p.lastBarTime ?? p.openedAt - M5,
        })),
      );
    if (pf.closed.length) await tx.insert(paperTrades).values(pf.closed.map(tradeRow));
    if (pf.ledger.length) await tx.insert(paperLedger).values(pf.ledger.map(ledgerRow));
  });
}

const tradeRow = (t: ClosedTrade) => ({
  id: t.id,
  symbol: t.symbol,
  cluster: t.cluster,
  openedAt: new Date(t.openedAt),
  closedAt: new Date(t.closedAt),
  qty: t.qty,
  avgEntry: t.avgEntry,
  cost: t.cost,
  exitPrice: t.exitPrice,
  exitReason: t.exitReason,
  pnl: t.pnl,
  pnlPct: t.pnlPct,
  holdH: t.holdH,
  mfePct: t.mfePct,
  maePct: t.maePct,
  tp: t.tp,
  sl: t.sl,
  layers: t.layers,
  meta: t.meta,
  cashAfter: t.cashAfter,
  equityAfter: t.equityAfter,
});

const ledgerRow = (r: LedgerRow) => ({ ...r, time: new Date(r.time) });

async function livePrice(symbol: string): Promise<number | null> {
  return getTicker(symbol)
    .then((t) => (t.lastPrice > 0 ? t.lastPrice : null))
    .catch(() => null);
}

/** Walk open positions through newly closed 5m candles. Returns how many positions were closed. */
async function processExits(pf: PaperPortfolio, now: number): Promise<number> {
  let closed = 0;
  for (const p of [...pf.state.positions]) {
    const from = (p.lastBarTime ?? p.openedAt - M5) + M5;
    let bars: Awaited<ReturnType<typeof getCandles>> = [];
    try {
      bars = (await getCandles(p.symbol, '5m', { startTime: from, endTime: now })).filter((c) => c.openTime >= from && c.closeTime < now);
    } catch (e) {
      logger.warn({ symbol: p.symbol, err: (e as Error).message }, 'Paper: 5m candles unavailable');
    }
    let done = false;
    for (const b of bars) {
      if (b.openTime >= p.timeoutAt) {
        pf.close(p, p.timeoutAt, b.open, 'TIMEOUT');
        done = true;
        break;
      }
      p.lastBarTime = b.openTime;
      // Same bar touching both levels counts as the stop (conservative, identical to the backtest)
      if (b.low <= p.sl) {
        p.low = Math.min(p.low, p.sl);
        pf.close(p, b.openTime + M5, p.sl, 'CUTLOSS');
        done = true;
        break;
      }
      if (b.high >= p.tp) {
        p.high = Math.max(p.high, p.tp);
        pf.close(p, b.openTime + M5, p.tp, 'TARGET');
        done = true;
        break;
      }
      p.high = Math.max(p.high, b.high);
      p.low = Math.min(p.low, b.low);
    }
    if (!done && now >= p.timeoutAt) {
      const px = (await livePrice(p.symbol)) ?? p.layers[0].price;
      pf.close(p, now, px, 'TIMEOUT');
      done = true;
    }
    if (done) closed++;
  }
  return closed;
}

async function markPrices(pf: PaperPortfolio): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  for (const p of pf.state.positions) {
    const px = await livePrice(p.symbol);
    if (px !== null) prices[p.symbol] = px;
  }
  return prices;
}

/** 5-minute job: TP / CUTLOSS / TIMEOUT for open positions. */
export async function monitorPaper(): Promise<{ closed: number } | null> {
  return withLock(async () => {
    const pf = await load();
    if (!pf.state.positions.length) return { closed: 0 };
    const closed = await processExits(pf, Date.now());
    await save(pf);
    if (closed) logger.info({ closed }, 'Paper: positions closed');
    return { closed };
  });
}

export interface ScanResult {
  time: string;
  btc: Record<string, unknown> | null;
  scanned: number;
  signals: number;
  entries: { symbol: string; price: number; amount: number; allocationPct: number; tp: number; sl: number }[];
  skipped: { symbol: string; reason: string }[];
  note: string | null;
}

/** Hourly job: exits, then entries on the candle that just closed, then an equity-curve point. */
export async function scanPaper(): Promise<ScanResult | null> {
  return withLock(async () => {
    const now = Date.now();
    const lastClosedOpen = Math.floor(now / H) * H - H;
    const pf = await load(now);
    await processExits(pf, now);

    const feats: { symbol: string; fs: FeatureSeries; i: number }[] = [];
    for (const symbol of UNIVERSE_V2) {
      try {
        const candles = await getCandles(symbol, '1h', { limit: 1000 });
        const i = candles.length - 1;
        if (i < 0 || candles[i].openTime !== lastClosedOpen) continue; // stale data → skip this coin
        feats.push({ symbol, fs: new FeatureSeries(candles), i });
      } catch (e) {
        logger.warn({ symbol, err: (e as Error).message }, 'Paper: 1h candles unavailable');
      }
    }
    const btcRow = feats.find((f) => f.symbol === 'BTCUSDT');
    const btc = btcRow ? btcRow.fs.btcAt(btcRow.i) : null;
    const entries: ScanResult['entries'] = [];
    const skipped: ScanResult['skipped'] = [];
    let note: string | null = null;
    let signals = 0;
    if (!btc) note = 'Data BTC tidak tersedia — tidak ada entry jam ini.';
    else {
      const ok = feats
        .map((f) => ({ symbol: f.symbol, f: f.fs.at(f.i) }))
        .filter((x): x is { symbol: string; f: NonNullable<typeof x.f> } => x.f !== null)
        .map((x) => ({ ...x, why: entryCheck(x.f, btc) }));
      const pass = ok.filter((x) => x.why === null).sort((a, b) => b.f.volRatio - a.f.volRatio);
      signals = pass.length;
      if (btc.ret30d <= STRATEGY_V2.btcRet30dMin) note = `HOLD CASH — BTC turun ${btc.ret30d.toFixed(1)}% dalam 30 hari (filter tren makro).`;
      else if (!pass.length) note = 'HOLD CASH — tidak ada koin yang breakout dengan volume ≥ 3x di regime BULL.';
      // Near misses are useful context: coins that passed the trend filters but not the breakout/volume rule
      for (const x of ok.filter((x) => x.why !== null && x.f.regime === 'BULL').slice(0, 6)) skipped.push({ symbol: x.symbol, reason: x.why! });
      for (const x of pass) {
        const price = await livePrice(x.symbol);
        if (price === null) {
          skipped.push({ symbol: x.symbol, reason: 'Harga live tidak tersedia' });
          continue;
        }
        const lv = levelsFor(price, x.f.atrPct);
        const base = pf.cfg.baseCapital;
        const r = pf.open({
          symbol: x.symbol,
          time: now,
          price,
          tp: lv.tp,
          sl: lv.sl,
          slPct: lv.slPct,
          atrPct: x.f.atrPct,
          maxHoldH: STRATEGY_V2.maxHoldH,
          meta: {
            signal: x.f.signal,
            score: Math.round(x.f.score * 10) / 10,
            coinRegime: x.f.regime,
            btcRegime: btc.regime,
            btcRet30d: btc.ret30d,
            btcRet24h: btc.ret24h,
            atrPct: x.f.atrPct,
            atrPctile: x.f.atrPctile,
            rsi: x.f.rsi,
            macdHist: x.f.macdHist,
            volRatio: x.f.volRatio,
            momentum4h: x.f.ret4h,
            breakoutAtr: x.f.hh20Atr,
            signalClose: x.f.close,
            entryLayer: '1/1 (full entry)',
            tpPct: lv.tpPct,
            slPct: lv.slPct,
            timeoutH: STRATEGY_V2.maxHoldH,
          },
        });
        if (r.reason || !r.position) {
          skipped.push({ symbol: x.symbol, reason: r.reason ?? 'Ditolak' });
          continue;
        }
        const p = r.position;
        p.lastBarTime = Math.floor(now / M5) * M5 - M5;
        const invested = pf.invested;
        const clusterCost = pf.state.positions.filter((q) => q.cluster === p.cluster).reduce((a, q) => a + q.layers.reduce((b, l) => b + l.cost, 0), 0);
        Object.assign(p.meta, {
          allocationPct: (p.layers[0].cost / base) * 100,
          allocationIdr: p.layers[0].cost,
          riskIdr: base * pf.cfg.riskPerTrade,
          portfolioExposurePct: (invested / base) * 100,
          clusterExposurePct: (clusterCost / base) * 100,
          cashRemaining: pf.state.cash,
          equityAtEntry: pf.equity(),
        });
        entries.push({ symbol: x.symbol, price, amount: p.layers[0].cost, allocationPct: (p.layers[0].cost / base) * 100, tp: lv.tp, sl: lv.sl });
      }
    }
    pf.mark(now, await markPrices(pf));
    await save(pf, new Date(now));
    const res: ScanResult = { time: new Date(now).toISOString(), btc: btc as unknown as Record<string, unknown>, scanned: feats.length, signals, entries, skipped, note };
    await getDb().insert(paperScans).values({ time: new Date(now), btc: res.btc, scanned: res.scanned, signals, entries, skipped, note });
    logger.info({ scanned: feats.length, signals, entries: entries.map((e) => e.symbol) }, 'Paper scan complete');
    return res;
  });
}

export async function latestScans(limit = 24) {
  return (await getDb().select().from(paperScans).orderBy(desc(paperScans.id)).limit(limit)).map((s) => ({ ...s, time: s.time.toISOString() }));
}

export { load as loadPaperPortfolio };

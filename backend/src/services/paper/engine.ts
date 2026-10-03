import { asc, desc, eq } from 'drizzle-orm';
import { getDb, isDbReady } from '../../db/client.js';
import { paperLedger, paperPositions, paperScans, paperSignals, paperState, paperTrades } from '../../db/schema.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { cache } from '../cache/cache.js';
import { getCandles } from '../market/candles.service.js';
import { getTicker } from '../market/market.service.js';
import { FeatureSeries, type BtcContext, type CoinFeatures } from './features.js';
import { MONEY_PROFILES, MONEY_V2, PaperPortfolio, type ClosedTrade, type Layer, type LedgerRow, type MoneyConfig, type Position } from './portfolio.js';
import { btcState, isSignal, levelsFor, priceMoved, PROFILE_IDS, PROFILE_LABEL, PROFILES, rejectReasons, UNIVERSE_V2, type ProfileId, type Rejection } from './strategy.js';

/**
 * Live Paper Trading V2 engine: three accounts (Aman, Menengah, Agresif), Rp1.000.000 each, same market data.
 * Runs the exact rules of the research backtest:
 *  - every 5 minutes: walk each open position through the newly closed 5m candles (stop before target in a tie,
 *    timeout at the hold limit) — same as the backtest's exit simulation;
 *  - every hour, right after the 1h candle closes: compute features on closed candles, find the breakout signals,
 *    let each profile accept or reject every signal (rules, then money caps), record the decision and its reasons,
 *    buy the accepted ones at the live price, then mark to market.
 */
const STATE_ID: Record<ProfileId, number> = {
  AMAN: 2,
  MENENGAH: 3,
  AGRESIF: 4,
};
const ID_PREFIX: Record<ProfileId, string> = {
  AMAN: 'AM-',
  MENENGAH: 'MN-',
  AGRESIF: 'AG-',
};
const LOCK = 'paper:lock';
const H = 3_600_000;
const M5 = 300_000;

/** User-adjustable money settings, stored in paper_state.config.settings. */
export interface PaperSettings {
  feeRate: number;
  compounding: boolean;
}
const settingsOf = (config: unknown): PaperSettings => {
  const s = ((config ?? {}) as { settings?: Partial<PaperSettings> }).settings ?? {};
  return {
    feeRate: s.feeRate ?? MONEY_V2.feeRate,
    compounding: s.compounding ?? MONEY_V2.compounding,
  };
};
export const moneyFor = (profile: ProfileId, config: unknown): MoneyConfig => ({
  ...MONEY_PROFILES[profile],
  ...settingsOf(config),
});

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

/** Load one profile's account (creating it with the base capital on first use). */
async function load(profile: ProfileId, at = Date.now()): Promise<PaperPortfolio> {
  const db = getDb();
  let [st] = await db.select().from(paperState).where(eq(paperState.profile, profile));
  if (!st) {
    const now = new Date(at);
    // New accounts inherit the fee / compounding settings already chosen for the other profiles
    const [other] = await db.select().from(paperState).limit(1);
    const settings = settingsOf(other?.config);
    const money = MONEY_PROFILES[profile];
    [st] = await db
      .insert(paperState)
      .values({
        id: STATE_ID[profile],
        profile,
        startedAt: now,
        config: { strategy: PROFILES[profile], money, settings },
        cash: money.baseCapital,
        highWaterMark: money.baseCapital,
      })
      .returning();
    const b = money.baseCapital;
    await db.insert(paperLedger).values({
      profile,
      time: now,
      event: 'START',
      symbol: null,
      amount: b,
      cash: b,
      invested: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      equity: b,
      openPositions: 0,
      highWaterMark: b,
      drawdownPct: 0,
    });
    logger.info({ profile, base: b }, 'Paper Trading profile started');
  }
  const rows = await db.select().from(paperPositions).where(eq(paperPositions.profile, profile)).orderBy(asc(paperPositions.openedAt));
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
  return new PaperPortfolio(
    moneyFor(profile, st.config),
    {
      cash: st.cash,
      realizedPnl: st.realizedPnl,
      highWaterMark: st.highWaterMark,
      maxDrawdownPct: st.maxDrawdownPct,
      positions,
      seq: st.seq,
      deposits: st.deposits,
      feesPaid: st.feesPaid,
    },
    ID_PREFIX[profile],
  );
}

const loadAll = async (at = Date.now()) => {
  const out = {} as Record<ProfileId, PaperPortfolio>;
  for (const p of PROFILE_IDS) out[p] = await load(p, at);
  return out;
};

/** Write back the account, the open positions, and everything the portfolio logged since it was loaded. */
async function save(profile: ProfileId, pf: PaperPortfolio, scanAt?: Date) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const s = pf.state;
    await tx
      .update(paperState)
      .set({
        cash: s.cash,
        realizedPnl: s.realizedPnl,
        highWaterMark: s.highWaterMark,
        maxDrawdownPct: s.maxDrawdownPct,
        seq: s.seq,
        deposits: s.deposits,
        feesPaid: s.feesPaid,
        updatedAt: new Date(),
        ...(scanAt ? { lastScanAt: scanAt } : {}),
      })
      .where(eq(paperState.profile, profile));
    await tx.delete(paperPositions).where(eq(paperPositions.profile, profile));
    if (s.positions.length)
      await tx.insert(paperPositions).values(
        s.positions.map((p) => ({
          id: p.id,
          profile,
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
    if (pf.closed.length) await tx.insert(paperTrades).values(pf.closed.map((t) => ({ ...tradeRow(t), profile })));
    if (pf.ledger.length) await tx.insert(paperLedger).values(pf.ledger.map((r) => ({ ...ledgerRow(r), profile })));
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
  fees: t.fees,
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
    let closed = 0;
    for (const profile of PROFILE_IDS) {
      const pf = await load(profile);
      if (!pf.state.positions.length) continue;
      const n = await processExits(pf, Date.now());
      await save(profile, pf);
      if (n) logger.info({ profile, closed: n }, 'Paper: positions closed');
      closed += n;
    }
    return { closed };
  });
}

export interface ScanEntry {
  profile: ProfileId;
  symbol: string;
  price: number;
  amount: number;
  allocationPct: number;
  tp: number;
  sl: number;
}
export interface ScanResult {
  time: string;
  btc: Record<string, unknown> | null;
  scanned: number;
  /** Breakout signals this hour (before any profile filter). */
  signals: number;
  /** Per profile: signals accepted by the rules, bought, rejected. */
  profiles: Record<ProfileId, { accepted: number; entered: number; rejected: number; note: string }>;
  entries: ScanEntry[];
  skipped: { profile: ProfileId; symbol: string; reason: string }[];
  note: string | null;
}

/** Highest profile whose rules accept the signal: the setup quality grade shown in the signal log. */
function qualityOf(f: CoinFeatures, btc: BtcContext): ProfileId | 'DI_BAWAH_MINIMUM' {
  for (const p of PROFILE_IDS) if (rejectReasons(f, btc, PROFILES[p]).length === 0) return p;
  return 'DI_BAWAH_MINIMUM';
}

/**
 * Every profile judges every signal (strongest volume first): rule filters → price check → money caps → buy.
 * Pure apart from the portfolios it mutates, so it is unit-tested without a database or live market.
 */
export async function judgeSignals(o: { now: number; btc: BtcContext; signals: { symbol: string; f: CoinFeatures }[]; pfs: Record<ProfileId, PaperPortfolio>; priceOf: (symbol: string) => Promise<number | null> }) {
  const { now, btc, signals, pfs, priceOf } = o;
  const entries: ScanEntry[] = [];
  const skipped: ScanResult['skipped'] = [];
  const decisions: (typeof paperSignals.$inferInsert)[] = [];
  const profiles = Object.fromEntries(PROFILE_IDS.map((p) => [p, { accepted: 0, entered: 0, rejected: 0, note: '' }])) as ScanResult['profiles'];
  for (const x of signals) {
    const features = {
      signalClose: x.f.close,
      score: Math.round(x.f.score * 10) / 10,
      signal: x.f.signal,
      volRatio: x.f.volRatio,
      atrPct: x.f.atrPct,
      breakoutAtr: x.f.hh20Atr,
      coinRegime: x.f.regime,
      emaUp: x.f.emaUp,
      rsi: x.f.rsi,
      btcState: btcState(btc),
      btcRet30d: btc.ret30d,
      quality: qualityOf(x.f, btc),
    };
    for (const profile of PROFILE_IDS) {
      const pf = pfs[profile];
      const cfg = PROFILES[profile];
      const record = (decision: 'ACCEPT' | 'REJECT', stage: 'RULE' | 'MONEY' | 'ENTRY', reasons: Rejection[]) =>
        decisions.push({
          time: new Date(now),
          symbol: x.symbol,
          profile,
          decision,
          stage,
          reasons,
          features,
        });
      const rule = rejectReasons(x.f, btc, cfg);
      if (rule.length) {
        profiles[profile].rejected++;
        record('REJECT', 'RULE', rule);
        continue;
      }
      profiles[profile].accepted++;
      const price = await priceOf(x.symbol);
      const moved = price === null ? { code: 'NO_PRICE' as const, detail: 'Harga live tidak tersedia' } : priceMoved(x.f.close, price, x.f.atrPct);
      if (moved || price === null) {
        profiles[profile].rejected++;
        record('REJECT', 'MONEY', [moved!]);
        skipped.push({ profile, symbol: x.symbol, reason: moved!.detail });
        continue;
      }
      const lv = levelsFor(price, x.f.atrPct, cfg);
      const base = pf.sizingBase;
      const r = pf.open({
        symbol: x.symbol,
        time: now,
        price,
        tp: lv.tp,
        sl: lv.sl,
        slPct: lv.slPct,
        atrPct: x.f.atrPct,
        maxHoldH: cfg.maxHoldH,
        meta: {
          profile,
          ...features,
          btcRegime: btc.regime,
          btcRet24h: btc.ret24h,
          atrPctile: x.f.atrPctile,
          macdHist: x.f.macdHist,
          momentum4h: x.f.ret4h,
          entryLayer: '1/1 (full entry)',
          tpPct: lv.tpPct,
          slPct: lv.slPct,
          timeoutH: cfg.maxHoldH,
        },
      });
      if (r.code || !r.position) {
        profiles[profile].rejected++;
        record('REJECT', 'MONEY', [{ code: r.code ?? 'CASH', detail: r.reason ?? 'Ditolak' }]);
        skipped.push({
          profile,
          symbol: x.symbol,
          reason: r.reason ?? 'Ditolak',
        });
        continue;
      }
      const p = r.position;
      p.lastBarTime = Math.floor(now / M5) * M5 - M5;
      const invested = pf.invested;
      const clusterCost = pf.state.positions.filter((q) => q.cluster === p.cluster).reduce((a, q) => a + q.layers.reduce((b, l) => b + l.cost, 0), 0);
      Object.assign(p.meta, {
        allocationPct: (p.layers[0].cost / base) * 100,
        allocationIdr: p.layers[0].cost,
        riskIdr: Math.min(base * pf.cfg.riskPerTrade, p.layers[0].cost * (lv.slPct / 100)),
        sizingBase: base,
        compounding: pf.cfg.compounding,
        feeRate: pf.cfg.feeRate,
        entryFee: p.layers[0].fee ?? 0,
        portfolioExposurePct: (invested / base) * 100,
        clusterExposurePct: (clusterCost / base) * 100,
        cashRemaining: pf.state.cash,
        equityAtEntry: pf.equity(),
      });
      profiles[profile].entered++;
      record('ACCEPT', 'ENTRY', []);
      entries.push({
        profile,
        symbol: x.symbol,
        price,
        amount: p.layers[0].cost,
        allocationPct: (p.layers[0].cost / base) * 100,
        tp: lv.tp,
        sl: lv.sl,
      });
    }
  }
  return { entries, skipped, decisions, profiles };
}

/** Hourly job: exits, then each profile judges the breakout signals of the candle that just closed, then an equity-curve point. */
export async function scanPaper(): Promise<ScanResult | null> {
  return withLock(async () => {
    const now = Date.now();
    const lastClosedOpen = Math.floor(now / H) * H - H;
    const pfs = await loadAll(now);
    for (const p of PROFILE_IDS) await processExits(pfs[p], now);

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
    const entries: ScanEntry[] = [];
    const skipped: ScanResult['skipped'] = [];
    const decisions: (typeof paperSignals.$inferInsert)[] = [];
    const profiles = Object.fromEntries(PROFILE_IDS.map((p) => [p, { accepted: 0, entered: 0, rejected: 0, note: '' }])) as ScanResult['profiles'];
    let note: string | null = null;
    let signals: { symbol: string; f: CoinFeatures }[] = [];
    if (!btc) note = 'Data BTC tidak tersedia — tidak ada entry jam ini.';
    else {
      signals = feats
        .map((x) => ({ symbol: x.symbol, f: x.fs.at(x.i) }))
        .filter((x): x is { symbol: string; f: CoinFeatures } => x.f !== null && isSignal(x.f))
        .sort((a, b) => b.f.volRatio - a.f.volRatio);
      if (!signals.length) note = 'Tidak ada signal: tidak ada koin yang breakout di atas high 20 jam dengan volume ≥ 1.5x. Semua profil HOLD CASH.';
      const prices = new Map<string, number | null>();
      const priceOf = async (symbol: string) => {
        if (!prices.has(symbol)) prices.set(symbol, await livePrice(symbol));
        return prices.get(symbol)!;
      };
      const j = await judgeSignals({ now, btc, signals, pfs, priceOf });
      entries.push(...j.entries);
      skipped.push(...j.skipped);
      decisions.push(...j.decisions);
      Object.assign(profiles, j.profiles);
      for (const p of PROFILE_IDS) {
        const s = profiles[p];
        s.note = !signals.length
          ? 'HOLD CASH — tidak ada signal'
          : s.entered
            ? `BELI ${s.entered} koin`
            : s.accepted
              ? 'HOLD CASH — signal lolos filter tapi ditolak money management'
              : `HOLD CASH — ${signals.length} signal ditolak filter ${PROFILE_LABEL[p]}`;
      }
    }
    for (const p of PROFILE_IDS) {
      const pf = pfs[p];
      pf.mark(now, await markPrices(pf));
      await save(p, pf, new Date(now));
    }
    const res: ScanResult = {
      time: new Date(now).toISOString(),
      btc: btc as unknown as Record<string, unknown>,
      scanned: feats.length,
      signals: signals.length,
      profiles,
      entries,
      skipped,
      note,
    };
    const db = getDb();
    await db.insert(paperScans).values({
      time: new Date(now),
      btc: res.btc,
      scanned: res.scanned,
      signals: res.signals,
      entries,
      skipped: { profiles, skipped },
      note,
    });
    if (decisions.length) await db.insert(paperSignals).values(decisions);
    logger.info(
      {
        scanned: feats.length,
        signals: signals.length,
        entries: entries.map((e) => `${e.profile}:${e.symbol}`),
      },
      'Paper scan complete',
    );
    return res;
  });
}

export async function latestScans(limit = 24) {
  return (await getDb().select().from(paperScans).orderBy(desc(paperScans.id)).limit(limit)).map((s) => ({ ...s, time: s.time.toISOString() }));
}

/** Change fee / compounding. Applies to new trades; open positions keep the fee they paid at entry. */
export async function updatePaperSettings(patch: Partial<PaperSettings>): Promise<PaperSettings> {
  const r = await withLock(async () => {
    await loadAll();
    const db = getDb();
    let settings: PaperSettings | null = null;
    // One setting for all three profiles, so they stay comparable
    for (const profile of PROFILE_IDS) {
      const [st] = await db.select().from(paperState).where(eq(paperState.profile, profile));
      settings = { ...settingsOf(st.config), ...patch };
      await db
        .update(paperState)
        .set({
          config: { ...(st.config as object), settings },
          updatedAt: new Date(),
        })
        .where(eq(paperState.profile, profile));
    }
    logger.info(settings!, 'Paper settings updated');
    return settings!;
  });
  if (!r) throw new AppError(409, 'PAPER_BUSY', 'Paper Trading sedang memproses. Coba lagi sebentar.');
  return r;
}

/** Virtual top-up: adds cash, recorded in the ledger as TOPUP and excluded from P&L / return. */
export async function topUpPaper(profile: ProfileId, amount: number) {
  const r = await withLock(async () => {
    const pf = await load(profile);
    pf.deposit(Date.now(), amount);
    await save(profile, pf);
    logger.info({ profile, amount }, 'Paper top-up');
    return { cash: pf.state.cash, deposits: pf.state.deposits };
  });
  if (!r) throw new AppError(409, 'PAPER_BUSY', 'Paper Trading sedang memproses. Coba lagi sebentar.');
  return r;
}

export { load as loadPaperPortfolio, settingsOf as paperSettingsOf };

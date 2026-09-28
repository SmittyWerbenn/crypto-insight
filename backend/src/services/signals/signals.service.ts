import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { TARGET_CONFIG } from '../../config/scoring.js';
import { LOWER_TIMEFRAME, TIMEFRAME_MS, type Timeframe } from '../../config/timeframes.js';
import { getDb, isDbReady } from '../../db/client.js';
import { signalFeatures, signalResults, signals } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { mean, median, round } from '../../utils/math.js';
import { getCandles } from '../market/candles.service.js';
import type { TechnicalAnalysis } from '../analysis/technical-analysis.js';
import { evaluateOutcome, FINAL_STATUSES, isSuccess, resolveWithLowerTimeframe, type SignalStatus } from './outcome.js';

export interface SignalExtras {
  aiConfidence: number | null;
  marketCondition: string | null;
  analysisId: string | null;
  fundingRate: number | null;
  openInterest: number | null;
  fearGreed: number | null;
  volatilityRegime: 'HIGH' | 'LOW' | null;
}

/** Persist the signal of a CLOSED candle (idempotent per symbol/timeframe/candle) with its feature snapshot. */
export async function recordSignal(t: TechnicalAnalysis, x: SignalExtras): Promise<string | null> {
  if (!isDbReady() || !t.levels) return null;
  const db = getDb();
  const s = t.snapshot;
  const ts = new Date(t.candleCloseTime + 1);
  const inserted = await db
    .insert(signals)
    .values({
      symbol: t.symbol,
      timeframe: t.timeframe,
      timestamp: ts,
      candleTime: t.candleTime,
      signal: t.signal,
      technicalScore: t.technicalScore,
      aiConfidence: x.aiConfidence,
      direction: t.levels.direction,
      entryPrice: t.levels.entry,
      targetPrice: t.levels.target,
      stopPrice: t.levels.stop,
      marketCondition: x.marketCondition,
      analysisId: x.analysisId,
    })
    .onConflictDoUpdate({
      target: [signals.symbol, signals.timeframe, signals.candleTime],
      // Signal itself is immutable once issued; only attach AI info that arrives later.
      set: { aiConfidence: sql`coalesce(excluded.ai_confidence, ${signals.aiConfidence})`, analysisId: sql`coalesce(excluded.analysis_id, ${signals.analysisId})`, marketCondition: sql`coalesce(excluded.market_condition, ${signals.marketCondition})` },
    })
    .returning({ id: signals.id, createdAt: signals.createdAt });
  const id = inserted[0].id;
  await db
    .insert(signalFeatures)
    .values({
      signalId: id,
      symbol: t.symbol,
      timestamp: ts,
      price: s.price,
      rsi: s.rsi,
      macd: s.macd,
      macdHistogram: s.macdHistogram,
      macdState: s.macdState,
      ma20: s.sma20,
      ma50: s.sma50,
      ma200: s.sma200,
      volume: s.volume,
      volumeChange: s.volumeChangePct,
      atr: s.atr,
      bollingerPosition: s.bbPercentB,
      technicalScore: t.technicalScore,
      support: s.priceAction.support,
      resistance: s.priceAction.resistance,
      fundingRate: x.fundingRate,
      openInterest: x.openInterest,
      fearGreed: x.fearGreed,
      marketCondition: x.marketCondition,
      regime: t.regime,
      volatilityRegime: x.volatilityRegime,
    })
    .onConflictDoNothing();
  if (t.signal !== 'HOLD') {
    await db
      .insert(signalResults)
      .values({ signalId: id, symbol: t.symbol, timestamp: ts, status: 'PENDING', entryPrice: t.levels.entry, targetPrice: t.levels.target, stopPrice: t.levels.stop, entryTime: ts })
      .onConflictDoNothing();
    // An opposite-direction signal invalidates still-running signals for the same market.
    const opposite = t.levels.direction === 'LONG' ? ['SELL', 'STRONG_SELL'] : ['BUY', 'STRONG_BUY'];
    const running = await db
      .select({ id: signals.id, entry: signals.entryPrice, direction: signals.direction })
      .from(signals)
      .innerJoin(signalResults, eq(signalResults.signalId, signals.id))
      .where(and(eq(signals.symbol, t.symbol), eq(signals.timeframe, t.timeframe), inArray(signals.signal, opposite), inArray(signalResults.status, ['PENDING', 'OPEN'])));
    for (const r of running) {
      const ret = ((r.direction === 'LONG' ? s.price - r.entry : r.entry - s.price) / r.entry) * 100;
      await db
        .update(signalResults)
        .set({ status: 'INVALIDATED', exitPrice: s.price, exitTime: ts, returnPercent: ret, note: `Dibatalkan oleh sinyal berlawanan ${t.signal}`, updatedAt: new Date() })
        .where(eq(signalResults.signalId, r.id));
    }
  }
  return id;
}

/** Evaluate all PENDING/OPEN signals against candles that closed after the signal. */
export async function trackOpenSignals(): Promise<{ updated: number }> {
  if (!isDbReady()) return { updated: 0 };
  const db = getDb();
  const open = await db
    .select({ r: signalResults, s: signals })
    .from(signalResults)
    .innerJoin(signals, eq(signals.id, signalResults.signalId))
    .where(inArray(signalResults.status, ['PENDING', 'OPEN']));
  let updated = 0;
  for (const { r, s } of open) {
    try {
      const tf = s.timeframe as Timeframe;
      const step = TIMEFRAME_MS[tf];
      const candles = await getCandles(s.symbol, tf, { startTime: s.candleTime + step, endTime: s.candleTime + step * (TARGET_CONFIG.evaluationWindow + 1) });
      const lowerTf = LOWER_TIMEFRAME[tf];
      const lowerCache = new Map<number, Awaited<ReturnType<typeof getCandles>>>();
      // Pre-fetch lower timeframe data for candles where both levels are touched
      for (const c of candles) {
        const long = s.direction === 'LONG';
        const both = long ? c.high >= r.targetPrice && c.low <= r.stopPrice : c.low <= r.targetPrice && c.high >= r.stopPrice;
        if (both && lowerTf) lowerCache.set(c.openTime, await getCandles(s.symbol, lowerTf, { startTime: c.openTime, endTime: c.closeTime }).catch(() => []));
      }
      const out = evaluateOutcome(
        { direction: s.direction as 'LONG' | 'SHORT_OR_REDUCE', entryPrice: r.entryPrice, targetPrice: r.targetPrice, stopPrice: r.stopPrice, candleTime: s.candleTime },
        candles,
        TARGET_CONFIG.evaluationWindow,
        (c) => {
          const lower = lowerCache.get(c.openTime);
          return lower?.length ? resolveWithLowerTimeframe(lower, s.direction as 'LONG', r.targetPrice, r.stopPrice) : null;
        },
      );
      if (out.status !== r.status || out.candlesEvaluated !== r.candlesEvaluated) {
        await db
          .update(signalResults)
          .set({
            status: out.status,
            exitPrice: out.exitPrice,
            exitTime: out.exitTime ? new Date(out.exitTime) : null,
            returnPercent: out.returnPercent,
            maxFavorableExcursion: out.mfe,
            maxAdverseExcursion: out.mae,
            candlesEvaluated: out.candlesEvaluated,
            note: out.note,
            updatedAt: new Date(),
          })
          .where(eq(signalResults.signalId, r.signalId));
        updated++;
      }
    } catch (e) {
      logger.warn({ signal: r.signalId, err: (e as Error).message }, 'Signal tracking failed');
    }
  }
  return { updated };
}

export interface SignalFilter {
  symbol?: string;
  signal?: string;
  status?: string;
  timeframe?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function listSignals(f: SignalFilter) {
  if (!isDbReady()) return { items: [], total: 0 };
  const db = getDb();
  const conds = [
    f.symbol ? eq(signals.symbol, f.symbol) : undefined,
    f.signal ? eq(signals.signal, f.signal) : undefined,
    f.timeframe ? eq(signals.timeframe, f.timeframe) : undefined,
    f.status ? eq(signalResults.status, f.status) : undefined,
    f.from ? gte(signals.timestamp, f.from) : undefined,
    f.to ? lte(signals.timestamp, f.to) : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...(conds as never[])) : undefined;
  const rows = await db
    .select({ s: signals, r: signalResults, f: signalFeatures })
    .from(signals)
    .leftJoin(signalResults, eq(signalResults.signalId, signals.id))
    .leftJoin(signalFeatures, eq(signalFeatures.signalId, signals.id))
    .where(where)
    .orderBy(desc(signals.timestamp))
    .limit(Math.min(f.limit ?? 100, 500))
    .offset(f.offset ?? 0);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(signals).leftJoin(signalResults, eq(signalResults.signalId, signals.id)).where(where);
  return {
    total: count,
    items: rows.map(({ s, r, f: feat }) => ({
      id: s.id,
      date: s.timestamp,
      symbol: s.symbol,
      timeframe: s.timeframe,
      signal: s.signal,
      technicalScore: s.technicalScore,
      aiConfidence: s.aiConfidence,
      direction: s.direction,
      entry: s.entryPrice,
      target: s.targetPrice,
      stop: s.stopPrice,
      result: r?.status ?? (s.signal === 'HOLD' ? 'NOT_TRACKED' : null),
      returnPercent: r?.returnPercent ?? null,
      exitPrice: r?.exitPrice ?? null,
      exitTime: r?.exitTime ?? null,
      mfe: r?.maxFavorableExcursion ?? null,
      mae: r?.maxAdverseExcursion ?? null,
      note: r?.note ?? null,
      features: feat,
    })),
  };
}

type Row = { symbol: string; signal: string; timeframe: string; status: SignalStatus; ret: number | null; entryTime: Date; exitTime: Date | null; regime: string | null; volRegime: string | null };

function summarize(rows: Row[]) {
  const closed = rows.filter((r) => isSuccess(r.status, r.ret) !== null);
  const wins = closed.filter((r) => isSuccess(r.status, r.ret));
  const rets = closed.map((r) => r.ret).filter((v): v is number => v !== null);
  const gw = rets.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const gl = Math.abs(rets.filter((r) => r <= 0).reduce((a, b) => a + b, 0));
  const dur = (st: SignalStatus) => {
    const xs = rows.filter((r) => r.status === st && r.exitTime).map((r) => r.exitTime!.getTime() - r.entryTime.getTime());
    return xs.length ? Math.round(mean(xs)) : null;
  };
  return {
    total: rows.length,
    evaluated: closed.length,
    open: rows.filter((r) => r.status === 'OPEN' || r.status === 'PENDING').length,
    ambiguous: rows.filter((r) => r.status === 'AMBIGUOUS').length,
    successful: wins.length,
    failed: closed.length - wins.length,
    winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
    averageReturn: rets.length ? round(mean(rets), 2) : null,
    medianReturn: rets.length ? round(median(rets), 2) : null,
    bestReturn: rets.length ? round(Math.max(...rets), 2) : null,
    worstReturn: rets.length ? round(Math.min(...rets), 2) : null,
    profitFactor: gl > 0 ? round(gw / gl, 2) : null,
    averageTimeToTargetMs: dur('TARGET_HIT'),
    averageTimeToStopMs: dur('STOP_HIT'),
  };
}

/** Aggregate live signal performance, overall and broken down by coin / signal / timeframe / regime. */
export async function signalPerformance(filter: { timeframe?: string } = {}) {
  if (!isDbReady()) return null;
  const db = getDb();
  const rows = await db
    .select({
      symbol: signals.symbol,
      signal: signals.signal,
      timeframe: signals.timeframe,
      status: signalResults.status,
      ret: signalResults.returnPercent,
      entryTime: signalResults.entryTime,
      exitTime: signalResults.exitTime,
      regime: signalFeatures.regime,
      volRegime: signalFeatures.volatilityRegime,
    })
    .from(signalResults)
    .innerJoin(signals, eq(signals.id, signalResults.signalId))
    .leftJoin(signalFeatures, eq(signalFeatures.signalId, signals.id))
    .where(filter.timeframe ? eq(signals.timeframe, filter.timeframe) : undefined);
  const typed = rows as Row[];
  const group = (key: (r: Row) => string | null) => {
    const m = new Map<string, Row[]>();
    for (const r of typed) {
      const k = key(r);
      if (!k) continue;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].map(([k, rs]) => ({ key: k, ...summarize(rs) })).sort((a, b) => b.total - a.total);
  };
  const regimeLabel: Record<string, string> = { BULL: 'Bull Market', BEAR: 'Bear Market', SIDEWAYS: 'Sideways Market' };
  const holdCount = await db.select({ c: sql<number>`count(*)::int` }).from(signals).where(eq(signals.signal, 'HOLD'));
  return {
    overall: summarize(typed),
    byCoin: group((r) => r.symbol),
    bySignal: group((r) => r.signal),
    byTimeframe: group((r) => r.timeframe),
    byMarketCondition: [...group((r) => (r.regime ? regimeLabel[r.regime] : null)), ...group((r) => (r.volRegime ? `${r.volRegime === 'HIGH' ? 'High' : 'Low'} Volatility` : null))],
    holdSignals: holdCount[0].c,
    definitions: {
      success: 'TARGET_HIT, or TIMEOUT/INVALIDATED with positive return',
      failure: 'STOP_HIT, or TIMEOUT/INVALIDATED with zero/negative return',
      excluded: 'AMBIGUOUS (target & stop in one candle, unresolved), OPEN, PENDING, HOLD',
      evaluationWindowCandles: TARGET_CONFIG.evaluationWindow,
    },
    finalStatuses: FINAL_STATUSES,
  };
}

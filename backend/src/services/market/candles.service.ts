import { and, asc, desc, eq, gte, lte, max, min, sql } from 'drizzle-orm';
import { TIMEFRAME_MS, type Timeframe } from '../../config/timeframes.js';
import { getDb, isDbReady } from '../../db/client.js';
import { ohlcv } from '../../db/schema.js';
import type { Candle } from '../../types/market.js';
import { logger } from '../../utils/logger.js';
import { cache } from '../cache/cache.js';
import { marketData } from '../binance/index.js';

const rowToCandle = (r: typeof ohlcv.$inferSelect): Candle => ({
  openTime: r.openTime,
  closeTime: r.closeTime,
  open: r.open,
  high: r.high,
  low: r.low,
  close: r.close,
  volume: r.volume,
  quoteVolume: r.quoteVolume ?? undefined,
  trades: r.trades ?? undefined,
});

/** Upsert candles; on conflict overwrite with the latest values from the exchange. */
async function upsertCandles(symbol: string, tf: Timeframe, candles: Candle[]) {
  if (!candles.length || !isDbReady()) return;
  const db = getDb();
  for (let i = 0; i < candles.length; i += 500) {
    const chunk = candles.slice(i, i + 500).map((c) => ({
      symbol,
      timeframe: tf,
      openTime: c.openTime,
      closeTime: c.closeTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      quoteVolume: c.quoteVolume ?? null,
      trades: c.trades ?? null,
    }));
    await db
      .insert(ohlcv)
      .values(chunk)
      .onConflictDoUpdate({
        target: [ohlcv.symbol, ohlcv.timeframe, ohlcv.openTime],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
          quoteVolume: sql`excluded.quote_volume`,
          trades: sql`excluded.trades`,
          closeTime: sql`excluded.close_time`,
        },
      });
  }
}
/**
 * Historical OHLCV with Postgres as the store and Binance as the source.
 * Only CLOSED candles are persisted; the live candle is appended from the API when requested.
 */
export async function getCandles(
  symbol: string,
  tf: Timeframe,
  opts: { limit?: number; startTime?: number; endTime?: number; includeLive?: boolean } = {},
): Promise<Candle[]> {
  const step = TIMEFRAME_MS[tf];
  const now = Date.now();
  const limit = Math.min(opts.limit ?? 500, 20_000);
  const endTime = Math.min(opts.endTime ?? now, now);
  const startTime = opts.startTime ?? endTime - limit * step;
  const isClosed = (c: Candle) => c.closeTime < now;

  if (!isDbReady()) {
    const key = `candles:${marketData.source}:${symbol}:${tf}:${startTime - (startTime % step)}:${endTime - (endTime % 60_000)}:${limit}`;
    const all = await cache.wrap(key, 30, () => marketData.klines(symbol, tf, { startTime, endTime, limit: Math.ceil((endTime - startTime) / step) + 2 }));
    const closed = all.filter(isClosed);
    const res = opts.includeLive ? all : closed;
    return opts.startTime ? res : res.slice(-limit);
  }

  const db = getDb();
  const where = and(eq(ohlcv.symbol, symbol), eq(ohlcv.timeframe, tf));
  const [range] = await db.select({ lo: min(ohlcv.openTime), hi: max(ohlcv.openTime) }).from(ohlcv).where(where);
  const lo = range?.lo ?? null;
  const hi = range?.hi ?? null;

  try {
    // Backfill older history if requested range starts before what we have
    if (lo === null || startTime < lo - step) {
      const until = lo ?? endTime;
      const need = Math.ceil((until - startTime) / step) + 1;
      if (need > 0) {
        const older = await marketData.klines(symbol, tf, { startTime, endTime: until - 1, limit: need });
        await upsertCandles(symbol, tf, older.filter(isClosed));
      }
    }
    // Forward-fill up to now
    const from = hi !== null ? hi : startTime;
    if (hi === null || now - hi > step) {
      const need = Math.ceil((now - from) / step) + 1;
      const newer = await marketData.klines(symbol, tf, { startTime: from, limit: need });
      await upsertCandles(symbol, tf, newer.filter(isClosed));
    }
  } catch (e) {
    logger.warn({ symbol, tf, err: (e as Error).message }, 'Candle sync failed, serving stored data');
    if (lo === null) throw e;
  }

  const rows = opts.startTime
    ? await db.select().from(ohlcv).where(and(where, gte(ohlcv.openTime, startTime), lte(ohlcv.openTime, endTime))).orderBy(asc(ohlcv.openTime))
    : (await db.select().from(ohlcv).where(and(where, lte(ohlcv.openTime, endTime))).orderBy(desc(ohlcv.openTime)).limit(limit)).reverse();
  const candles = rows.map(rowToCandle).filter(isClosed);
  if (opts.includeLive && endTime >= now - step) {
    try {
      const [live] = await cache.wrap(`live:kline:${symbol}:${tf}`, 5, () => marketData.klines(symbol, tf, { limit: 1 }));
      if (live && (!candles.length || live.openTime > candles[candles.length - 1].openTime)) candles.push(live);
    } catch {
      /* live candle optional */
    }
  }
  return candles;
}

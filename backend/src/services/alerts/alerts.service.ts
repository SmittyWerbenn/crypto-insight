import { and, desc, eq, inArray } from 'drizzle-orm';
import { env } from '../../config/env.js';
import type { Timeframe } from '../../config/timeframes.js';
import { getDb, isDbReady } from '../../db/client.js';
import { alerts } from '../../db/schema.js';
import { NotFoundError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { cache } from '../cache/cache.js';
import { technicalAnalysis } from '../analysis/analysis.service.js';
import { currentUserId } from '../users.js';

export const ALERT_TYPES = ['PRICE_ABOVE', 'PRICE_BELOW', 'RSI_ABOVE', 'RSI_BELOW', 'SCORE_ABOVE', 'SCORE_BELOW', 'SIGNAL_BUY', 'SIGNAL_STRONG_BUY', 'SIGNAL_SELL'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const CHANNEL_ALERT = 'stream:alert';

const PRICE_TYPES: AlertType[] = ['PRICE_ABOVE', 'PRICE_BELOW'];

export async function listAlerts() {
  const userId = await currentUserId();
  return getDb().select().from(alerts).where(eq(alerts.userId, userId)).orderBy(desc(alerts.createdAt));
}

export async function createAlert(a: { symbol: string; type: AlertType; value?: number | null }) {
  const userId = await currentUserId();
  const [row] = await getDb().insert(alerts).values({ userId, symbol: a.symbol, type: a.type, value: a.value ?? null }).returning();
  return row;
}

export async function deleteAlert(id: string) {
  const userId = await currentUserId();
  const r = await getDb().delete(alerts).where(and(eq(alerts.id, id), eq(alerts.userId, userId))).returning({ id: alerts.id });
  if (!r.length) throw new NotFoundError('Peringatan tidak ditemukan');
}

/** Pure trigger check (exported for tests). */
export function shouldTrigger(type: AlertType, value: number | null, m: { price?: number; rsi?: number | null; score?: number; signal?: string }): number | null {
  switch (type) {
    case 'PRICE_ABOVE':
      return m.price !== undefined && value !== null && m.price > value ? m.price : null;
    case 'PRICE_BELOW':
      return m.price !== undefined && value !== null && m.price < value ? m.price : null;
    case 'RSI_ABOVE':
      return m.rsi != null && value !== null && m.rsi > value ? m.rsi : null;
    case 'RSI_BELOW':
      return m.rsi != null && value !== null && m.rsi < value ? m.rsi : null;
    case 'SCORE_ABOVE':
      return m.score !== undefined && value !== null && m.score > value ? m.score : null;
    case 'SCORE_BELOW':
      return m.score !== undefined && value !== null && m.score < value ? m.score : null;
    case 'SIGNAL_BUY':
      return m.signal === 'BUY' || m.signal === 'STRONG_BUY' ? (m.score ?? 0) : null;
    case 'SIGNAL_STRONG_BUY':
      return m.signal === 'STRONG_BUY' ? (m.score ?? 0) : null;
    case 'SIGNAL_SELL':
      return m.signal === 'SELL' || m.signal === 'STRONG_SELL' ? (m.score ?? 0) : null;
  }
}

async function fire(id: string, symbol: string, type: string, value: number | null, triggeredValue: number) {
  await getDb().update(alerts).set({ active: false, triggeredAt: new Date(), triggeredValue }).where(eq(alerts.id, id));
  await cache.publish(CHANNEL_ALERT, { id, symbol, type, value, triggeredValue, at: Date.now() });
  logger.info({ id, symbol, type, triggeredValue }, 'Alert triggered');
}

/** Price alerts: evaluated on live ticker events. */
export async function checkPriceAlerts(symbol: string, price: number) {
  if (!isDbReady()) return;
  const active = await getDb().select().from(alerts).where(and(eq(alerts.active, true), eq(alerts.symbol, symbol), inArray(alerts.type, PRICE_TYPES)));
  for (const a of active) {
    const v = shouldTrigger(a.type as AlertType, a.value, { price });
    if (v !== null) await fire(a.id, a.symbol, a.type, a.value, v);
  }
}

/** Technical/signal alerts: evaluated per analysis cycle on the analysis timeframe. */
export async function checkTechnicalAlerts() {
  if (!isDbReady()) return;
  const active = await getDb().select().from(alerts).where(eq(alerts.active, true));
  const bySymbol = new Map<string, typeof active>();
  for (const a of active) bySymbol.set(a.symbol, [...(bySymbol.get(a.symbol) ?? []), a]);
  for (const [symbol, list] of bySymbol) {
    try {
      const t = await technicalAnalysis(symbol, env.ANALYSIS_TIMEFRAME as Timeframe);
      for (const a of list) {
        const v = shouldTrigger(a.type as AlertType, a.value, { price: t.price, rsi: t.snapshot.rsi, score: t.technicalScore, signal: t.signal });
        if (v !== null) await fire(a.id, a.symbol, a.type, a.value, v);
      }
    } catch (e) {
      logger.warn({ symbol, err: (e as Error).message }, 'Alert evaluation failed');
    }
  }
}

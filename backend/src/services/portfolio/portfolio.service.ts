import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { portfolio, portfolioTransactions, watchlists } from '../../db/schema.js';
import { NotFoundError, ValidationFailedError } from '../../utils/errors.js';
import { round } from '../../utils/math.js';
import { allUsdtTickers } from '../market/market.service.js';
import { dailyAnalysis } from '../analysis/analysis.service.js';
import { currentUserId } from '../users.js';

/* ------------------------------- watchlist ------------------------------- */

export async function getWatchlist() {
  const userId = await currentUserId();
  const rows = await getDb().select().from(watchlists).where(eq(watchlists.userId, userId)).orderBy(asc(watchlists.createdAt));
  const symbols = rows.map((r) => r.symbol);
  if (!symbols.length) return { symbols, rows: [], failed: [] };
  const daily = await dailyAnalysis(undefined, symbols);
  return { symbols, rows: daily.rows, failed: daily.failed, timeframe: daily.timeframe };
}

export async function addToWatchlist(symbol: string) {
  const tickers = await allUsdtTickers();
  if (!tickers.find((t) => t.symbol === symbol)) throw new ValidationFailedError(`Simbol tidak dikenal atau tidak didukung: ${symbol}`);
  const userId = await currentUserId();
  await getDb().insert(watchlists).values({ userId, symbol }).onConflictDoNothing();
  return { symbol };
}

export async function removeFromWatchlist(symbol: string) {
  const userId = await currentUserId();
  await getDb().delete(watchlists).where(and(eq(watchlists.userId, userId), eq(watchlists.symbol, symbol)));
}

/* ------------------------------- portfolio ------------------------------- */

interface Holding {
  symbol: string;
  quantity: number;
  averageBuyPrice: number;
  realizedPnl: number;
}

/** Average-cost accounting rebuilt from the transaction log (so deletes stay consistent). */
export function computeHoldings(txs: { symbol: string; side: string; quantity: number; price: number }[]): Map<string, Holding> {
  const h = new Map<string, Holding>();
  for (const t of txs) {
    const cur = h.get(t.symbol) ?? { symbol: t.symbol, quantity: 0, averageBuyPrice: 0, realizedPnl: 0 };
    if (t.side === 'BUY') {
      const q = cur.quantity + t.quantity;
      cur.averageBuyPrice = q > 0 ? (cur.quantity * cur.averageBuyPrice + t.quantity * t.price) / q : 0;
      cur.quantity = q;
    } else {
      const q = Math.min(t.quantity, cur.quantity);
      cur.realizedPnl += (t.price - cur.averageBuyPrice) * q;
      cur.quantity -= q;
      if (cur.quantity <= 1e-12) {
        cur.quantity = 0;
        cur.averageBuyPrice = 0;
      }
    }
    h.set(t.symbol, cur);
  }
  return h;
}

async function rebuild(userId: string) {
  const db = getDb();
  const txs = await db.select().from(portfolioTransactions).where(eq(portfolioTransactions.userId, userId)).orderBy(asc(portfolioTransactions.executedAt), asc(portfolioTransactions.createdAt));
  const holdings = computeHoldings(txs);
  await db.transaction(async (tx) => {
    await tx.delete(portfolio).where(eq(portfolio.userId, userId));
    const rows = [...holdings.values()].filter((h) => h.quantity > 0);
    if (rows.length) await tx.insert(portfolio).values(rows.map((h) => ({ userId, symbol: h.symbol, quantity: h.quantity, averageBuyPrice: h.averageBuyPrice })));
  });
  return holdings;
}

export async function getPortfolio() {
  const userId = await currentUserId();
  const db = getDb();
  const txs = await db.select().from(portfolioTransactions).where(eq(portfolioTransactions.userId, userId)).orderBy(asc(portfolioTransactions.executedAt));
  const holdings = computeHoldings(txs);
  const tickers = new Map((await allUsdtTickers()).map((t) => [t.symbol, t]));
  let invested = 0;
  let value = 0;
  let daily = 0;
  let realized = 0;
  const positions = [...holdings.values()].map((h) => {
    realized += h.realizedPnl;
    const t = tickers.get(h.symbol);
    const price = t?.lastPrice ?? null;
    const cost = h.quantity * h.averageBuyPrice;
    const cur = price !== null ? h.quantity * price : null;
    const dayPnl = t && price !== null ? h.quantity * (price - t.openPrice) : null;
    if (h.quantity > 0) {
      invested += cost;
      if (cur !== null) value += cur;
      if (dayPnl !== null) daily += dayPnl;
    }
    return {
      symbol: h.symbol,
      quantity: h.quantity,
      averageBuyPrice: h.averageBuyPrice,
      price,
      invested: round(cost, 2),
      currentValue: cur !== null ? round(cur, 2) : null,
      unrealizedPnl: cur !== null ? round(cur - cost, 2) : null,
      unrealizedPnlPct: cur !== null && cost > 0 ? round(((cur - cost) / cost) * 100, 2) : null,
      dailyPnl: dayPnl !== null ? round(dayPnl, 2) : null,
      change24hPct: t ? round(t.priceChangePercent, 2) : null,
      realizedPnl: round(h.realizedPnl, 2),
    };
  });
  const open = positions.filter((p) => p.quantity > 0);
  return {
    summary: {
      totalInvestment: round(invested, 2),
      currentValue: round(value, 2),
      unrealizedPnl: round(value - invested, 2),
      dailyPnl: round(daily, 2),
      roi: invested > 0 ? round(((value - invested) / invested) * 100, 2) : null,
      realizedPnl: round(realized, 2),
    },
    positions: open.map((p) => ({ ...p, allocationPct: value > 0 && p.currentValue !== null ? round((p.currentValue / value) * 100, 2) : null })),
    transactions: txs.map((t) => ({ ...t, executedAt: t.executedAt.toISOString() })).reverse(),
    note: 'Pencatatan manual, hanya-baca. CryptoInsight AI tidak pernah menempatkan order.',
  };
}

export async function addTransaction(input: { symbol: string; side: 'BUY' | 'SELL'; quantity: number; price: number; executedAt?: Date; note?: string }) {
  const userId = await currentUserId();
  const db = getDb();
  if (input.side === 'SELL') {
    const txs = await db.select().from(portfolioTransactions).where(eq(portfolioTransactions.userId, userId));
    const held = computeHoldings(txs).get(input.symbol)?.quantity ?? 0;
    if (input.quantity > held + 1e-12) throw new ValidationFailedError(`Tidak bisa menjual ${input.quantity} ${input.symbol}; jumlah dimiliki ${held}`);
  }
  const [row] = await db
    .insert(portfolioTransactions)
    .values({ userId, symbol: input.symbol, side: input.side, quantity: input.quantity, price: input.price, executedAt: input.executedAt ?? new Date(), note: input.note })
    .returning();
  await rebuild(userId);
  return row;
}

export async function deleteTransaction(id: string) {
  const userId = await currentUserId();
  const res = await getDb()
    .delete(portfolioTransactions)
    .where(and(eq(portfolioTransactions.id, id), eq(portfolioTransactions.userId, userId)))
    .returning({ id: portfolioTransactions.id });
  if (!res.length) throw new NotFoundError('Transaksi tidak ditemukan');
  await rebuild(userId);
}

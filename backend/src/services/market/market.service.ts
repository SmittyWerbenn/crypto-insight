import { env, trackedSymbols } from '../../config/env.js';
import type { Ticker24h } from '../../types/market.js';
import { fetchJson } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { round } from '../../utils/math.js';
import { marketData } from '../binance/index.js';
import { isAnalyzableUsdtPair } from '../binance/provider.js';
import { getStatus, markFailure, markSuccess } from '../binance/status.js';
import { cache } from '../cache/cache.js';
import type { LiveTicker } from '../binance/stream.js';

export interface GlobalMarket {
  totalMarketCap: number;
  totalMarketCapChangePct: number;
  totalVolume: number;
  btcDominance: number;
  ethDominance: number;
  source: string;
  updatedAt: number;
}

export interface Mover {
  symbol: string;
  price: number;
  changePct: number;
  quoteVolume: number;
  rangePct: number;
}

export interface Breadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  total: number;
  advanceDeclineRatio: number | null;
  averageChangePct: number;
  medianChangePct: number;
  label: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

const MIN_QUOTE_VOLUME = 1_000_000; // ignore illiquid pairs for movers/breadth

export async function allUsdtTickers(): Promise<Ticker24h[]> {
  return cache.wrap(`tickers:all:${marketData.source}`, 15, async () => {
    const all = await marketData.allTickers24h();
    return all.filter((t) => isAnalyzableUsdtPair(t.symbol) && t.lastPrice > 0);
  });
}

export async function getTicker(symbol: string): Promise<Ticker24h & { live?: LiveTicker | null }> {
  const t = await cache.wrap(`ticker:${marketData.source}:${symbol}`, 10, () => marketData.ticker24h(symbol));
  const live = await cache.get<LiveTicker>(`live:ticker:${symbol}`);
  return live && live.eventTime > t.closeTime - 60_000 ? { ...t, lastPrice: live.price, live } : t;
}

export async function sparkline(symbol: string): Promise<number[]> {
  return cache.wrap(`spark:${marketData.source}:${symbol}`, 300, async () => (await marketData.klines(symbol, '1h', { limit: 24 })).map((c) => c.close));
}

/** Global market cap & dominance (CoinGecko). Binance does not publish market cap. Optional. */
export async function globalMarket(): Promise<GlobalMarket | null> {
  if (env.MOCK_MODE) return null;
  try {
    return await cache.wrap('global:coingecko', 300, async () => {
      const r = await fetchJson<{ data: { total_market_cap: Record<string, number>; total_volume: Record<string, number>; market_cap_percentage: Record<string, number>; market_cap_change_percentage_24h_usd: number; updated_at: number } }>(
        `${env.COINGECKO_API_URL}/global`,
        { timeoutMs: 8000 },
      );
      markSuccess('coingecko');
      return {
        totalMarketCap: r.data.total_market_cap.usd,
        totalMarketCapChangePct: r.data.market_cap_change_percentage_24h_usd,
        totalVolume: r.data.total_volume.usd,
        btcDominance: r.data.market_cap_percentage.btc,
        ethDominance: r.data.market_cap_percentage.eth,
        source: 'CoinGecko',
        updatedAt: r.data.updated_at * 1000,
      };
    });
  } catch (e) {
    markFailure('coingecko', (e as Error).message);
    logger.warn({ err: (e as Error).message }, 'Global market data unavailable');
    return null;
  }
}

const toMover = (t: Ticker24h): Mover => ({
  symbol: t.symbol,
  price: t.lastPrice,
  changePct: round(t.priceChangePercent, 2),
  quoteVolume: t.quoteVolume,
  rangePct: t.lowPrice > 0 ? round(((t.highPrice - t.lowPrice) / t.lowPrice) * 100, 2) : 0,
});

export async function movers(kind: 'gainers' | 'losers' | 'volatility', limit = 10): Promise<Mover[]> {
  const liquid = (await allUsdtTickers()).filter((t) => t.quoteVolume >= MIN_QUOTE_VOLUME || marketData.source === 'mock');
  const ms = liquid.map(toMover);
  if (kind === 'gainers') ms.sort((a, b) => b.changePct - a.changePct);
  else if (kind === 'losers') ms.sort((a, b) => a.changePct - b.changePct);
  else ms.sort((a, b) => b.rangePct - a.rangePct);
  return ms.slice(0, limit);
}

export function computeBreadth(tickers: Ticker24h[]): Breadth {
  const ch = tickers.map((t) => t.priceChangePercent);
  const adv = ch.filter((c) => c > 0.1).length;
  const dec = ch.filter((c) => c < -0.1).length;
  const sorted = [...ch].sort((a, b) => a - b);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const avg = ch.length ? ch.reduce((a, b) => a + b, 0) / ch.length : 0;
  const ratio = dec ? adv / dec : null;
  const label = ratio === null ? (adv > 0 ? 'POSITIVE' : 'NEUTRAL') : ratio >= 1.3 ? 'POSITIVE' : ratio <= 0.77 ? 'NEGATIVE' : 'NEUTRAL';
  return { advancers: adv, decliners: dec, unchanged: ch.length - adv - dec, total: ch.length, advanceDeclineRatio: ratio === null ? null : round(ratio, 2), averageChangePct: round(avg, 2), medianChangePct: round(med, 2), label };
}

export async function marketOverview() {
  const [tickers, global] = await Promise.all([allUsdtTickers(), globalMarket()]);
  const bySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const liquid = tickers.filter((t) => t.quoteVolume >= MIN_QUOTE_VOLUME || marketData.source === 'mock');
  const cards = await Promise.all(
    trackedSymbols.map(async (s) => {
      const t = bySymbol.get(s);
      if (!t) return null;
      const live = await cache.get<LiveTicker>(`live:ticker:${s}`);
      const spark = await sparkline(s).catch(() => []);
      return {
        symbol: s,
        base: s.replace(/USDT$/, ''),
        price: live?.price ?? t.lastPrice,
        changePct: round(live?.changePct ?? t.priceChangePercent, 2),
        high: t.highPrice,
        low: t.lowPrice,
        volume: t.volume,
        quoteVolume: t.quoteVolume,
        sparkline: spark,
      };
    }),
  );
  return {
    source: marketData.source,
    mock: marketData.source === 'mock',
    updatedAt: Date.now(),
    status: getStatus('binance'),
    cards: cards.filter(Boolean),
    global,
    binanceUsdtVolume24h: round(liquid.reduce((a, t) => a + t.quoteVolume, 0), 0),
    breadth: computeBreadth(liquid),
    gainers: (await movers('gainers', 5)),
    losers: (await movers('losers', 5)),
    mostVolatile: (await movers('volatility', 5)),
  };
}

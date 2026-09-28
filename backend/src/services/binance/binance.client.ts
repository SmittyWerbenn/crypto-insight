import { env } from '../../config/env.js';
import type { Timeframe } from '../../config/timeframes.js';
import type { Candle, DerivativesData, OrderBook, Ticker24h } from '../../types/market.js';
import { HttpError, fetchJson } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { Semaphore, sleep } from '../../utils/semaphore.js';
import { emptyDerivatives, type KlineQuery, type MarketDataProvider, type SymbolInfo } from './provider.js';
import { markFailure, markSuccess } from './status.js';

type RawTicker = Record<string, string | number>;
type RawKline = [number, string, string, string, string, string, number, string, number, string, string, string];

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;
export function assertSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new HttpError(400, `Invalid symbol: ${symbol}`);
  return s;
}

const parseTicker = (t: RawTicker): Ticker24h => ({
  symbol: String(t.symbol),
  lastPrice: Number(t.lastPrice),
  priceChange: Number(t.priceChange),
  priceChangePercent: Number(t.priceChangePercent),
  highPrice: Number(t.highPrice),
  lowPrice: Number(t.lowPrice),
  volume: Number(t.volume),
  quoteVolume: Number(t.quoteVolume),
  openPrice: Number(t.openPrice),
  closeTime: Number(t.closeTime),
});

const parseKline = (k: RawKline): Candle => ({
  openTime: k[0],
  open: Number(k[1]),
  high: Number(k[2]),
  low: Number(k[3]),
  close: Number(k[4]),
  volume: Number(k[5]),
  closeTime: k[6],
  quoteVolume: Number(k[7]),
  trades: k[8],
});

export class BinanceClient implements MarketDataProvider {
  readonly source = 'binance' as const;
  private spotBases = [env.BINANCE_API_URL, env.BINANCE_API_FALLBACK_URL].filter(Boolean);
  private preferred = 0;
  private futuresDownUntil = 0;
  private limiter = new Semaphore(6);

  /**
   * Spot GET: at most 6 concurrent requests; on network errors / 5xx / 429 fail over to the
   * public market-data mirror, with one backoff round across all endpoints.
   */
  private async spot<T>(path: string): Promise<T> {
    let lastErr: unknown;
    const tries = this.spotBases.length * 2;
    for (let attempt = 0; attempt < tries; attempt++) {
      const idx = (this.preferred + attempt) % this.spotBases.length;
      if (attempt === this.spotBases.length) await sleep(750);
      try {
        const r = await this.limiter.run(() => fetchJson<T>(this.spotBases[idx] + path, { timeoutMs: env.BINANCE_TIMEOUT_MS }));
        this.preferred = idx;
        markSuccess('binance');
        return r;
      } catch (e) {
        lastErr = e;
        const status = e instanceof HttpError ? e.status : 0;
        if (status >= 400 && status < 500 && status !== 429 && status !== 418) throw e; // client error: don't fail over
        logger.debug({ base: this.spotBases[idx], path, err: (e as Error).message }, 'Binance spot request failed, trying fallback');
      }
    }
    markFailure('binance', (lastErr as Error)?.message ?? 'unknown');
    logger.warn({ path, err: (lastErr as Error)?.message }, 'Binance spot request failed on all endpoints');
    throw lastErr;
  }

  private async futures<T>(path: string): Promise<T> {
    return fetchJson<T>(env.BINANCE_FUTURES_API_URL + path, { timeoutMs: Math.min(env.BINANCE_TIMEOUT_MS, 6000) });
  }

  async ticker24h(symbol: string): Promise<Ticker24h> {
    return parseTicker(await this.spot<RawTicker>(`/api/v3/ticker/24hr?symbol=${assertSymbol(symbol)}`));
  }

  async allTickers24h(): Promise<Ticker24h[]> {
    const raw = await this.spot<RawTicker[]>('/api/v3/ticker/24hr');
    return raw.map(parseTicker);
  }

  /** Klines; paginates forward from startTime when more than 1000 candles are needed. */
  async klines(symbol: string, tf: Timeframe, q: KlineQuery = {}): Promise<Candle[]> {
    const s = assertSymbol(symbol);
    const limit = q.limit ?? 500;
    if (!q.startTime || limit <= 1000) {
      const params = new URLSearchParams({ symbol: s, interval: tf, limit: String(Math.min(limit, 1000)) });
      if (q.startTime) params.set('startTime', String(q.startTime));
      if (q.endTime) params.set('endTime', String(q.endTime));
      const raw = await this.spot<RawKline[]>(`/api/v3/klines?${params}`);
      return raw.map(parseKline);
    }
    const out: Candle[] = [];
    let start = q.startTime;
    while (out.length < limit) {
      const params = new URLSearchParams({ symbol: s, interval: tf, limit: '1000', startTime: String(start) });
      if (q.endTime) params.set('endTime', String(q.endTime));
      const raw = await this.spot<RawKline[]>(`/api/v3/klines?${params}`);
      if (!raw.length) break;
      out.push(...raw.map(parseKline));
      start = raw[raw.length - 1][0] + 1;
      if (raw.length < 1000) break;
    }
    return out.slice(0, limit);
  }

  async orderBook(symbol: string, limit = 20): Promise<OrderBook> {
    const r = await this.spot<{ lastUpdateId: number; bids: [string, string][]; asks: [string, string][] }>(`/api/v3/depth?symbol=${assertSymbol(symbol)}&limit=${limit}`);
    return {
      lastUpdateId: r.lastUpdateId,
      bids: r.bids.map(([p, q]) => [Number(p), Number(q)]),
      asks: r.asks.map(([p, q]) => [Number(p), Number(q)]),
    };
  }

  async exchangeInfo(): Promise<SymbolInfo[]> {
    const r = await this.spot<{ symbols: SymbolInfo[] }>('/api/v3/exchangeInfo?permissions=SPOT');
    return r.symbols.map((s) => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset, status: s.status }));
  }

  /**
   * Futures data (funding, OI, long/short, futures volume). Binance Futures is geo-restricted in
   * some regions; on failure we return available=false and back off for 5 minutes.
   * Binance no longer exposes public historical liquidation totals via REST, so `liquidations` is null.
   */
  async derivatives(symbol: string): Promise<DerivativesData> {
    if (Date.now() < this.futuresDownUntil) return emptyDerivatives('Binance Futures temporarily unavailable');
    const s = assertSymbol(symbol);
    try {
      const [premium, oi, oiHist, ls, t24] = await Promise.all([
        this.futures<{ lastFundingRate: string; nextFundingTime: number; markPrice: string }>(`/fapi/v1/premiumIndex?symbol=${s}`),
        this.futures<{ openInterest: string }>(`/fapi/v1/openInterest?symbol=${s}`),
        this.futures<{ sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number }[]>(`/futures/data/openInterestHist?symbol=${s}&period=1h&limit=25`).catch(() => []),
        this.futures<{ longShortRatio: string }[]>(`/futures/data/globalLongShortAccountRatio?symbol=${s}&period=1h&limit=1`).catch(() => []),
        this.futures<RawTicker>(`/fapi/v1/ticker/24hr?symbol=${s}`).catch(() => null),
      ]);
      markSuccess('binance_futures');
      const first = oiHist[0];
      const last = oiHist[oiHist.length - 1];
      const mark = Number(premium.markPrice);
      return {
        available: true,
        fundingRate: Number(premium.lastFundingRate) * 100,
        nextFundingTime: premium.nextFundingTime,
        markPrice: mark,
        openInterest: Number(oi.openInterest),
        openInterestValue: last ? Number(last.sumOpenInterestValue) : Number(oi.openInterest) * mark,
        openInterestChangePct: first && last ? ((Number(last.sumOpenInterest) - Number(first.sumOpenInterest)) / Number(first.sumOpenInterest)) * 100 : null,
        longShortRatio: ls[0] ? Number(ls[0].longShortRatio) : null,
        futuresQuoteVolume: t24 ? Number(t24.quoteVolume) : null,
        liquidations: null,
      };
    } catch (e) {
      const msg = (e as Error).message;
      if (!(e instanceof HttpError && e.status === 400)) this.futuresDownUntil = Date.now() + 5 * 60_000;
      markFailure('binance_futures', msg);
      return emptyDerivatives(`Futures data unavailable: ${msg}`);
    }
  }
}

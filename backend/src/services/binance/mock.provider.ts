import { TIMEFRAME_MS, type Timeframe } from '../../config/timeframes.js';
import type { Candle, DerivativesData, OrderBook, Ticker24h } from '../../types/market.js';
import { seededRandom } from '../../utils/math.js';
import type { KlineQuery, MarketDataProvider, SymbolInfo } from './provider.js';
import { markSuccess } from './status.js';

/**
 * MOCK_MODE ONLY. Deterministic synthetic market data for offline development and tests.
 * Never used when MOCK_MODE=false. Every response is tagged source='mock' upstream.
 */
const MOCK_BASES: Record<string, number> = {
  BTCUSDT: 60_000, ETHUSDT: 3_000, BNBUSDT: 550, SOLUSDT: 150, XRPUSDT: 0.6, DOGEUSDT: 0.12, ADAUSDT: 0.45, AVAXUSDT: 30, LINKUSDT: 14, DOTUSDT: 6,
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class MockProvider implements MarketDataProvider {
  readonly source = 'mock' as const;

  /** Price path is a function of (symbol, timeframe, candle index since epoch) so it is stable across calls. */
  private candleAt(symbol: string, tf: Timeframe, openTime: number): Candle {
    const step = TIMEFRAME_MS[tf];
    const idx = Math.floor(openTime / step);
    const base = MOCK_BASES[symbol] ?? 10;
    const seed = hash(symbol + tf);
    // Smooth multi-frequency wave + seeded noise, bounded around the base price
    const w = idx / 50;
    const drift = Math.sin(w + (seed % 7)) * 0.12 + Math.sin(w / 3.7 + (seed % 5)) * 0.2;
    const r = seededRandom(seed ^ idx);
    const noise = (r() - 0.5) * 0.02;
    const close = base * (1 + drift + noise);
    const prevR = seededRandom(seed ^ (idx - 1));
    const prevW = (idx - 1) / 50;
    const open = base * (1 + Math.sin(prevW + (seed % 7)) * 0.12 + Math.sin(prevW / 3.7 + (seed % 5)) * 0.2 + (prevR() - 0.5) * 0.02);
    const high = Math.max(open, close) * (1 + r() * 0.008);
    const low = Math.min(open, close) * (1 - r() * 0.008);
    const volume = (1_000_000 / base) * (0.6 + r() * 0.8);
    return { openTime: idx * step, closeTime: (idx + 1) * step - 1, open, high, low, close, volume, quoteVolume: volume * close };
  }

  async klines(symbol: string, tf: Timeframe, q: KlineQuery = {}): Promise<Candle[]> {
    markSuccess('binance');
    const step = TIMEFRAME_MS[tf];
    const limit = q.limit ?? 500;
    const nowOpen = Math.floor(Date.now() / step) * step;
    const end = Math.min(q.endTime ?? nowOpen, nowOpen);
    const start = q.startTime ? Math.ceil(q.startTime / step) * step : end - (limit - 1) * step;
    const out: Candle[] = [];
    for (let t = start; t <= end && out.length < limit; t += step) out.push(this.candleAt(symbol, tf, t));
    return out;
  }

  async ticker24h(symbol: string): Promise<Ticker24h> {
    const c = await this.klines(symbol, '1h', { limit: 25 });
    const last = c[c.length - 1];
    const first = c[0];
    return {
      symbol,
      lastPrice: last.close,
      openPrice: first.open,
      priceChange: last.close - first.open,
      priceChangePercent: ((last.close - first.open) / first.open) * 100,
      highPrice: Math.max(...c.map((x) => x.high)),
      lowPrice: Math.min(...c.map((x) => x.low)),
      volume: c.reduce((a, x) => a + x.volume, 0),
      quoteVolume: c.reduce((a, x) => a + (x.quoteVolume ?? 0), 0),
      closeTime: last.closeTime,
    };
  }

  async allTickers24h(): Promise<Ticker24h[]> {
    return Promise.all(Object.keys(MOCK_BASES).map((s) => this.ticker24h(s)));
  }

  async orderBook(symbol: string, limit = 20): Promise<OrderBook> {
    const t = await this.ticker24h(symbol);
    const p = t.lastPrice;
    return {
      lastUpdateId: 0,
      bids: Array.from({ length: limit }, (_, i) => [p * (1 - (i + 1) * 0.0005), 1 + i]),
      asks: Array.from({ length: limit }, (_, i) => [p * (1 + (i + 1) * 0.0005), 1 + i]),
    };
  }

  async exchangeInfo(): Promise<SymbolInfo[]> {
    return Object.keys(MOCK_BASES).map((s) => ({ symbol: s, baseAsset: s.replace('USDT', ''), quoteAsset: 'USDT', status: 'TRADING' }));
  }

  async derivatives(symbol: string): Promise<DerivativesData> {
    const r = seededRandom(hash(symbol) ^ Math.floor(Date.now() / 3_600_000));
    return {
      available: true,
      fundingRate: (r() - 0.3) * 0.03,
      nextFundingTime: Date.now() + 3_600_000,
      markPrice: (await this.ticker24h(symbol)).lastPrice,
      openInterest: 10_000 * r(),
      openInterestValue: 1e8 * r(),
      openInterestChangePct: (r() - 0.5) * 10,
      longShortRatio: 0.8 + r() * 0.8,
      futuresQuoteVolume: 1e9 * r(),
      liquidations: null,
    };
  }
}

import type { Timeframe } from '../../config/timeframes.js';
import type { Candle, DerivativesData, OrderBook, Ticker24h } from '../../types/market.js';

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}

export interface KlineQuery {
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export interface MarketDataProvider {
  readonly source: 'binance' | 'mock';
  ticker24h(symbol: string): Promise<Ticker24h>;
  allTickers24h(): Promise<Ticker24h[]>;
  klines(symbol: string, tf: Timeframe, q?: KlineQuery): Promise<Candle[]>;
  orderBook(symbol: string, limit?: number): Promise<OrderBook>;
  exchangeInfo(): Promise<SymbolInfo[]>;
  derivatives(symbol: string): Promise<DerivativesData>;
}

const STABLES = new Set(['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'EUR', 'AEUR', 'EURI', 'USDE', 'USD1', 'XUSD', 'BFUSD', 'PAXG', 'GBP', 'TRY', 'BRL', 'USDS']);

/** USDT spot pairs excluding stablecoins and leveraged tokens (used for breadth / movers). */
export function isAnalyzableUsdtPair(symbol: string): boolean {
  if (!symbol.endsWith('USDT')) return false;
  const base = symbol.slice(0, -4);
  if (!base || STABLES.has(base)) return false;
  if (/(UP|DOWN|BULL|BEAR)$/.test(base) && base.length > 4) return false;
  return true;
}

export const emptyDerivatives = (error?: string): DerivativesData => ({
  available: false,
  fundingRate: null,
  nextFundingTime: null,
  markPrice: null,
  openInterest: null,
  openInterestValue: null,
  openInterestChangePct: null,
  longShortRatio: null,
  futuresQuoteVolume: null,
  liquidations: null,
  error,
});

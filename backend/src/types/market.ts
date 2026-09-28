export interface Candle {
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume?: number;
  trades?: number;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  openPrice: number;
  closeTime: number;
}

export interface OrderBook {
  bids: [number, number][];
  asks: [number, number][];
  lastUpdateId: number;
}

export interface DerivativesData {
  available: boolean;
  fundingRate: number | null; // percent
  nextFundingTime: number | null;
  markPrice: number | null;
  openInterest: number | null; // contracts
  openInterestValue: number | null; // USDT
  openInterestChangePct: number | null; // over last 24h
  longShortRatio: number | null;
  futuresQuoteVolume: number | null;
  liquidations: number | null; // Binance no longer offers public REST liquidation history; stays null unless WS-aggregated
  error?: string;
}

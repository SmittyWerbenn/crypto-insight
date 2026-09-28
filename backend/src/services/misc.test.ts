import { describe, expect, it } from 'vitest';
import { shouldTrigger } from './alerts/alerts.service.js';
import { computeHoldings } from './portfolio/portfolio.service.js';
import { computeBreadth } from './market/market.service.js';
import { isAnalyzableUsdtPair } from './binance/provider.js';

describe('alerts', () => {
  it('evaluates price, RSI, score and signal alerts', () => {
    expect(shouldTrigger('PRICE_ABOVE', 100, { price: 101 })).toBe(101);
    expect(shouldTrigger('PRICE_ABOVE', 100, { price: 99 })).toBeNull();
    expect(shouldTrigger('PRICE_BELOW', 100, { price: 99 })).toBe(99);
    expect(shouldTrigger('RSI_ABOVE', 70, { rsi: 71 })).toBe(71);
    expect(shouldTrigger('RSI_BELOW', 30, { rsi: null })).toBeNull();
    expect(shouldTrigger('SCORE_ABOVE', 65, { score: 66 })).toBe(66);
    expect(shouldTrigger('SIGNAL_BUY', null, { signal: 'STRONG_BUY', score: 81 })).toBe(81);
    expect(shouldTrigger('SIGNAL_STRONG_BUY', null, { signal: 'BUY', score: 70 })).toBeNull();
    expect(shouldTrigger('SIGNAL_SELL', null, { signal: 'STRONG_SELL', score: 10 })).toBe(10);
  });
});

describe('portfolio average cost', () => {
  it('computes average buy price and realized P&L', () => {
    const h = computeHoldings([
      { symbol: 'BTCUSDT', side: 'BUY', quantity: 1, price: 100 },
      { symbol: 'BTCUSDT', side: 'BUY', quantity: 1, price: 200 },
      { symbol: 'BTCUSDT', side: 'SELL', quantity: 1, price: 300 },
    ]).get('BTCUSDT')!;
    expect(h.quantity).toBe(1);
    expect(h.averageBuyPrice).toBe(150);
    expect(h.realizedPnl).toBe(150);
  });
});

describe('market breadth', () => {
  it('labels breadth from advancers/decliners', () => {
    const mk = (p: number) => ({ symbol: 'X', lastPrice: 1, priceChange: 0, priceChangePercent: p, highPrice: 1, lowPrice: 1, volume: 1, quoteVolume: 1, openPrice: 1, closeTime: 0 });
    expect(computeBreadth([mk(2), mk(3), mk(-1)]).label).toBe('POSITIVE');
    expect(computeBreadth([mk(-2), mk(-3), mk(1)]).label).toBe('NEGATIVE');
  });
  it('excludes stablecoins and leveraged tokens', () => {
    expect(isAnalyzableUsdtPair('BTCUSDT')).toBe(true);
    expect(isAnalyzableUsdtPair('USDCUSDT')).toBe(false);
    expect(isAnalyzableUsdtPair('BTCUPUSDT')).toBe(false);
    expect(isAnalyzableUsdtPair('ETHBTC')).toBe(false);
  });
});

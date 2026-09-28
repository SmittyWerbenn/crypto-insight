import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { marketData } from '../services/binance/index.js';
import { getCandles } from '../services/market/candles.service.js';
import { getTicker, globalMarket, marketOverview, movers } from '../services/market/market.service.js';
import { derivativesFor } from '../services/analysis/analysis.service.js';
import { computeSeries } from '../services/technical/engine.js';
import { cache } from '../services/cache/cache.js';
import { SymbolParam, TimeframeSchema } from '../utils/validation.js';
import { fearGreed } from '../services/sentiment/sentiment.service.js';
import { usdtIdrRate } from '../services/market/fx.service.js';

const nn = (xs: number[]) => xs.map((v) => (Number.isFinite(v) ? v : null));

export async function marketRoutes(app: FastifyInstance) {
  app.get('/api/market/overview', async () => cache.wrap(`overview:${marketData.source}`, 10, marketOverview));
  app.get('/api/market/global', async () => ({ global: await globalMarket(), fearGreed: await fearGreed() }));
  app.get('/api/market/fx', async () => usdtIdrRate());

  app.get('/api/market/ticker/:symbol', async (req) => {
    const { symbol } = SymbolParam.parse(req.params);
    return getTicker(symbol);
  });

  app.get('/api/market/klines/:symbol', async (req) => {
    const { symbol } = SymbolParam.parse(req.params);
    const q = z
      .object({ timeframe: z.string().default('4h').pipe(TimeframeSchema), limit: z.coerce.number().int().min(10).max(1500).default(500), indicators: z.coerce.boolean().default(false) })
      .parse(req.query);
    // Fetch extra history so MA200 is warmed up for the visible range
    const warm = q.indicators ? 200 : 0;
    const candles = await getCandles(symbol, q.timeframe, { limit: q.limit + warm, includeLive: true });
    const visible = candles.slice(-q.limit);
    let indicators = null;
    if (q.indicators && candles.length) {
      const s = computeSeries(candles, q.timeframe);
      const off = candles.length - visible.length;
      const cut = (xs: number[]) => nn(xs.slice(off));
      indicators = {
        sma20: cut(s.sma20),
        sma50: cut(s.sma50),
        sma200: cut(s.sma200),
        bbUpper: cut(s.bb.upper),
        bbMiddle: cut(s.bb.middle),
        bbLower: cut(s.bb.lower),
        rsi: cut(s.rsi),
        macd: cut(s.macd.macd),
        macdSignal: cut(s.macd.signal),
        macdHistogram: cut(s.macd.histogram),
        volumeMa: cut(s.volumeMa),
      };
    }
    return { symbol, timeframe: q.timeframe, source: marketData.source, candles: visible, indicators, liveCandleIncluded: visible.length > 0 && visible[visible.length - 1].closeTime >= Date.now() };
  });

  app.get('/api/market/orderbook/:symbol', async (req) => {
    const { symbol } = SymbolParam.parse(req.params);
    return cache.wrap(`ob:${marketData.source}:${symbol}`, 3, () => marketData.orderBook(symbol, 20));
  });

  app.get('/api/market/derivatives/:symbol', async (req) => {
    const { symbol } = SymbolParam.parse(req.params);
    return derivativesFor(symbol);
  });

  const limitQ = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
  app.get('/api/market/gainers', async (req) => movers('gainers', limitQ.parse(req.query).limit));
  app.get('/api/market/losers', async (req) => movers('losers', limitQ.parse(req.query).limit));
  app.get('/api/market/volatility', async (req) => movers('volatility', limitQ.parse(req.query).limit));

  app.get('/api/market/symbols', async (req) => {
    const { q } = z.object({ q: z.string().trim().toUpperCase().max(20).default('') }).parse(req.query);
    const info = await cache.wrap(`exinfo:${marketData.source}`, 3600, () => marketData.exchangeInfo());
    return info
      .filter((s) => s.quoteAsset === 'USDT' && s.status === 'TRADING' && (s.symbol.includes(q) || s.baseAsset.includes(q)))
      .sort((a, b) => (a.baseAsset === q ? -1 : b.baseAsset === q ? 1 : a.symbol.localeCompare(b.symbol)))
      .slice(0, 20);
  });
}

import { env } from '../../config/env.js';
import { BinanceClient } from './binance.client.js';
import { MockProvider } from './mock.provider.js';
import type { MarketDataProvider } from './provider.js';

/** Single switch between real and mock data — never mixed. */
export const marketData: MarketDataProvider = env.MOCK_MODE ? new MockProvider() : new BinanceClient();
export const dataSource = marketData.source;
export { assertSymbol } from './binance.client.js';

import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { fetchJson } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { markFailure, markSuccess } from '../binance/status.js';
import { cache } from '../cache/cache.js';

export interface FxRate {
  base: 'USDT';
  quote: 'IDR';
  rate: number;
  source: string;
  updatedAt: number;
}

const isSane = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r > 1000 && r < 1_000_000;

/**
 * USDT→IDR rate for display conversion. Market data stays in USDT; the frontend converts.
 * Primary: CoinGecko Tether/IDR (the actual USDT price). Fallback: ExchangeRate-API USD/IDR.
 * Cached 10 minutes; if both sources fail the last good rate is served for up to 24h.
 */
export async function usdtIdrRate(): Promise<FxRate> {
  if (env.MOCK_MODE) return { base: 'USDT', quote: 'IDR', rate: 16_000, source: 'mock (MOCK_MODE)', updatedAt: Date.now() };
  const fresh = await cache.get<FxRate>('fx:usdt-idr');
  if (fresh) return fresh;

  const sources: [string, () => Promise<number>][] = [
    [
      'CoinGecko (USDT/IDR)',
      async () => (await fetchJson<{ tether?: { idr?: number } }>(`${env.COINGECKO_API_URL}/simple/price?ids=tether&vs_currencies=idr`, { timeoutMs: 8000 })).tether?.idr ?? NaN,
    ],
    ['ExchangeRate-API (USD/IDR)', async () => (await fetchJson<{ rates?: { IDR?: number } }>(env.FX_FALLBACK_API_URL, { timeoutMs: 8000 })).rates?.IDR ?? NaN],
  ];
  for (const [source, fn] of sources) {
    try {
      const rate = await fn();
      if (!isSane(rate)) throw new Error(`implausible rate ${rate}`);
      const out: FxRate = { base: 'USDT', quote: 'IDR', rate, source, updatedAt: Date.now() };
      await cache.set('fx:usdt-idr', out, 600);
      await cache.set('fx:usdt-idr:last', out, 86_400);
      markSuccess('fx');
      return out;
    } catch (e) {
      logger.warn({ source, err: (e as Error).message }, 'FX source failed');
    }
  }
  markFailure('fx', 'all FX sources failed');
  const last = await cache.get<FxRate>('fx:usdt-idr:last');
  if (last) return last;
  throw new AppError(503, 'FX_UNAVAILABLE', 'Kurs USDT/IDR sementara tidak tersedia.');
}

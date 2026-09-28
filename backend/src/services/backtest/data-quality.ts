import { TIMEFRAME_MS, type Timeframe } from '../../config/timeframes.js';
import type { Candle } from '../../types/market.js';
import { median } from '../../utils/math.js';
import type { DataQualityReport } from './types.js';

/**
 * Validate and clean a candle series. Duplicates are removed (first occurrence kept) and
 * invalid candles dropped; the report lists every problem so it can be surfaced to the user.
 */
export function checkDataQuality(raw: Candle[], tf: Timeframe): { candles: Candle[]; report: DataQualityReport } {
  const step = TIMEFRAME_MS[tf];
  const sorted = [...raw].sort((a, b) => a.openTime - b.openTime);
  const seen = new Set<number>();
  const clean: Candle[] = [];
  let duplicates = 0;
  let invalid = 0;
  let zeroVol = 0;
  for (const c of sorted) {
    if (seen.has(c.openTime)) {
      duplicates++;
      continue;
    }
    seen.add(c.openTime);
    const vals = [c.open, c.high, c.low, c.close, c.volume];
    const bad =
      vals.some((v) => !Number.isFinite(v)) ||
      c.open <= 0 ||
      c.close <= 0 ||
      c.low <= 0 ||
      c.high < Math.max(c.open, c.close, c.low) ||
      c.low > Math.min(c.open, c.close, c.high) ||
      c.volume < 0;
    if (bad) {
      invalid++;
      continue;
    }
    if (c.volume === 0) zeroVol++;
    clean.push(c);
  }

  const gaps: DataQualityReport['gaps'] = [];
  let missing = 0;
  // Weekly/monthly Binance candles align to calendar boundaries; only check gaps for <= 1d.
  if (tf !== '1w') {
    for (let i = 1; i < clean.length; i++) {
      const diff = clean[i].openTime - clean[i - 1].openTime;
      if (diff > step) {
        const m = Math.round(diff / step) - 1;
        missing += m;
        gaps.push({ from: clean[i - 1].openTime, to: clean[i].openTime, missing: m });
      }
    }
  }

  const medVol = median(clean.map((c) => c.volume).filter((v) => v > 0));
  const spikes = Number.isFinite(medVol) ? clean.filter((c) => c.volume > medVol * 50).length : 0;

  const warnings: string[] = [];
  if (duplicates) warnings.push(`${duplicates} candle duplikat dihapus.`);
  if (invalid) warnings.push(`${invalid} candle OHLC tidak valid dihapus.`);
  if (missing) warnings.push(`${missing} candle hilang di ${gaps.length} celah.`);
  if (zeroVol) warnings.push(`${zeroVol} candle dengan volume nol.`);
  if (spikes) warnings.push(`${spikes} candle dengan volume tidak wajar (>50× median).`);

  const expected = clean.length + missing;
  const severe = clean.length < 2 || (expected > 0 && (missing + invalid) / expected > 0.05);
  return {
    candles: clean,
    report: {
      ok: warnings.length === 0,
      severe,
      totalCandles: raw.length,
      missingCandles: missing,
      duplicateCandles: duplicates,
      invalidCandles: invalid,
      zeroVolumeCandles: zeroVol,
      volumeSpikes: spikes,
      gaps: gaps.slice(0, 50),
      warnings,
    },
  };
}

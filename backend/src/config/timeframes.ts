export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const BACKTEST_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

/** Binance interval strings; frontend may send "1D"/"1W". */
export function normalizeTimeframe(tf: string): Timeframe {
  const t = tf.trim();
  const lower = t === '1D' || t === '1W' ? t.toLowerCase() : t;
  if ((TIMEFRAMES as readonly string[]).includes(lower)) return lower as Timeframe;
  throw new Error(`Unsupported timeframe: ${tf}`);
}

/** Next-lower timeframe used to resolve intrabar ambiguity (target & stop in same candle). */
export const LOWER_TIMEFRAME: Partial<Record<Timeframe, Timeframe>> = {
  '5m': '1m',
  '15m': '1m',
  '1h': '5m',
  '4h': '15m',
  '1d': '1h',
  '1w': '4h',
};

/** Periods per year, used to annualize Sharpe/Sortino. */
export const PERIODS_PER_YEAR: Record<Timeframe, number> = {
  '1m': 525_600,
  '5m': 105_120,
  '15m': 35_040,
  '1h': 8_760,
  '4h': 2_190,
  '1d': 365,
  '1w': 52,
};

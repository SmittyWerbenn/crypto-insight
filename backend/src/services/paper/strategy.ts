import type { BtcContext, CoinFeatures } from './features.js';

/**
 * Paper Trading V2 strategy: "volume breakout in an uptrend", long only, intraday.
 * Every number here came out of the research backtest (train 2025, validation 2026-H1, test 2026-Q3);
 * see docs/paper-trading-v2.md for the evidence behind each rule.
 */
export interface StrategyConfig {
  /** Close above the highest high of the previous N 1h candles. */
  breakoutLookback: number;
  /** Signal-candle volume vs its 20-candle average. */
  minVolRatio: number;
  /** Coin 1h regime required (SMA50/SMA200). */
  coinRegime: 'BULL' | 'ANY';
  /** BTC 30-day return must be above this (macro filter: no long trades in a BTC downtrend → hold cash). */
  btcRet30dMin: number;
  /** Take profit / stop loss as multiples of the coin's 1h ATR, from the fill price. */
  tpAtr: number;
  slAtr: number;
  /** Close at market after this many hours (never more than 24). */
  maxHoldH: number;
}

export const STRATEGY_V2: StrategyConfig = {
  breakoutLookback: 20,
  minVolRatio: 3,
  coinRegime: 'BULL',
  btcRet30dMin: 0,
  tpAtr: 0.75,
  slAtr: 2.5,
  maxHoldH: 8,
};

/** Why a candidate was rejected, or null when every entry rule passes. */
export function entryCheck(f: CoinFeatures, btc: BtcContext, cfg: StrategyConfig = STRATEGY_V2): string | null {
  if (btc.ret30d <= cfg.btcRet30dMin) return `BTC 30 hari ${btc.ret30d.toFixed(1)}% (tren turun) — tahan cash`;
  if (cfg.coinRegime === 'BULL' && f.regime !== 'BULL') return `Regime koin ${f.regime}`;
  if (f.hh20Atr <= 0) return 'Belum breakout di atas high 20 jam';
  if (f.volRatio < cfg.minVolRatio) return `Volume ${f.volRatio.toFixed(1)}x < ${cfg.minVolRatio}x rata-rata`;
  return null;
}

export interface Levels {
  tp: number;
  sl: number;
  tpPct: number;
  slPct: number;
}

export function levelsFor(fill: number, atrPct: number, cfg: StrategyConfig = STRATEGY_V2): Levels {
  const tpPct = cfg.tpAtr * atrPct;
  const slPct = cfg.slAtr * atrPct;
  return { tp: fill * (1 + tpPct / 100), sl: fill * (1 - slPct / 100), tpPct, slPct };
}

/**
 * Correlation clusters from 2025 1h returns: alts average 0.67 pairwise correlation and 1.4–2× BTC beta,
 * so several "different" alts are one market exposure. Each cluster has its own exposure cap.
 */
export const CLUSTERS: Record<string, string> = {
  BTCUSDT: 'MAJOR',
  ETHUSDT: 'MAJOR',
  BNBUSDT: 'MAJOR',
  SOLUSDT: 'ALT_BETA',
  AVAXUSDT: 'ALT_BETA',
  ADAUSDT: 'ALT_BETA',
  NEARUSDT: 'ALT_BETA',
  SUIUSDT: 'ALT_BETA',
  LINKUSDT: 'ALT_BETA',
  AAVEUSDT: 'ALT_BETA',
  UNIUSDT: 'ALT_BETA',
  DOGEUSDT: 'ALT_BETA',
  XRPUSDT: 'ALT_BETA',
  XLMUSDT: 'ALT_BETA',
  HBARUSDT: 'ALT_BETA',
};
/** Coins with BTC correlation < 0.65 (ZEC, QNT, PUMP, ENA, WLD, MOVR, …) and anything unknown. */
export const clusterOf = (symbol: string) => CLUSTERS[symbol] ?? 'IDIOSYNCRATIC';

/** Fixed research universe (liquid Binance USDT pairs with ≥ 1 year of history used in the backtest). */
export const UNIVERSE_V2 = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT',
  'HBARUSDT', 'ENAUSDT', 'WLDUSDT', 'QNTUSDT', 'MOVRUSDT', 'AAVEUSDT', 'UNIUSDT', 'XLMUSDT', 'ZECUSDT', 'PUMPUSDT',
];

import type { BtcContext, CoinFeatures } from './features.js';

/**
 * Paper Trading V2 strategy: "volume breakout in an uptrend", long only, intraday.
 * Every number here came out of the research backtest (train 2025, validation 2026-H1, test 2026-Q3);
 * see docs/paper-trading-v2.md for the evidence behind each rule.
 *
 * A *signal* is any 1h candle that closes above the high of the previous 20 candles on ≥ 1.5x volume.
 * Each profile then accepts or rejects that signal with its own thresholds; a rejected signal keeps its reasons,
 * so "no opportunity" (no signal) and "filter too strict" (signal rejected) can be told apart.
 */
export type Regime = 'BULL' | 'BEAR' | 'SIDEWAYS';

export interface StrategyConfig {
  /** Signal-candle volume vs its 20-candle average. */
  minVolRatio: number;
  /** Coin 1h regimes (SMA50/SMA200) that are accepted. */
  regimes: Regime[];
  /** BTC 30-day return must be above this (macro filter); null = no BTC filter. */
  btcRet30dMin: number | null;
  /** Require EMA20 > EMA50 on the coin (short-term momentum up). */
  requireEmaUp: boolean;
  /** Close must clear the 20h high by at least this many ATR. */
  minBreakoutAtr: number;
  /** Coin 1h ATR% range. Below the minimum the target is too small to beat fees; above the maximum the stop is too wide. */
  minAtrPct: number;
  maxAtrPct: number;
  /** Take profit / stop loss as multiples of the coin's 1h ATR, from the fill price. */
  tpAtr: number;
  slAtr: number;
  /** Close at market after this many hours (never more than 24). */
  maxHoldH: number;
}

/** Signal universe shared by every profile. */
export const SIGNAL_MIN_VOL = 1.5;
export const isSignal = (f: CoinFeatures) => f.hh20Atr > 0 && f.volRatio >= SIGNAL_MIN_VOL;

/** BTC macro state from its 30-day return: BULL > 0%, NEUTRAL −5…0%, BEAR ≤ −5%. */
export const btcState = (btc: BtcContext) => (btc.ret30d > 0 ? 'BULL' : btc.ret30d > -5 ? 'NEUTRAL' : 'BEAR');

export type RejectCode =
  | 'BTC_BEAR'
  | 'BTC_NEUTRAL'
  | 'COIN_REGIME'
  | 'VOLUME'
  | 'MOMENTUM'
  | 'BREAKOUT_WEAK'
  | 'ATR_LOW'
  | 'RISK_HIGH'
  | 'PRICE_MOVED'
  | 'HAS_POSITION'
  | 'MAX_POSITIONS'
  | 'MAX_EXPOSURE'
  | 'CLUSTER'
  | 'CASH'
  | 'NO_PRICE';

export const REJECT_LABEL: Record<RejectCode, string> = {
  BTC_BEAR: 'BTC Bear',
  BTC_NEUTRAL: 'BTC Neutral',
  COIN_REGIME: 'Regime koin tidak sesuai',
  VOLUME: 'Volume tidak cukup',
  MOMENTUM: 'Momentum lemah (EMA20 < EMA50)',
  BREAKOUT_WEAK: 'Breakout terlalu tipis',
  ATR_LOW: 'ATR terlalu kecil (target < biaya)',
  RISK_HIGH: 'Risk terlalu tinggi (ATR terlalu besar)',
  PRICE_MOVED: 'Harga sudah bergerak dari signal',
  HAS_POSITION: 'Sudah memiliki posisi',
  MAX_POSITIONS: 'Maksimum posisi tercapai',
  MAX_EXPOSURE: 'Maksimum exposure tercapai',
  CLUSTER: 'Correlated exposure terlalu tinggi',
  CASH: 'Cash tidak cukup',
  NO_PRICE: 'Harga live tidak tersedia',
};

export interface Rejection {
  code: RejectCode;
  detail: string;
}

/** Every rule the signal fails (empty = accepted by the strategy rules; money caps are checked later). */
export function rejectReasons(f: CoinFeatures, btc: BtcContext, cfg: StrategyConfig): Rejection[] {
  const out: Rejection[] = [];
  if (cfg.btcRet30dMin !== null && btc.ret30d <= cfg.btcRet30dMin)
    out.push({ code: btcState(btc) === 'BEAR' ? 'BTC_BEAR' : 'BTC_NEUTRAL', detail: `BTC 30 hari ${btc.ret30d.toFixed(1)}% (min > ${cfg.btcRet30dMin}%)` });
  if (!cfg.regimes.includes(f.regime)) out.push({ code: 'COIN_REGIME', detail: `Regime koin ${f.regime} (butuh ${cfg.regimes.join('/')})` });
  if (f.volRatio < cfg.minVolRatio) out.push({ code: 'VOLUME', detail: `Volume ${f.volRatio.toFixed(1)}x < ${cfg.minVolRatio}x` });
  if (cfg.requireEmaUp && !f.emaUp) out.push({ code: 'MOMENTUM', detail: 'EMA20 di bawah EMA50' });
  if (f.hh20Atr < cfg.minBreakoutAtr) out.push({ code: 'BREAKOUT_WEAK', detail: `Breakout ${f.hh20Atr.toFixed(2)} ATR < ${cfg.minBreakoutAtr} ATR` });
  if (f.atrPct < cfg.minAtrPct) out.push({ code: 'ATR_LOW', detail: `ATR ${f.atrPct.toFixed(2)}% < ${cfg.minAtrPct}%` });
  if (f.atrPct > cfg.maxAtrPct) out.push({ code: 'RISK_HIGH', detail: `ATR ${f.atrPct.toFixed(2)}% > ${cfg.maxAtrPct}% (stop ${(cfg.slAtr * f.atrPct).toFixed(1)}%)` });
  return out;
}

/** Live only: skip when the fill has already run away from the signal close (> 0.5 ATR below or > 1 ATR above). */
export function priceMoved(signalClose: number, price: number, atrPct: number): Rejection | null {
  const dev = ((price / signalClose - 1) * 100) / atrPct;
  if (dev < -0.5) return { code: 'PRICE_MOVED', detail: `Harga sudah turun ${(-dev).toFixed(2)} ATR dari close signal` };
  if (dev > 1) return { code: 'PRICE_MOVED', detail: `Harga sudah naik ${dev.toFixed(2)} ATR dari close signal (kejar harga)` };
  return null;
}

/** First failing rule as text, or null (kept for the research scripts). */
export function entryCheck(f: CoinFeatures, btc: BtcContext, cfg: StrategyConfig): string | null {
  if (!isSignal(f)) return 'Tidak ada signal breakout';
  const r = rejectReasons(f, btc, cfg);
  return r.length ? r[0].detail : null;
}

export interface Levels {
  tp: number;
  sl: number;
  tpPct: number;
  slPct: number;
}

export function levelsFor(fill: number, atrPct: number, cfg: StrategyConfig): Levels {
  const tpPct = cfg.tpAtr * atrPct;
  const slPct = cfg.slAtr * atrPct;
  return { tp: fill * (1 + tpPct / 100), sl: fill * (1 - slPct / 100), tpPct, slPct };
}

export type ProfileId = 'AMAN' | 'MENENGAH' | 'AGRESIF';
export const PROFILE_IDS: ProfileId[] = ['AMAN', 'MENENGAH', 'AGRESIF'];

/**
 * Three profiles that differ in how selective they are, not only in size. Thresholds are nested
 * (every Aman signal passes Menengah, every Menengah signal passes Agresif) and come from the
 * 2025 train / 2026-H1 validation backtest with 0.1% fee per side:
 *  - BTC Neutral and coin SIDEWAYS signals lost money after fees in train and test → rejected by every profile.
 *  - ATR < 1% loses after fees (the target is too small) → minimum for every profile.
 *  - The engine score has no relation to the outcome of a breakout → not used as a threshold.
 *  - Volume and breakout strength are the selectivity dials: Aman ≥ 4x and ≥ 0.25 ATR, Menengah ≥ 3x, Agresif ≥ 1.5x.
 * Aman takes a near target (0.75 ATR) with a wide stop: high TARGET rate, few CUTLOSS.
 * Menengah and Agresif aim for 2 ATR with a 2 ATR stop: more CUTLOSS, but more profit per trade.
 */
export const PROFILES: Record<ProfileId, StrategyConfig> = {
  AMAN: { minVolRatio: 4, regimes: ['BULL'], btcRet30dMin: 0, requireEmaUp: true, minBreakoutAtr: 0.25, minAtrPct: 1, maxAtrPct: 3, tpAtr: 0.75, slAtr: 2.5, maxHoldH: 8 },
  MENENGAH: { minVolRatio: 3, regimes: ['BULL'], btcRet30dMin: 0, requireEmaUp: true, minBreakoutAtr: 0, minAtrPct: 1, maxAtrPct: 4, tpAtr: 2, slAtr: 2, maxHoldH: 12 },
  AGRESIF: { minVolRatio: 1.5, regimes: ['BULL'], btcRet30dMin: 0, requireEmaUp: true, minBreakoutAtr: 0, minAtrPct: 1, maxAtrPct: 6, tpAtr: 2, slAtr: 2, maxHoldH: 12 },
};

export const PROFILE_LABEL: Record<ProfileId, string> = { AMAN: 'Aman', MENENGAH: 'Menengah', AGRESIF: 'Agresif' };

/** The first V2 strategy (2026-10-02), kept as the research baseline. */
export const STRATEGY_V2: StrategyConfig = {
  minVolRatio: 3,
  regimes: ['BULL'],
  btcRet30dMin: 0,
  requireEmaUp: false,
  minBreakoutAtr: 0,
  minAtrPct: 0,
  maxAtrPct: 100,
  tpAtr: 0.75,
  slAtr: 2.5,
  maxHoldH: 8,
};

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

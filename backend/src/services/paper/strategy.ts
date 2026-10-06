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
  /** Take profit / stop loss as multiples of the coin's 1h ATR, from the fill price. null = no target: the
   * trade runs until the stop or the time limit (lets the big breakouts pay for the many small stops). */
  tpAtr: number | null;
  slAtr: number;
  /** Close at market after this many hours. */
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
  /** null = no target (exit on the stop or the time limit). */
  tp: number | null;
  sl: number;
  tpPct: number | null;
  slPct: number;
}

export function levelsFor(fill: number, atrPct: number, cfg: StrategyConfig): Levels {
  const tpPct = cfg.tpAtr === null ? null : cfg.tpAtr * atrPct;
  const slPct = cfg.slAtr * atrPct;
  return { tp: tpPct === null ? null : fill * (1 + tpPct / 100), sl: fill * (1 - slPct / 100), tpPct, slPct };
}

export type ProfileId = 'AMAN' | 'MENENGAH' | 'AGRESIF';
export const PROFILE_IDS: ProfileId[] = ['AMAN', 'MENENGAH', 'AGRESIF'];

/**
 * Three profiles (revision 2026-10-06, see docs/paper-trading-v2.md "Revisi exit & universe"). Research on 59
 * coins (the 21 original + 38 liquid coins never used to pick rules), 2025 train / 2026-H1 valid / 2026-Q3 test,
 * 0.1% fee per side:
 *  - Exit: no take profit (Aman: a far one), stop 2 ATR, close after 48h. Beat the old fixed targets (0.75–2 ATR, 8–12h) for every
 *    profile, in every period and on the unseen coins (where the old exits lost money). Win rate drops to ~30–35%:
 *    many small stops, paid for by a few large breakouts.
 *  - BTC Neutral, coin SIDEWAYS, EMA20 < EMA50 and ATR < 1% lose after fees → rejected by every profile.
 *  - Volume ≥ 1.5x (the old Agresif) added mostly losing signals on the new coins → Agresif now uses the
 *    Menengah filters and differs by size (risk per trade, positions, reserve), not by weaker signals.
 *  - Aman stays the most selective (volume ≥ 4x, breakout ≥ 0.25 ATR, ATR 1–3%) and takes profit at 12 ATR:
 *    without a target a few extreme spikes (MOVR +200%) were given back, which pushed its drawdown to −26%;
 *    with 12 ATR it was −7% with fewer losing months, for a somewhat lower return.
 * Thresholds stay nested (Aman ⊆ Menengah ⊆ Agresif).
 */
export const PROFILES: Record<ProfileId, StrategyConfig> = {
  AMAN: { minVolRatio: 4, regimes: ['BULL'], btcRet30dMin: 0, requireEmaUp: true, minBreakoutAtr: 0.25, minAtrPct: 1, maxAtrPct: 3, tpAtr: 12, slAtr: 2, maxHoldH: 48 },
  MENENGAH: { minVolRatio: 3, regimes: ['BULL'], btcRet30dMin: 0, requireEmaUp: true, minBreakoutAtr: 0, minAtrPct: 1, maxAtrPct: 4, tpAtr: null, slAtr: 2, maxHoldH: 48 },
  AGRESIF: { minVolRatio: 3, regimes: ['BULL'], btcRet30dMin: 0, requireEmaUp: true, minBreakoutAtr: 0, minAtrPct: 1, maxAtrPct: 4, tpAtr: null, slAtr: 2, maxHoldH: 48 },
};

/** Profile rules before the 2026-10-06 revision (fixed targets, Agresif volume ≥ 1.5x), kept for the research comparison. */
export const PROFILES_V1: Record<ProfileId, StrategyConfig> = {
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

/** Added 2026-10-06: liquid Binance spot USDT pairs (> $3M/day) with history since 2024-11, tested out of sample. */
export const UNIVERSE_EXTRA = [
  'HYPEUSDT', 'TAOUSDT', 'FETUSDT', 'FILUSDT', 'ZROUSDT', 'TRXUSDT', 'PEPEUSDT', 'ONDOUSDT', 'LTCUSDT', 'ARBUSDT', 'PENGUUSDT',
  'SANDUSDT', 'ICPUSDT', 'APTUSDT', 'TRUMPUSDT', 'DOTUSDT', 'RENDERUSDT', 'DASHUSDT', 'BCHUSDT', 'STRKUSDT', 'RAYUSDT',
  'VIRTUALUSDT', 'TONUSDT', 'POLUSDT', 'INJUSDT', 'SEIUSDT', 'OPUSDT', 'JUPUSDT', 'TIAUSDT', 'ETCUSDT', 'ATOMUSDT', 'WIFUSDT',
  'BONKUSDT', 'SHIBUSDT', 'FLOKIUSDT', 'CRVUSDT', 'LDOUSDT', 'ALGOUSDT',
];

/** Coins the live engine scans every hour. */
export const UNIVERSE = [...UNIVERSE_V2, ...UNIVERSE_EXTRA];

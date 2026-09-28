import { PERIODS_PER_YEAR } from '../../config/timeframes.js';
import type { Candle } from '../../types/market.js';
import { median } from '../../utils/math.js';
import { scoreSnapshot, signalFromScore, type ScoreResult } from '../scoring/scoring.js';
import { computeSeries, DEFAULT_INDICATOR_PARAMS, snapshotAt, type IndicatorParams, type IndicatorSeries, type TechnicalSnapshot } from '../technical/engine.js';
import { computeMetrics, monthlyReturns, regimeBreakdown } from './metrics.js';
import { getStrategy } from './strategies/index.js';
import type { BacktestConfig, BacktestResult, EngineInput, EquityPoint, ExitReason, MarketRegime, StrategyContext, StrategyParams, Trade } from './types.js';

export class LookAheadError extends Error {}

export function indicatorParamsFrom(params: StrategyParams): IndicatorParams {
  const n = (k: keyof IndicatorParams) => (typeof params[k] === 'number' ? (params[k] as number) : DEFAULT_INDICATOR_PARAMS[k]);
  return { maFast: n('maFast'), maSlow: n('maSlow'), maLong: n('maLong'), rsiPeriod: n('rsiPeriod'), macdFast: n('macdFast'), macdSlow: n('macdSlow'), macdSignal: n('macdSignal') };
}

/** Lazily computed, cached snapshots/scores that only ever read data up to the requested index. */
export class CausalCache {
  private snaps = new Map<number, TechnicalSnapshot>();
  private scores = new Map<number, ScoreResult>();
  constructor(
    private candles: Candle[],
    private series: IndicatorSeries,
  ) {}
  snapshot(i: number): TechnicalSnapshot {
    let s = this.snaps.get(i);
    if (!s) {
      s = snapshotAt(this.candles, this.series, i);
      this.snaps.set(i, s);
    }
    return s;
  }
  score(i: number): ScoreResult {
    let r = this.scores.get(i);
    if (!r) {
      r = scoreSnapshot(this.snapshot(i), i > 0 ? this.snapshot(i - 1) : null);
      this.scores.set(i, r);
    }
    return r;
  }
}

function regimeOf(s: TechnicalSnapshot): MarketRegime {
  if (s.sma200 === null || s.sma50 === null) return 'SIDEWAYS';
  if (s.price > s.sma200 && s.sma50 > s.sma200) return 'BULL';
  if (s.price < s.sma200 && s.sma50 < s.sma200) return 'BEAR';
  return 'SIDEWAYS';
}

interface OpenPosition {
  entryIndex: number;
  entryTime: number;
  entrySignalPrice: number;
  entryPrice: number;
  quantity: number;
  cost: number; // notional + entry fee
  entryFee: number;
  entrySlip: number;
  stop: number | null;
  target: number | null;
  maxHigh: number;
  minLow: number;
  entryReason: string;
  equityBefore: number;
  regime: MarketRegime;
  volatilityRegime: 'HIGH' | 'LOW';
  entryScore: number;
}

/**
 * Event loop, candle by candle:
 *   1. fill orders decided at the previous candle's close at THIS candle's open (+slippage, +fee)
 *   2. check stop-loss / take-profit intrabar
 *   3. mark equity at close
 *   4. evaluate the strategy with data up to and including this candle → order for next open
 * A decision made at candle T can therefore never be filled at a price from candle T or earlier,
 * and the strategy never sees candle T+1.
 */
export function runBacktest(cfg: BacktestConfig, input: EngineInput): BacktestResult {
  const { candles } = input;
  if (candles.length < 2) throw new Error('Insufficient historical data');
  if (!(cfg.positionSize > 0 && cfg.positionSize <= 1)) throw new Error('positionSize must be in (0, 1]');
  const strategy = getStrategy(cfg.strategy);
  const params: StrategyParams = { ...strategy.defaultParams, ...(cfg.params ?? {}) };
  const series = input.series ?? computeSeries(candles, cfg.timeframe, indicatorParamsFrom(params));
  const cache = new CausalCache(candles, series);
  const n = candles.length;

  const from = cfg.tradeFrom ?? candles[0].openTime;
  const to = cfg.tradeTo ?? candles[n - 1].openTime;
  const inWindow = (i: number) => candles[i].openTime >= from && candles[i].openTime <= to;
  let lastWindowIdx = -1;
  for (let i = n - 1; i >= 0; i--)
    if (inWindow(i)) {
      lastWindowIdx = i;
      break;
    }
  if (lastWindowIdx < 0) throw new Error('No candles inside the requested trading window');

  let cash = cfg.initialCapital;
  let pos: OpenPosition | null = null;
  let pendingEntry: { reason: string; signalIndex: number } | null = null;
  let pendingExit: { reason: string } | null = null;
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];
  const signalDistribution: Record<string, number> = { STRONG_BUY: 0, BUY: 0, HOLD: 0, SELL: 0, STRONG_SELL: 0 };
  let peak = cfg.initialCapital;
  let inPosCandles = 0;
  let windowCandles = 0;
  const warnings: string[] = [];

  const closePosition = (i: number, rawPrice: number, reason: ExitReason, detail: string, ambiguous = false) => {
    if (!pos) return;
    const fill = rawPrice * (1 - cfg.slippage);
    const proceeds = pos.quantity * fill;
    const exitFee = proceeds * cfg.fee;
    const exitSlip = pos.quantity * (rawPrice - fill);
    cash += proceeds - exitFee;
    const netPnl = proceeds - exitFee - pos.cost;
    const c = candles[i];
    // MFE/MAE bounded by the exit level on the exit candle
    let hi = pos.maxHigh;
    let lo = pos.minLow;
    if (reason === 'STOP_LOSS') lo = Math.min(lo, rawPrice);
    else if (reason === 'TAKE_PROFIT') hi = Math.max(hi, rawPrice);
    const exitTime = reason === 'END_OF_DATA' ? c.closeTime : c.openTime;
    trades.push({
      entryTime: pos.entryTime,
      exitTime,
      symbol: cfg.symbol,
      side: 'LONG',
      entrySignalPrice: pos.entrySignalPrice,
      entryPrice: pos.entryPrice,
      exitSignalPrice: rawPrice,
      exitPrice: fill,
      quantity: pos.quantity,
      grossPnl: pos.quantity * (rawPrice - pos.entrySignalPrice),
      fees: pos.entryFee + exitFee,
      slippageCost: pos.entrySlip + exitSlip,
      netPnl,
      returnPct: (netPnl / pos.cost) * 100,
      equityReturnPct: (netPnl / pos.equityBefore) * 100,
      holdingMs: exitTime - pos.entryTime,
      holdingCandles: i - pos.entryIndex + (reason === 'END_OF_DATA' ? 1 : 0),
      exitReason: reason,
      entryReason: pos.entryReason,
      exitDetail: detail,
      mfePct: ((hi - pos.entryPrice) / pos.entryPrice) * 100,
      maePct: ((lo - pos.entryPrice) / pos.entryPrice) * 100,
      ambiguous,
      regime: pos.regime,
      volatilityRegime: pos.volatilityRegime,
      entryScore: pos.entryScore,
    });
    pos = null;
  };

  for (let t = 0; t < n; t++) {
    const c = candles[t];

    // 1a. Exit order from previous close
    if (pendingExit && pos) {
      closePosition(t, c.open, 'SIGNAL', pendingExit.reason);
    }
    pendingExit = null;

    // 1b. Entry order from previous close (only if still inside the window)
    if (pendingEntry && !pos && inWindow(t)) {
      const sigSnap = cache.snapshot(pendingEntry.signalIndex);
      const equityNow = cash;
      const fill = c.open * (1 + cfg.slippage);
      const notional = Math.min(equityNow * cfg.positionSize, cash / (1 + cfg.fee));
      const qty = notional / fill;
      const entryFee = notional * cfg.fee;
      cash -= notional + entryFee;
      const hvWindow = series.hv.slice(Math.max(0, pendingEntry.signalIndex - 100), pendingEntry.signalIndex + 1).filter(Number.isFinite);
      pos = {
        entryIndex: t,
        entryTime: c.openTime,
        entrySignalPrice: c.open,
        entryPrice: fill,
        quantity: qty,
        cost: notional + entryFee,
        entryFee,
        entrySlip: qty * (fill - c.open),
        stop: cfg.stopLoss ? fill * (1 - cfg.stopLoss) : null,
        target: cfg.takeProfit ? fill * (1 + cfg.takeProfit) : null,
        maxHigh: c.open,
        minLow: c.open,
        entryReason: pendingEntry.reason,
        equityBefore: equityNow,
        regime: regimeOf(sigSnap),
        volatilityRegime: sigSnap.historicalVolatility !== null && hvWindow.length && sigSnap.historicalVolatility > median(hvWindow) ? 'HIGH' : 'LOW',
        entryScore: cache.score(pendingEntry.signalIndex).score,
      };
    }
    pendingEntry = null;

    // 2. Stop / target inside this candle
    if (pos) {
      const p: OpenPosition = pos;
      const isEntryCandle = p.entryIndex === t;
      if (!isEntryCandle && p.stop !== null && c.open <= p.stop) closePosition(t, c.open, 'STOP_LOSS', 'Gap below stop — filled at open');
      else if (!isEntryCandle && p.target !== null && c.open >= p.target) closePosition(t, c.open, 'TAKE_PROFIT', 'Gap above target — filled at open');
      else {
        const hitStop = p.stop !== null && c.low <= p.stop;
        const hitTarget = p.target !== null && c.high >= p.target;
        if (hitStop && hitTarget) {
          const r = input.resolveIntrabar?.(c, p.stop!, p.target!) ?? null;
          if (r === 'TARGET') closePosition(t, p.target!, 'TAKE_PROFIT', 'Target hit first (lower timeframe)');
          else if (r === 'STOP') closePosition(t, p.stop!, 'STOP_LOSS', 'Stop hit first (lower timeframe)');
          else closePosition(t, p.stop!, 'STOP_LOSS', 'Ambiguous: stop & target in same candle — conservatively assumed stop', true);
        } else if (hitStop) closePosition(t, p.stop!, 'STOP_LOSS', 'Stop loss hit');
        else if (hitTarget) closePosition(t, p.target!, 'TAKE_PROFIT', 'Take profit hit');
        else {
          p.maxHigh = Math.max(p.maxHigh, c.high);
          p.minLow = Math.min(p.minLow, c.low);
        }
      }
    }

    const tradeable = inWindow(t);
    // Force-close at the end of the trading window
    if (pos && t === lastWindowIdx) {
      const p: OpenPosition = pos;
      p.maxHigh = Math.max(p.maxHigh, c.high);
      p.minLow = Math.min(p.minLow, c.low);
      closePosition(t, c.close, 'END_OF_DATA', 'Closed at end of test period');
    }

    // 3. Mark to market
    if (tradeable) {
      windowCandles++;
      if (pos) inPosCandles++;
      const eq = cash + (pos ? (pos as OpenPosition).quantity * c.close : 0);
      peak = Math.max(peak, eq);
      equity.push({ time: c.openTime, equity: eq, cash, peak, drawdownPct: ((eq - peak) / peak) * 100 });
    }

    // 4. Evaluate strategy at close of t (decision executes at t+1 open)
    if (!tradeable || t >= lastWindowIdx) continue;
    const snap = cache.snapshot(t);
    if (snap.complete) signalDistribution[signalFromScore(cache.score(t).score)]++;
    const ctx: StrategyContext = {
      index: t,
      timeframe: cfg.timeframe,
      params,
      inPosition: pos !== null,
      candle: (offset = 0) => {
        if (offset < 0) throw new LookAheadError(`Strategy requested future candle (offset ${offset})`);
        return candles[t - offset];
      },
      snapshot: (offset = 0) => {
        if (offset < 0) throw new LookAheadError(`Strategy requested future snapshot (offset ${offset})`);
        return cache.snapshot(t - offset);
      },
      score: (offset = 0) => {
        if (offset < 0) throw new LookAheadError(`Strategy requested future score (offset ${offset})`);
        return cache.score(t - offset);
      },
    };
    const decision = strategy.evaluate(c, ctx);
    if (decision.action === 'ENTER_LONG' && !pos) pendingEntry = { reason: decision.reason, signalIndex: t };
    else if (decision.action === 'EXIT' && pos) pendingExit = { reason: decision.reason };
  }

  const ambiguous = trades.filter((t) => t.ambiguous).length;
  if (ambiguous) warnings.push(`${ambiguous} trade(s) had stop and target inside one candle; resolved conservatively as stop-loss.`);
  if (trades.length < 30) warnings.push(`Low trade count (${trades.length}). Statistics may be unreliable.`);

  const windowStart = candles.findIndex((_, i) => inWindow(i));
  const metrics = computeMetrics({
    initialCapital: cfg.initialCapital,
    trades,
    equity,
    periodsPerYear: PERIODS_PER_YEAR[cfg.timeframe],
    exposurePct: windowCandles ? (inPosCandles / windowCandles) * 100 : 0,
    buyAndHoldRoi: ((candles[lastWindowIdx].close - candles[windowStart].open) / candles[windowStart].open) * 100,
  });
  if (metrics.maxDrawdown < -25) warnings.push(`High drawdown (${metrics.maxDrawdown.toFixed(1)}%).`);

  return {
    config: cfg,
    params,
    startTime: candles[windowStart].openTime,
    endTime: candles[lastWindowIdx].closeTime,
    candlesUsed: windowCandles,
    metrics,
    trades,
    equity,
    monthly: monthlyReturns(equity, cfg.initialCapital),
    signalDistribution,
    byRegime: regimeBreakdown(trades),
    warnings,
  };
}

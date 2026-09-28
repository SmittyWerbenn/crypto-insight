import type { Timeframe } from '../../config/timeframes.js';
import type { Candle } from '../../types/market.js';
import type { IndicatorSeries, TechnicalSnapshot } from '../technical/engine.js';
import type { ScoreResult } from '../scoring/scoring.js';

export type StrategyParams = Record<string, number | boolean>;

export type StrategyAction =
  | { action: 'ENTER_LONG'; reason: string }
  | { action: 'EXIT'; reason: string }
  | { action: 'NONE' };

/**
 * Read-only view of the market at candle `t`. Accessors throw if asked for any index > t,
 * which makes look-ahead a runtime error rather than a silent bug.
 */
export interface StrategyContext {
  readonly index: number;
  readonly timeframe: Timeframe;
  readonly params: StrategyParams;
  readonly inPosition: boolean;
  candle(offset?: number): Candle;
  snapshot(offset?: number): TechnicalSnapshot;
  score(offset?: number): ScoreResult;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  defaultParams: StrategyParams;
  /** Params that change indicator periods (series must be recomputed). */
  indicatorParamKeys?: string[];
  evaluate(candle: Candle, ctx: StrategyContext): StrategyAction;
}

export interface BacktestConfig {
  symbol: string;
  timeframe: Timeframe;
  strategy: string;
  initialCapital: number;
  /** Fraction of equity per trade (0..1]. */
  positionSize: number;
  /** Fractions, e.g. 0.05 = 5%. 0/undefined disables. */
  stopLoss?: number;
  takeProfit?: number;
  fee: number;
  slippage: number;
  params?: StrategyParams;
  /** Only open trades on candles within [tradeFrom, tradeTo] (ms). Earlier data used for indicator warm-up only. */
  tradeFrom?: number;
  tradeTo?: number;
}

export type ExitReason = 'STOP_LOSS' | 'TAKE_PROFIT' | 'SIGNAL' | 'END_OF_DATA';

export interface Trade {
  entryTime: number;
  exitTime: number;
  symbol: string;
  side: 'LONG';
  entrySignalPrice: number;
  entryPrice: number;
  exitSignalPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  fees: number;
  slippageCost: number;
  netPnl: number;
  returnPct: number;
  /** Net P&L as % of equity before the trade (used for Monte Carlo). */
  equityReturnPct: number;
  holdingMs: number;
  holdingCandles: number;
  exitReason: ExitReason;
  entryReason: string;
  exitDetail: string;
  mfePct: number;
  maePct: number;
  /** Stop and target both inside one candle and could not be resolved with lower timeframe data. */
  ambiguous: boolean;
  regime: MarketRegime;
  volatilityRegime: 'HIGH' | 'LOW';
  entryScore: number;
}

export type MarketRegime = 'BULL' | 'BEAR' | 'SIDEWAYS';

export interface EquityPoint {
  time: number;
  equity: number;
  cash: number;
  drawdownPct: number;
  peak: number;
}

export interface BacktestMetrics {
  initialCapital: number;
  finalCapital: number;
  netProfit: number;
  roi: number;
  cagr: number | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  averageWinPct: number | null;
  averageLossPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  expectancyPct: number | null;
  maxDrawdown: number;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  averageHoldingMs: number | null;
  totalFees: number;
  totalSlippage: number;
  maxConsecutiveLosses: number;
  valueAtRisk95: number | null;
  exposurePct: number;
  ambiguousTrades: number;
  buyAndHoldRoi: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
}

export interface MonthlyReturn {
  month: string; // YYYY-MM
  returnPct: number;
}

export interface RegimeBreakdown {
  regime: string;
  trades: number;
  winRate: number | null;
  avgReturnPct: number | null;
}

export interface DataQualityReport {
  ok: boolean;
  severe: boolean;
  totalCandles: number;
  missingCandles: number;
  duplicateCandles: number;
  invalidCandles: number;
  zeroVolumeCandles: number;
  volumeSpikes: number;
  gaps: { from: number; to: number; missing: number }[];
  warnings: string[];
}

export interface BacktestResult {
  config: BacktestConfig;
  params: StrategyParams;
  startTime: number;
  endTime: number;
  candlesUsed: number;
  metrics: BacktestMetrics;
  trades: Trade[];
  equity: EquityPoint[];
  monthly: MonthlyReturn[];
  signalDistribution: Record<string, number>;
  byRegime: RegimeBreakdown[];
  warnings: string[];
}

export interface EngineInput {
  candles: Candle[];
  series?: IndicatorSeries;
  /** Optional resolver for intrabar ambiguity. Returns which level was hit first, or null if unknown. */
  resolveIntrabar?: (candle: Candle, stop: number, target: number) => 'STOP' | 'TARGET' | null;
}

export type Signal = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
export type MarketCondition = 'BULLISH_STRONG' | 'BULLISH_MODERATE' | 'NEUTRAL' | 'BEARISH_MODERATE' | 'BEARISH_STRONG';

export interface ServiceStatus {
  name: string;
  connected: boolean;
  lastSuccess: string | null;
  lastError: string | null;
}

export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketCard {
  symbol: string;
  base: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  sparkline: number[];
}

export interface Mover {
  symbol: string;
  price: number;
  changePct: number;
  quoteVolume: number;
  rangePct: number;
}

export interface Breadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  total: number;
  advanceDeclineRatio: number | null;
  averageChangePct: number;
  medianChangePct: number;
  label: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

export interface GlobalMarket {
  totalMarketCap: number;
  totalMarketCapChangePct: number;
  totalVolume: number;
  btcDominance: number;
  ethDominance: number;
  source: string;
}

export interface Overview {
  source: 'binance' | 'mock';
  mock: boolean;
  updatedAt: number;
  status: ServiceStatus;
  cards: MarketCard[];
  global: GlobalMarket | null;
  binanceUsdtVolume24h: number;
  breadth: Breadth;
  gainers: Mover[];
  losers: Mover[];
  mostVolatile: Mover[];
}

export interface ForwardStat {
  candles: number;
  hours: number;
  label: string;
  n: number;
  average: number | null;
  median: number | null;
  best: number | null;
  worst: number | null;
  positiveRate: number | null;
}

export interface Historical {
  setup: { rsi: number; macdBullish: boolean; aboveMa20: boolean; aboveMa50: boolean; volumeAboveAvg: boolean } | null;
  sampleSize: number;
  positive: number;
  negative: number;
  historicalPositiveRate: number | null;
  outcomeHorizon: number;
  forward: ForwardStat[];
  maxHistoricalGain: number | null;
  maxHistoricalLoss: number | null;
  reliability: 'INSUFFICIENT' | 'LIMITED' | 'MODERATE' | 'GOOD';
  note: string;
}

export interface Snapshot {
  price: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  adx: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  macdState: string;
  stochRsiK: number | null;
  stochRsiD: number | null;
  roc: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  bbPercentB: number | null;
  atr: number | null;
  atrPct: number | null;
  historicalVolatility: number | null;
  volume: number;
  volumeMa: number | null;
  volumeRatio: number | null;
  volumeChangePct: number | null;
  obvSlope: number | null;
  priceAction: {
    higherHigh: boolean;
    higherLow: boolean;
    lowerHigh: boolean;
    lowerLow: boolean;
    structure: string;
    breakout: boolean;
    breakdown: boolean;
    support: number | null;
    resistance: number | null;
    supportLevels: number[];
    resistanceLevels: number[];
  };
}

export interface TechnicalAnalysis {
  symbol: string;
  timeframe: string;
  candleTime: number;
  candleCloseTime: number;
  price: number;
  signal: Signal;
  signalLabel: string;
  technicalScore: number;
  dataCompleteness: number;
  score: {
    components: { key: string; label: string; weight: number; value: number; points: number; available: boolean }[];
    factors: { type: 'positive' | 'negative' | 'neutral'; text: string }[];
  };
  snapshot: Snapshot;
  risk: { level: 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH'; reasons: string[] };
  levels: { direction: string; entry: number; target: number; stop: number; upsidePct: number | null; downsidePct: number; riskReward: number | null; method: string[] } | null;
  scenarios: {
    bullish: { target: number; potential: number; trigger: string };
    base: { low: number; high: number; description: string };
    bearish: { target: number; potential: number; trigger: string };
  } | null;
  historical: Historical;
  regime: 'BULL' | 'BEAR' | 'SIDEWAYS';
  dataQuality: { warnings: string[] };
  candlesAnalyzed: number;
}

export interface CoinAI {
  marketCondition: MarketCondition;
  signal: Signal;
  technicalScore: number;
  confidence: number | null;
  confidenceRationale: string;
  summary: string;
  observedFacts: string[];
  technicalInterpretation: string;
  historicalEvidence: string;
  reasons: string[];
  risks: string[];
  uncertainty: string;
  historicalContext: { sampleSize: number; positiveRate: number | null; medianReturn24h: number | null; medianReturn48h: number | null };
  scenario: {
    bullish: { target: number; potential: number; explanation: string };
    base: { low: number; high: number; explanation: string };
    bearish: { target: number; potential: number; explanation: string };
  };
}

export interface Derivatives {
  available: boolean;
  fundingRate: number | null;
  openInterest: number | null;
  openInterestValue: number | null;
  openInterestChangePct: number | null;
  longShortRatio: number | null;
  futuresQuoteVolume: number | null;
  liquidations: number | null;
  error?: string;
}

export type AiStatus = 'OK' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_REQUESTED';

export interface CoinAnalysisResponse {
  symbol: string;
  timeframe: string;
  source: 'binance' | 'mock';
  technical: TechnicalAnalysis;
  derivatives: Derivatives;
  fearGreed: { value: number; classification: string } | null;
  ai: {
    status: AiStatus;
    analysis: CoinAI | null;
    model: string | null;
    generatedAt: string | null;
    cached: boolean;
    consistencyWarnings: string[];
    error: string | null;
    lastSuccessfulAt: string | null;
  };
}

export interface DailyRow {
  symbol: string;
  price: number;
  changePct: number | null;
  signal: Signal;
  signalLabel: string;
  technicalScore: number;
  aiConfidence: number | null;
  upsidePct: number | null;
  downsidePct: number | null;
  target: number | null;
  stop: number | null;
  historicalPositiveRate: number | null;
  historicalSampleSize: number;
  historicalReliability: string;
  risk: string;
  rsi: number | null;
  support: number | null;
  resistance: number | null;
  candleTime: number;
}

export interface MarketSummary {
  marketCondition: MarketCondition;
  headline: string;
  summary: string;
  btcTrend: string;
  altcoinTrend: string;
  breadth: string;
  volume: string;
  volatility: string;
  sentiment: string;
  derivatives: string;
  historicalContext: string;
  opportunities: string[];
  risks: string[];
  keyLevels: { symbol: string; support: number | null; resistance: number | null }[];
  confidence: number | null;
  uncertainty: string;
}

export interface MarketSummaryResponse {
  condition: MarketCondition;
  breadth: Breadth;
  source: string;
  fearGreed: { value: number; classification: string } | null;
  ai: { status: AiStatus; summary: MarketSummary | null; model: string | null; generatedAt: string | null; cached: boolean; error: string | null; warnings: string[] };
  context: { averageTechnicalScore: number; historicalSignalContext: { averageHistoricalPositiveRate: number; symbolsWithReliableSample: number }; averageAnnualizedVolatilityPct: number | null; averageVolumeRatioVs20: number | null };
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
  exposurePct: number | null;
  ambiguousTrades: number;
  buyAndHoldRoi: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
}

export interface Trade {
  entryTime: number;
  exitTime: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  fees: number;
  slippageCost: number;
  netPnl: number;
  returnPct: number;
  holdingMs: number;
  exitReason: string;
  exitDetail: string;
  mfePct: number;
  maePct: number;
  ambiguous: boolean;
  regime: string;
}

export interface BacktestJob {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  mode: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  progress: number;
  error: string | null;
  request: Record<string, unknown> & { initialCapital: number };
  result: BacktestResultData | null;
  createdAt: string;
}

export interface BacktestResultData {
  mode: string;
  strategyName?: string;
  params?: Record<string, number | boolean>;
  startTime?: number;
  endTime?: number;
  metrics?: BacktestMetrics;
  monthly?: { month: string; returnPct: number }[];
  byRegime?: { regime: string; trades: number; winRate: number | null; avgReturnPct: number | null }[];
  signalDistribution?: Record<string, number>;
  warnings?: string[];
  dataQuality?: { warnings: string[] };
  monteCarlo?: {
    iterations: number;
    trades: number;
    medianEndingCapital: number;
    worst5PctEndingCapital: number;
    best5PctEndingCapital: number;
    medianMaxDrawdown: number;
    worst5PctMaxDrawdown: number;
    drawdownThreshold: number;
    probDrawdownBeyondThreshold: number;
    probLoss: number;
    note: string;
  } | null;
  outOfSample?: {
    splitRatio: number;
    splitTime: number;
    optimization: { tested: number; skipped: number; bestParams: Record<string, number> | null; top: { params: Record<string, number>; objective: number; metrics: BacktestMetrics }[] } | null;
    inSample: { metrics: BacktestMetrics; startTime: number; endTime: number };
    outOfSample: { metrics: BacktestMetrics; startTime: number; endTime: number };
    overfitting: { overfit: boolean; warnings: string[] };
  };
  walkForward?: {
    trainDays: number;
    testDays: number;
    windows: { index: number; trainFrom: number; trainTo: number; testFrom: number; testTo: number; bestParams: Record<string, number> | null; combinationsTested: number; note: string | null; train: BacktestMetrics; test: BacktestMetrics }[];
    overfitting: { overfit: boolean; warnings: string[] };
    combined: BacktestMetrics;
  };
  matrix?: { symbol: string; timeframe: string; metrics: BacktestMetrics | null; error: string | null }[];
}

export interface SignalRow {
  id: string;
  date: string;
  symbol: string;
  timeframe: string;
  signal: Signal;
  technicalScore: number;
  aiConfidence: number | null;
  direction: string;
  entry: number;
  target: number;
  stop: number;
  result: string | null;
  returnPercent: number | null;
  exitPrice: number | null;
  exitTime: string | null;
  mfe: number | null;
  mae: number | null;
  note: string | null;
}

export interface PerfSummary {
  total: number;
  evaluated: number;
  open: number;
  ambiguous: number;
  successful: number;
  failed: number;
  winRate: number | null;
  averageReturn: number | null;
  medianReturn: number | null;
  bestReturn: number | null;
  worstReturn: number | null;
  profitFactor: number | null;
  averageTimeToTargetMs: number | null;
  averageTimeToStopMs: number | null;
}

export interface StatusResponse {
  source: 'binance' | 'mock';
  mock: boolean;
  timezone: string;
  binance: ServiceStatus;
  binanceFutures: ServiceStatus;
  websocket: ServiceStatus & { connected: boolean };
  ai: { configured: boolean; model: string; mock: boolean; status: ServiceStatus };
  database: boolean;
  redis: boolean;
  services: ServiceStatus[];
}

export interface AppConfig {
  timeframes: string[];
  backtestTimeframes: string[];
  analysisTimeframe: string;
  trackedSymbols: string[];
  timezone: string;
  scoring: { weights: Record<string, number>; bands: { min: number; signal: Signal }[]; labels: Record<Signal, string> };
  historical: { forwardHorizons: number[]; outcomeHorizon: number; minReliableSample: number; fullMetricsSample: number };
  targets: { atrStopMultiplier: number; atrTargetMultiplier: number; minRiskReward: number; evaluationWindow: number };
  strategies: { id: string; name: string; description: string; defaultParams: Record<string, number | boolean> }[];
  mock: boolean;
  aiLanguage: string;
}

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 120 }),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Jakarta'),
  createdAt: createdAt(),
});

export const coins = pgTable('coins', {
  symbol: varchar('symbol', { length: 32 }).primaryKey(),
  baseAsset: varchar('base_asset', { length: 16 }).notNull(),
  quoteAsset: varchar('quote_asset', { length: 16 }).notNull(),
  name: varchar('name', { length: 120 }),
  status: varchar('status', { length: 32 }),
  tracked: boolean('tracked').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const marketSnapshots = pgTable(
  'market_snapshots',
  {
    id: serial('id').primaryKey(),
    timestamp: ts('timestamp').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [index('market_snapshots_ts_idx').on(t.timestamp)],
);

export const ohlcv = pgTable(
  'ohlcv',
  {
    symbol: varchar('symbol', { length: 32 }).notNull(),
    timeframe: varchar('timeframe', { length: 8 }).notNull(),
    openTime: bigint('open_time', { mode: 'number' }).notNull(),
    closeTime: bigint('close_time', { mode: 'number' }).notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull(),
    quoteVolume: doublePrecision('quote_volume'),
    trades: integer('trades'),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.timeframe, t.openTime] })],
);

export const technicalIndicators = pgTable(
  'technical_indicators',
  {
    id: serial('id').primaryKey(),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    timeframe: varchar('timeframe', { length: 8 }).notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    technicalScore: doublePrecision('technical_score'),
    signal: varchar('signal', { length: 16 }),
    data: jsonb('data').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('technical_indicators_sym_tf_ts_idx').on(t.symbol, t.timeframe, t.timestamp)],
);

export const aiAnalysis = pgTable(
  'ai_analysis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    symbol: varchar('symbol', { length: 32 }).notNull(), // 'MARKET' for market summary
    timeframe: varchar('timeframe', { length: 8 }).notNull(),
    timestamp: ts('timestamp').notNull(),
    candleTime: bigint('candle_time', { mode: 'number' }),
    kind: varchar('kind', { length: 16 }).notNull(), // COIN | MARKET
    model: varchar('model', { length: 64 }),
    status: varchar('status', { length: 16 }).notNull(), // OK | UNAVAILABLE | INVALID
    context: jsonb('context').notNull(),
    result: jsonb('result'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_analysis_symbol_ts_idx').on(t.symbol, t.timestamp)],
);

export const signals = pgTable(
  'signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    timeframe: varchar('timeframe', { length: 8 }).notNull(),
    timestamp: ts('timestamp').notNull(),
    candleTime: bigint('candle_time', { mode: 'number' }).notNull(),
    signal: varchar('signal', { length: 16 }).notNull(),
    technicalScore: doublePrecision('technical_score').notNull(),
    aiConfidence: doublePrecision('ai_confidence'),
    direction: varchar('direction', { length: 20 }).notNull(),
    entryPrice: doublePrecision('entry_price').notNull(),
    targetPrice: doublePrecision('target_price').notNull(),
    stopPrice: doublePrecision('stop_price').notNull(),
    marketCondition: varchar('market_condition', { length: 32 }),
    analysisId: uuid('analysis_id'),
    createdAt: createdAt(),
  },
  (t) => [index('signals_symbol_ts_idx').on(t.symbol, t.timestamp), uniqueIndex('signals_sym_tf_candle_idx').on(t.symbol, t.timeframe, t.candleTime)],
);

export const signalResults = pgTable(
  'signal_results',
  {
    signalId: uuid('signal_id')
      .primaryKey()
      .references(() => signals.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    timestamp: ts('timestamp').notNull(),
    status: varchar('status', { length: 16 }).notNull(), // PENDING | OPEN | TARGET_HIT | STOP_HIT | TIMEOUT | INVALIDATED | AMBIGUOUS
    entryPrice: doublePrecision('entry_price').notNull(),
    targetPrice: doublePrecision('target_price').notNull(),
    stopPrice: doublePrecision('stop_price').notNull(),
    exitPrice: doublePrecision('exit_price'),
    entryTime: ts('entry_time').notNull(),
    exitTime: ts('exit_time'),
    returnPercent: doublePrecision('return_percent'),
    maxFavorableExcursion: doublePrecision('max_favorable_excursion'),
    maxAdverseExcursion: doublePrecision('max_adverse_excursion'),
    candlesEvaluated: integer('candles_evaluated').notNull().default(0),
    note: text('note'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('signal_results_symbol_ts_idx').on(t.symbol, t.timestamp), index('signal_results_status_idx').on(t.status)],
);

export const signalFeatures = pgTable('signal_features', {
  signalId: uuid('signal_id')
    .primaryKey()
    .references(() => signals.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 32 }).notNull(),
  timestamp: ts('timestamp').notNull(),
  price: doublePrecision('price').notNull(),
  rsi: doublePrecision('rsi'),
  macd: doublePrecision('macd'),
  macdHistogram: doublePrecision('macd_histogram'),
  macdState: varchar('macd_state', { length: 16 }),
  ma20: doublePrecision('ma20'),
  ma50: doublePrecision('ma50'),
  ma200: doublePrecision('ma200'),
  volume: doublePrecision('volume'),
  volumeChange: doublePrecision('volume_change'),
  atr: doublePrecision('atr'),
  bollingerPosition: doublePrecision('bollinger_position'),
  technicalScore: doublePrecision('technical_score').notNull(),
  support: doublePrecision('support'),
  resistance: doublePrecision('resistance'),
  fundingRate: doublePrecision('funding_rate'),
  openInterest: doublePrecision('open_interest'),
  fearGreed: integer('fear_greed'),
  marketCondition: varchar('market_condition', { length: 32 }),
  regime: varchar('regime', { length: 16 }),
  volatilityRegime: varchar('volatility_regime', { length: 8 }),
});

export const strategies = pgTable('strategies', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  defaultParams: jsonb('default_params').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const backtests = pgTable(
  'backtests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    status: varchar('status', { length: 16 }).notNull(), // QUEUED | RUNNING | COMPLETED | FAILED
    mode: varchar('mode', { length: 24 }).notNull().default('standard'),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    timeframe: varchar('timeframe', { length: 8 }).notNull(),
    strategy: varchar('strategy', { length: 64 }).notNull(),
    request: jsonb('request').notNull(),
    result: jsonb('result'), // monthly, byRegime, signalDistribution, monteCarlo, dataQuality, oos, walkForward, warnings
    error: text('error'),
    progress: integer('progress').notNull().default(0),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
  },
  (t) => [index('backtests_created_idx').on(t.createdAt)],
);

export const backtestTrades = pgTable(
  'backtest_trades',
  {
    id: serial('id').primaryKey(),
    backtestId: uuid('backtest_id')
      .notNull()
      .references(() => backtests.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [index('backtest_trades_backtest_idx').on(t.backtestId)],
);

export const backtestEquity = pgTable(
  'backtest_equity',
  {
    backtestId: uuid('backtest_id')
      .notNull()
      .references(() => backtests.id, { onDelete: 'cascade' }),
    time: bigint('time', { mode: 'number' }).notNull(),
    equity: doublePrecision('equity').notNull(),
    peak: doublePrecision('peak').notNull(),
    drawdownPct: doublePrecision('drawdown_pct').notNull(),
  },
  (t) => [primaryKey({ columns: [t.backtestId, t.time] })],
);

export const backtestMetrics = pgTable('backtest_metrics', {
  backtestId: uuid('backtest_id')
    .primaryKey()
    .references(() => backtests.id, { onDelete: 'cascade' }),
  metrics: jsonb('metrics').notNull(),
  roi: doublePrecision('roi'),
  winRate: doublePrecision('win_rate'),
  profitFactor: doublePrecision('profit_factor'),
  maxDrawdown: doublePrecision('max_drawdown'),
  sharpe: doublePrecision('sharpe'),
  totalTrades: integer('total_trades'),
});

export const watchlists = pgTable(
  'watchlists',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.symbol] })],
);

export const portfolio = pgTable(
  'portfolio',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    quantity: doublePrecision('quantity').notNull(),
    averageBuyPrice: doublePrecision('average_buy_price').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.symbol] })],
);

export const portfolioTransactions = pgTable(
  'portfolio_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    side: varchar('side', { length: 4 }).notNull(), // BUY | SELL
    quantity: doublePrecision('quantity').notNull(),
    price: doublePrecision('price').notNull(),
    executedAt: ts('executed_at').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('portfolio_tx_user_idx').on(t.userId, t.symbol)],
);

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    type: varchar('type', { length: 24 }).notNull(), // PRICE_ABOVE ...
    value: doublePrecision('value'),
    active: boolean('active').notNull().default(true),
    triggeredAt: ts('triggered_at'),
    triggeredValue: doublePrecision('triggered_value'),
    createdAt: createdAt(),
  },
  (t) => [index('alerts_active_idx').on(t.active, t.symbol)],
);

export const news = pgTable(
  'news',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    source: varchar('source', { length: 120 }),
    publishedAt: ts('published_at').notNull(),
    coins: jsonb('coins').notNull().default(sql`'[]'::jsonb`),
    sentiment: varchar('sentiment', { length: 16 }),
    createdAt: createdAt(),
  },
  (t) => [index('news_published_idx').on(t.publishedAt)],
);

export const sentiment = pgTable(
  'sentiment',
  {
    id: serial('id').primaryKey(),
    source: varchar('source', { length: 64 }).notNull(),
    symbol: varchar('symbol', { length: 32 }),
    timestamp: ts('timestamp').notNull(),
    value: doublePrecision('value').notNull(),
    classification: varchar('classification', { length: 32 }),
    data: jsonb('data'),
  },
  (t) => [uniqueIndex('sentiment_source_ts_idx').on(t.source, t.timestamp)],
);

/**
 * Paper Trading V2 — a simulated Rp portfolio (fixed base capital, no fees, no compounding).
 * Single account: row id = 1 holds cash, realized P&L, high-water mark and the strategy/money config in force.
 */
export const paperState = pgTable('paper_state', {
  id: integer('id').primaryKey(),
  startedAt: ts('started_at').notNull().defaultNow(),
  config: jsonb('config').notNull(),
  cash: doublePrecision('cash').notNull(),
  realizedPnl: doublePrecision('realized_pnl').notNull().default(0),
  highWaterMark: doublePrecision('high_water_mark').notNull(),
  maxDrawdownPct: doublePrecision('max_drawdown_pct').notNull().default(0),
  seq: integer('seq').notNull().default(0),
  lastScanAt: ts('last_scan_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const paperPositions = pgTable('paper_positions', {
  id: varchar('id', { length: 16 }).primaryKey(),
  symbol: varchar('symbol', { length: 32 }).notNull(),
  cluster: varchar('cluster', { length: 24 }).notNull(),
  openedAt: ts('opened_at').notNull(),
  plannedCost: doublePrecision('planned_cost').notNull(),
  layers: jsonb('layers').notNull(),
  tp: doublePrecision('tp').notNull(),
  sl: doublePrecision('sl').notNull(),
  timeoutAt: ts('timeout_at').notNull(),
  atrPct: doublePrecision('atr_pct').notNull(),
  high: doublePrecision('high').notNull(),
  low: doublePrecision('low').notNull(),
  meta: jsonb('meta').notNull(),
  /** Open time of the last 5m candle already checked for TP/SL. */
  lastBarTime: bigint('last_bar_time', { mode: 'number' }).notNull(),
});

export const paperTrades = pgTable(
  'paper_trades',
  {
    id: varchar('id', { length: 16 }).primaryKey(),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    cluster: varchar('cluster', { length: 24 }).notNull(),
    openedAt: ts('opened_at').notNull(),
    closedAt: ts('closed_at').notNull(),
    qty: doublePrecision('qty').notNull(),
    avgEntry: doublePrecision('avg_entry').notNull(),
    cost: doublePrecision('cost').notNull(),
    exitPrice: doublePrecision('exit_price').notNull(),
    exitReason: varchar('exit_reason', { length: 16 }).notNull(), // TARGET | CUTLOSS | TIMEOUT
    pnl: doublePrecision('pnl').notNull(),
    pnlPct: doublePrecision('pnl_pct').notNull(),
    holdH: doublePrecision('hold_h').notNull(),
    mfePct: doublePrecision('mfe_pct').notNull(),
    maePct: doublePrecision('mae_pct').notNull(),
    tp: doublePrecision('tp').notNull(),
    sl: doublePrecision('sl').notNull(),
    layers: jsonb('layers').notNull(),
    /** Entry snapshot: score, regimes, ATR, ATR percentile, RSI, MACD, volume, momentum, allocation, exposure. */
    meta: jsonb('meta').notNull(),
    cashAfter: doublePrecision('cash_after').notNull(),
    equityAfter: doublePrecision('equity_after').notNull(),
  },
  (t) => [index('paper_trades_closed_idx').on(t.closedAt)],
);

/** Capital ledger: every BUY/SELL plus an hourly mark-to-market point (the equity curve). */
export const paperLedger = pgTable(
  'paper_ledger',
  {
    id: serial('id').primaryKey(),
    time: ts('time').notNull(),
    event: varchar('event', { length: 8 }).notNull(), // START | BUY | ADD | SELL | MARK
    symbol: varchar('symbol', { length: 32 }),
    amount: doublePrecision('amount').notNull(),
    cash: doublePrecision('cash').notNull(),
    invested: doublePrecision('invested').notNull(),
    realizedPnl: doublePrecision('realized_pnl').notNull(),
    unrealizedPnl: doublePrecision('unrealized_pnl').notNull(),
    equity: doublePrecision('equity').notNull(),
    openPositions: integer('open_positions').notNull(),
    highWaterMark: doublePrecision('high_water_mark').notNull(),
    drawdownPct: doublePrecision('drawdown_pct').notNull(),
  },
  (t) => [index('paper_ledger_time_idx').on(t.time)],
);

/** One row per hourly scan: market filter, how many coins passed, what was bought or skipped and why. */
export const paperScans = pgTable(
  'paper_scans',
  {
    id: serial('id').primaryKey(),
    time: ts('time').notNull(),
    btc: jsonb('btc'),
    scanned: integer('scanned').notNull(),
    signals: integer('signals').notNull(),
    entries: jsonb('entries').notNull(),
    skipped: jsonb('skipped').notNull(),
    note: text('note'),
  },
  (t) => [index('paper_scans_time_idx').on(t.time)],
);

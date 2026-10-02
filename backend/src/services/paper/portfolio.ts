import { clusterOf } from './strategy.js';

/**
 * Paper Trading V2 money management. Pure bookkeeping, shared by the research backtest and the live engine.
 *
 *  - Sizing base: without compounding it is the paid-in capital (base + top-ups) and never grows with profit;
 *    with compounding it is the current equity at cost (cash + open positions at cost), so profits and losses
 *    resize every cap (risk, per coin, reserve, exposure, cluster).
 *  - Fees: `feeRate` per side on the traded notional, paid from cash at buy and at sell. 0 = pure strategy edge.
 *  - Top-ups only through `deposit()`; they are tracked separately so return and drawdown measure trading only.
 *  - A buy needs real cash: if cash (minus the reserve) cannot pay amount + fee, the trade is skipped.
 *  - Caps on positions, per-coin allocation, total exposure and correlated (cluster) exposure; when hit → skip.
 */
export interface MoneyConfig {
  baseCapital: number;
  /** Rupiah lost if the stop is hit, as a fraction of base capital. Position = risk / stop distance. */
  riskPerTrade: number;
  /** Max allocation for one coin (all layers), fraction of base. */
  maxPerCoin: number;
  maxPositions: number;
  /** Cash that is never invested, fraction of base. */
  cashReserve: number;
  /** Max invested (at cost), fraction of base. */
  maxExposure: number;
  /** Max invested in one correlation cluster, fraction of base. */
  maxClusterExposure: number;
  /** Entry layers as fractions of the planned position (sum 1). [1] = full entry. */
  layers: number[];
  /** Fee per side as a fraction of notional (0.001 = 0.1%, Binance spot). */
  feeRate: number;
  /** Size from current equity (true) or from paid-in capital (false). */
  compounding: boolean;
}

export const MONEY_V2: MoneyConfig = {
  baseCapital: 1_000_000,
  riskPerTrade: 0.01,
  maxPerCoin: 0.2,
  maxPositions: 4,
  cashReserve: 0.3,
  maxExposure: 0.7,
  maxClusterExposure: 0.5,
  layers: [1],
  feeRate: 0.001,
  compounding: true,
};

/** The research setting (results in docs/paper-trading-v2.md): no fees, fixed base. */
export const MONEY_RESEARCH: MoneyConfig = { ...MONEY_V2, feeRate: 0, compounding: false };

export interface Layer {
  time: number;
  price: number;
  qty: number;
  cost: number;
  /** Fee paid on this buy. */
  fee?: number;
}

export interface Position {
  id: string;
  symbol: string;
  cluster: string;
  openedAt: number;
  /** Planned size for all layers, in Rupiah at the first fill. */
  plannedCost: number;
  layers: Layer[];
  tp: number;
  sl: number;
  timeoutAt: number;
  atrPct: number;
  /** Highest / lowest price seen since entry (MFE/MAE). */
  high: number;
  low: number;
  meta: Record<string, unknown>;
  /** Live engine only: open time of the last 5m candle already checked for TP/SL. */
  lastBarTime?: number;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  cluster: string;
  openedAt: number;
  closedAt: number;
  layers: Layer[];
  qty: number;
  avgEntry: number;
  cost: number;
  exitPrice: number;
  exitReason: 'TARGET' | 'CUTLOSS' | 'TIMEOUT';
  /** Net of all fees (buy + sell). */
  pnl: number;
  pnlPct: number;
  fees: number;
  holdH: number;
  mfePct: number;
  maePct: number;
  tp: number;
  sl: number;
  meta: Record<string, unknown>;
  /** Portfolio state right after the close. */
  cashAfter: number;
  equityAfter: number;
}

export interface LedgerRow {
  time: number;
  event: 'START' | 'BUY' | 'ADD' | 'SELL' | 'MARK' | 'TOPUP';
  symbol: string | null;
  amount: number;
  cash: number;
  invested: number;
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number;
  openPositions: number;
  highWaterMark: number;
  drawdownPct: number;
}

export interface PortfolioState {
  cash: number;
  realizedPnl: number;
  highWaterMark: number;
  maxDrawdownPct: number;
  positions: Position[];
  seq: number;
  /** Total virtual top-ups after the start (not counted as profit). */
  deposits: number;
  feesPaid: number;
}

const qtyOf = (p: Position) => p.layers.reduce((a, l) => a + l.qty, 0);
const costOf = (p: Position) => p.layers.reduce((a, l) => a + l.cost, 0);

export class PaperPortfolio {
  state: PortfolioState;
  ledger: LedgerRow[] = [];
  closed: ClosedTrade[] = [];

  constructor(
    readonly cfg: MoneyConfig = MONEY_V2,
    state?: PortfolioState,
  ) {
    this.state = state ?? { cash: cfg.baseCapital, realizedPnl: 0, highWaterMark: cfg.baseCapital, maxDrawdownPct: 0, positions: [], seq: 0, deposits: 0, feesPaid: 0 };
  }

  /** Capital that sizing and caps are computed from (see header). */
  get sizingBase() {
    return this.cfg.compounding ? this.state.cash + this.invested : this.cfg.baseCapital + this.state.deposits;
  }

  /** Add virtual capital. */
  deposit(time: number, amount: number) {
    this.state.cash += amount;
    this.state.deposits += amount;
    this.state.highWaterMark += amount;
    return this.log(time, 'TOPUP', null, amount);
  }

  get invested() {
    return this.state.positions.reduce((a, p) => a + costOf(p), 0);
  }

  /** Equity = cash + market value of open positions (prices missing → valued at cost). */
  equity(prices: Record<string, number> = {}) {
    return this.state.cash + this.state.positions.reduce((a, p) => a + (prices[p.symbol] !== undefined ? qtyOf(p) * prices[p.symbol] : costOf(p)), 0);
  }

  /** Planned Rupiah size from the risk budget and stop distance, capped per coin. */
  plannedSize(slPct: number) {
    const base = this.sizingBase;
    return Math.min((base * this.cfg.riskPerTrade) / (slPct / 100), base * this.cfg.maxPerCoin);
  }

  /** Null when a new position of `amount` (first layer) is allowed, otherwise the skip reason. */
  canOpen(symbol: string, amount: number): string | null {
    const base = this.sizingBase;
    const st = this.state;
    if (st.positions.some((p) => p.symbol === symbol)) return 'Koin sudah punya posisi terbuka (1 posisi per koin)';
    if (st.positions.length >= this.cfg.maxPositions) return `Maks. ${this.cfg.maxPositions} posisi bersamaan tercapai`;
    return this.capCheck(symbol, amount, base);
  }

  private capCheck(symbol: string, amount: number, base: number): string | null {
    const st = this.state;
    if (amount <= 0) return 'Ukuran posisi nol';
    if (st.cash - amount * (1 + this.cfg.feeRate) < base * this.cfg.cashReserve - 1e-6) return 'Cash tidak cukup (cadangan cash dijaga)';
    if (this.invested + amount > base * this.cfg.maxExposure + 1e-6) return `Eksposur total > ${this.cfg.maxExposure * 100}% modal`;
    const cl = clusterOf(symbol);
    const clusterCost = st.positions.filter((p) => p.cluster === cl).reduce((a, p) => a + costOf(p), 0);
    if (clusterCost + amount > base * this.cfg.maxClusterExposure + 1e-6) return `Eksposur klaster ${cl} > ${this.cfg.maxClusterExposure * 100}% modal`;
    const coinCost = st.positions.filter((p) => p.symbol === symbol).reduce((a, p) => a + costOf(p), 0);
    if (coinCost + amount > base * this.cfg.maxPerCoin + 1e-6) return `Alokasi koin > ${this.cfg.maxPerCoin * 100}% modal`;
    return null;
  }

  open(o: { symbol: string; time: number; price: number; tp: number; sl: number; slPct: number; atrPct: number; maxHoldH: number; meta?: Record<string, unknown> }): { position: Position | null; reason: string | null } {
    const planned = this.plannedSize(o.slPct);
    const first = planned * this.cfg.layers[0];
    const reason = this.canOpen(o.symbol, first);
    if (reason) return { position: null, reason };
    const p: Position = {
      id: `P${++this.state.seq}`,
      symbol: o.symbol,
      cluster: clusterOf(o.symbol),
      openedAt: o.time,
      plannedCost: planned,
      layers: [{ time: o.time, price: o.price, qty: first / o.price, cost: first, fee: first * this.cfg.feeRate }],
      tp: o.tp,
      sl: o.sl,
      timeoutAt: o.time + o.maxHoldH * 3_600_000,
      atrPct: o.atrPct,
      high: o.price,
      low: o.price,
      meta: o.meta ?? {},
    };
    this.state.cash -= first * (1 + this.cfg.feeRate);
    this.state.feesPaid += first * this.cfg.feeRate;
    this.state.positions.push(p);
    this.log(o.time, 'BUY', o.symbol, first);
    return { position: p, reason: null };
  }

  /** Next entry layer. Only allowed while in profit (price ≥ average entry): adding to strength, never averaging down. */
  addLayer(p: Position, time: number, price: number): string | null {
    const k = p.layers.length;
    if (k >= this.cfg.layers.length) return 'Semua layer sudah masuk';
    const avg = costOf(p) / qtyOf(p);
    if (price < avg) return 'Harga di bawah rata-rata entry — tidak averaging down';
    const amount = p.plannedCost * this.cfg.layers[k];
    const reason = this.capCheck(p.symbol, amount, this.sizingBase);
    if (reason) return reason;
    p.layers.push({ time, price, qty: amount / price, cost: amount, fee: amount * this.cfg.feeRate });
    this.state.cash -= amount * (1 + this.cfg.feeRate);
    this.state.feesPaid += amount * this.cfg.feeRate;
    this.log(time, 'ADD', p.symbol, amount);
    return null;
  }

  close(p: Position, time: number, price: number, reason: ClosedTrade['exitReason'], prices: Record<string, number> = {}): ClosedTrade {
    const qty = qtyOf(p);
    const cost = costOf(p);
    const proceeds = qty * price;
    const exitFee = proceeds * this.cfg.feeRate;
    const fees = exitFee + p.layers.reduce((a, l) => a + (l.fee ?? 0), 0);
    const pnl = proceeds - cost - fees;
    this.state.cash += proceeds - exitFee;
    this.state.feesPaid += exitFee;
    this.state.realizedPnl += pnl;
    this.state.positions = this.state.positions.filter((x) => x !== p);
    const avgEntry = cost / qty;
    const first = p.layers[0].price;
    this.log(time, 'SELL', p.symbol, proceeds, prices);
    const t: ClosedTrade = {
      id: p.id,
      symbol: p.symbol,
      cluster: p.cluster,
      openedAt: p.openedAt,
      closedAt: time,
      layers: p.layers,
      qty,
      avgEntry,
      cost,
      exitPrice: price,
      exitReason: reason,
      pnl,
      pnlPct: (pnl / cost) * 100,
      fees,
      holdH: (time - p.openedAt) / 3_600_000,
      mfePct: (Math.max(p.high, reason === 'TARGET' ? price : p.high) / first - 1) * 100,
      maePct: (Math.min(p.low, reason === 'CUTLOSS' ? price : p.low) / first - 1) * 100,
      tp: p.tp,
      sl: p.sl,
      meta: p.meta,
      cashAfter: this.state.cash,
      equityAfter: this.equity(prices),
    };
    this.closed.push(t);
    return t;
  }

  /** Mark-to-market snapshot (equity curve point). Updates high-water mark and max drawdown. */
  mark(time: number, prices: Record<string, number>, event: LedgerRow['event'] = 'MARK') {
    return this.log(time, event, null, 0, prices);
  }

  private log(time: number, event: LedgerRow['event'], symbol: string | null, amount: number, prices: Record<string, number> = {}): LedgerRow {
    const equity = this.equity(prices);
    const st = this.state;
    // High-water mark includes top-ups (deposit() raises it too), so a top-up is never a "recovery" or a new peak from trading
    st.highWaterMark = Math.max(st.highWaterMark, equity);
    const dd = st.highWaterMark ? ((equity - st.highWaterMark) / st.highWaterMark) * 100 : 0;
    st.maxDrawdownPct = Math.min(st.maxDrawdownPct, dd);
    const row: LedgerRow = {
      time,
      event,
      symbol,
      amount,
      cash: st.cash,
      invested: this.invested,
      realizedPnl: st.realizedPnl,
      unrealizedPnl: equity - st.cash - this.invested,
      equity,
      openPositions: st.positions.length,
      highWaterMark: st.highWaterMark,
      drawdownPct: dd,
    };
    this.ledger.push(row);
    return row;
  }
}

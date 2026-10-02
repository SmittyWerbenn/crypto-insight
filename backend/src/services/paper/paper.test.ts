import { describe, expect, it } from 'vitest';
import { MONEY_RESEARCH, PaperPortfolio } from './portfolio.js';
import { entryCheck, levelsFor, STRATEGY_V2 } from './strategy.js';
import type { BtcContext, CoinFeatures } from './features.js';

const money = { ...MONEY_RESEARCH };
const open = (pf: PaperPortfolio, symbol: string, price = 100, slPct = 2.5) => pf.open({ symbol, time: 0, price, tp: price * 1.0075, sl: price * (1 - slPct / 100), slPct, atrPct: 1, maxHoldH: 8 });

describe('Paper Trading V2 portfolio', () => {
  it('sizes from base capital: risk / stop distance, capped per coin', () => {
    const pf = new PaperPortfolio(money);
    // 1% of 1.000.000 = 10.000 at risk; stop 2.5% → 400.000, capped at 20% = 200.000
    expect(pf.plannedSize(2.5)).toBe(200_000);
    // stop 10% → 100.000 (under the cap)
    expect(pf.plannedSize(10)).toBeCloseTo(100_000);
  });

  it('has no fees: P&L is exactly (exit − entry) × qty, and cash/equity follow it', () => {
    const pf = new PaperPortfolio(money);
    const { position } = open(pf, 'SOLUSDT', 100);
    expect(pf.state.cash).toBe(800_000);
    const t = pf.close(position!, 1, 102, 'TARGET');
    expect(t.pnl).toBeCloseTo(4_000); // 200.000 × 2%
    expect(pf.state.cash).toBeCloseTo(1_004_000);
    expect(pf.equity()).toBeCloseTo(1_004_000);
  });

  it('does not compound: the next position is sized on base capital even after a profit', () => {
    const pf = new PaperPortfolio(money);
    const a = open(pf, 'SOLUSDT', 100).position!;
    pf.close(a, 1, 150, 'TARGET'); // +100.000
    const b = open(pf, 'ETHUSDT', 100).position!;
    expect(b.layers[0].cost).toBe(200_000);
  });

  it('allows one position per coin and skips when the cluster cap or the cash reserve would be broken', () => {
    const pf = new PaperPortfolio(money);
    expect(open(pf, 'SOLUSDT').reason).toBeNull();
    expect(open(pf, 'SOLUSDT').reason).toMatch(/1 posisi per koin/);
    expect(open(pf, 'AVAXUSDT').reason).toBeNull(); // ALT_BETA now 40%
    expect(open(pf, 'NEARUSDT').reason).toMatch(/klaster ALT_BETA/); // would be 60% > 50%
    expect(open(pf, 'ZECUSDT').reason).toBeNull(); // other cluster; invested 60%, cash 400k
    expect(open(pf, 'BTCUSDT').reason).toMatch(/Cash tidak cukup|Eksposur total/); // reserve 30% / exposure 70%
  });

  it('skips a trade when real cash is short — no virtual top-up', () => {
    const pf = new PaperPortfolio(money);
    const p = open(pf, 'SOLUSDT', 100).position!;
    pf.close(p, 1, 0.5, 'CUTLOSS'); // lose almost everything in that position
    pf.state.cash = 350_000;
    expect(open(pf, 'ETHUSDT').reason).toMatch(/Cash tidak cukup/);
  });

  it('never averages down: extra layers only above the average entry', () => {
    const pf = new PaperPortfolio({ ...money, layers: [0.5, 0.5] });
    const p = open(pf, 'SOLUSDT', 100).position!;
    expect(pf.addLayer(p, 1, 99)).toMatch(/averaging down/);
    expect(pf.addLayer(p, 1, 101)).toBeNull();
    expect(p.layers).toHaveLength(2);
  });

  it('charges the fee on both sides and nets it out of P&L', () => {
    const pf = new PaperPortfolio({ ...money, feeRate: 0.001 });
    const p = open(pf, 'SOLUSDT', 100).position!;
    expect(pf.state.cash).toBeCloseTo(800_000 - 200);
    const t = pf.close(p, 1, 102, 'TARGET');
    // gross +4.000, fees 200 (buy) + 204 (sell)
    expect(t.fees).toBeCloseTo(404);
    expect(t.pnl).toBeCloseTo(3_596);
    expect(pf.state.cash).toBeCloseTo(1_003_596);
    expect(pf.state.feesPaid).toBeCloseTo(404);
  });

  it('compounding sizes from current equity; without it from paid-in capital', () => {
    const pf = new PaperPortfolio({ ...money, compounding: true });
    pf.close(open(pf, 'SOLUSDT', 100).position!, 1, 150, 'TARGET'); // equity 1.100.000
    expect(open(pf, 'ETHUSDT', 100).position!.layers[0].cost).toBeCloseTo(220_000);
    const fixed = new PaperPortfolio(money);
    fixed.close(open(fixed, 'SOLUSDT', 100).position!, 1, 150, 'TARGET');
    expect(open(fixed, 'ETHUSDT', 100).position!.layers[0].cost).toBe(200_000);
  });

  it('top-up adds cash and paid-in capital without counting as profit or a new peak', () => {
    const pf = new PaperPortfolio(money);
    pf.deposit(1, 500_000);
    expect(pf.state.cash).toBe(1_500_000);
    expect(pf.state.realizedPnl).toBe(0);
    expect(pf.sizingBase).toBe(1_500_000);
    expect(pf.ledger.at(-1)!.drawdownPct).toBe(0);
    expect(pf.ledger.at(-1)!.event).toBe('TOPUP');
  });

  it('tracks high-water mark and drawdown on marks', () => {
    const pf = new PaperPortfolio(money);
    const p = open(pf, 'SOLUSDT', 100).position!;
    pf.mark(1, { SOLUSDT: 110 }); // equity 1.020.000
    pf.mark(2, { SOLUSDT: 95 }); // equity 990.000
    expect(pf.state.highWaterMark).toBeCloseTo(1_020_000);
    expect(pf.state.maxDrawdownPct).toBeCloseTo(((990_000 - 1_020_000) / 1_020_000) * 100);
    pf.close(p, 3, 95, 'CUTLOSS');
  });
});

describe('Paper Trading V2 strategy', () => {
  const f = { regime: 'BULL', hh20Atr: 0.4, volRatio: 3.5, atrPct: 1 } as CoinFeatures;
  const btc = { ret30d: 4 } as BtcContext;
  it('requires BTC 30d uptrend, coin BULL regime, a 20h breakout and ≥3x volume', () => {
    expect(entryCheck(f, btc)).toBeNull();
    expect(entryCheck(f, { ...btc, ret30d: -2 })).toMatch(/tahan cash/);
    expect(entryCheck({ ...f, regime: 'SIDEWAYS' }, btc)).toMatch(/Regime/);
    expect(entryCheck({ ...f, hh20Atr: -0.1 }, btc)).toMatch(/breakout/);
    expect(entryCheck({ ...f, volRatio: 2.9 }, btc)).toMatch(/Volume/);
  });
  it('places TP at 0.75 ATR and the stop at 2.5 ATR from the fill', () => {
    const lv = levelsFor(100, 1.2, STRATEGY_V2);
    expect(lv.tp).toBeCloseTo(100.9);
    expect(lv.sl).toBeCloseTo(97);
  });
});

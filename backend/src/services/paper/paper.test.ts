import { describe, expect, it } from 'vitest';
import { MONEY_RESEARCH, PaperPortfolio } from './portfolio.js';
import { entryCheck, isSignal, levelsFor, priceMoved, PROFILE_IDS, PROFILES, rejectReasons, STRATEGY_V2 } from './strategy.js';
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
    expect(open(pf, 'SOLUSDT').code).toBe('HAS_POSITION');
    expect(open(pf, 'AVAXUSDT').reason).toBeNull(); // ALT_BETA now 40%
    expect(open(pf, 'NEARUSDT').reason).toMatch(/klaster ALT_BETA/); // would be 60% > 50%
    expect(open(pf, 'NEARUSDT').code).toBe('CLUSTER');
    expect(open(pf, 'ZECUSDT').reason).toBeNull(); // other cluster; invested 60%, cash 400k
    expect(open(pf, 'BTCUSDT').reason).toMatch(/Cash tidak cukup|Eksposur total/); // reserve 30% / exposure 70%
  });

  it('skips a trade when real cash is short — no virtual top-up', () => {
    const pf = new PaperPortfolio(money);
    const p = open(pf, 'SOLUSDT', 100).position!;
    pf.close(p, 1, 0.5, 'CUTLOSS'); // lose almost everything in that position
    pf.state.cash = 350_000;
    expect(open(pf, 'ETHUSDT').reason).toMatch(/Cash tidak cukup/);
    expect(open(pf, 'ETHUSDT').code).toBe('CASH');
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
  const f = { regime: 'BULL', hh20Atr: 0.4, volRatio: 3.5, atrPct: 1, emaUp: true } as CoinFeatures;
  const btc = { ret30d: 4 } as BtcContext;
  it('V2 baseline requires BTC 30d uptrend, coin BULL regime, a 20h breakout and ≥3x volume', () => {
    expect(entryCheck(f, btc, STRATEGY_V2)).toBeNull();
    expect(entryCheck(f, { ...btc, ret30d: -2 }, STRATEGY_V2)).toMatch(/BTC 30 hari/);
    expect(entryCheck({ ...f, regime: 'SIDEWAYS' }, btc, STRATEGY_V2)).toMatch(/Regime/);
    expect(entryCheck({ ...f, hh20Atr: -0.1 }, btc, STRATEGY_V2)).toMatch(/breakout/);
    expect(entryCheck({ ...f, volRatio: 2.9 }, btc, STRATEGY_V2)).toMatch(/Volume/);
  });

  it('a signal is a 20h breakout on ≥1.5x volume; no breakout = no signal (not a rejection)', () => {
    expect(isSignal(f)).toBe(true);
    expect(isSignal({ ...f, hh20Atr: 0 })).toBe(false);
    expect(isSignal({ ...f, volRatio: 1.4 })).toBe(false);
  });

  it('profiles are nested: whatever Aman accepts, Menengah and Agresif accept too (Agresif = Menengah rules, bigger size)', () => {
    const grid: CoinFeatures[] = [];
    for (const volRatio of [1.5, 2, 3, 4, 6]) for (const hh20Atr of [0.1, 0.3, 1]) for (const atrPct of [0.8, 1.2, 3.5, 5]) for (const emaUp of [true, false]) grid.push({ ...f, volRatio, hh20Atr, atrPct, emaUp });
    const ok = (p: (typeof PROFILE_IDS)[number], x: CoinFeatures) => rejectReasons(x, btc, PROFILES[p]).length === 0;
    const n = PROFILE_IDS.map((p) => grid.filter((x) => ok(p, x)).length);
    expect(n[0]).toBeGreaterThan(0);
    expect(n[0]).toBeLessThan(n[1]);
    expect(n[1]).toBe(n[2]);
    for (const x of grid) {
      if (ok('AMAN', x)) expect(ok('MENENGAH', x)).toBe(true);
      if (ok('MENENGAH', x)) expect(ok('AGRESIF', x)).toBe(true);
    }
  });

  it('records every failing rule with a code: 2x volume is too weak for every profile', () => {
    const sol = { ...f, volRatio: 2, hh20Atr: 0.3, atrPct: 1.2 };
    expect(rejectReasons(sol, btc, PROFILES.AMAN).map((r) => r.code)).toEqual(['VOLUME']);
    expect(rejectReasons(sol, btc, PROFILES.MENENGAH).map((r) => r.code)).toEqual(['VOLUME']);
    expect(rejectReasons(sol, btc, PROFILES.AGRESIF).map((r) => r.code)).toEqual(['VOLUME']);
    expect(rejectReasons({ ...sol, volRatio: 3.5 }, btc, PROFILES.AGRESIF)).toEqual([]);
    const weak = { ...f, volRatio: 2, regime: 'SIDEWAYS' as const, atrPct: 0.7, emaUp: false };
    expect(rejectReasons(weak, { ...btc, ret30d: -3 }, PROFILES.AGRESIF).map((r) => r.code)).toEqual(['BTC_NEUTRAL', 'COIN_REGIME', 'VOLUME', 'MOMENTUM', 'ATR_LOW']);
    expect(rejectReasons(f, { ...btc, ret30d: -8 }, PROFILES.AGRESIF)[0].code).toBe('BTC_BEAR');
    expect(rejectReasons({ ...f, volRatio: 5, atrPct: 3.5 }, btc, PROFILES.AMAN).map((r) => r.code)).toEqual(['RISK_HIGH']);
  });

  it('skips a fill that already ran away from the signal close', () => {
    expect(priceMoved(100, 100.2, 1)).toBeNull();
    expect(priceMoved(100, 99.4, 1)?.code).toBe('PRICE_MOVED');
    expect(priceMoved(100, 101.2, 1)?.code).toBe('PRICE_MOVED');
  });
  it('places TP at 0.75 ATR and the stop at 2.5 ATR from the fill', () => {
    const lv = levelsFor(100, 1.2, STRATEGY_V2);
    expect(lv.tp).toBeCloseTo(100.9);
    expect(lv.sl).toBeCloseTo(97);
  });
  it('Menengah/Agresif have no take profit, Aman a far one (12 ATR); stop 2 ATR, out after 48h', () => {
    for (const p of PROFILE_IDS) {
      const lv = levelsFor(100, 1.5, PROFILES[p]);
      if (p === 'AMAN') expect(lv.tp).toBeCloseTo(118);
      else expect(lv.tp).toBeNull();
      expect(lv.sl).toBeCloseTo(97);
      expect(PROFILES[p].maxHoldH).toBe(48);
    }
  });
});

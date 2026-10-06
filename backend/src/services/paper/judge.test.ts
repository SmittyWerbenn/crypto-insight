import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client.js', () => ({ getDb: () => ({}), isDbReady: () => true }));
const { judgeSignals } = await import('./engine.js');
const { MONEY_PROFILES, PaperPortfolio } = await import('./portfolio.js');
const { PROFILE_IDS } = await import('./strategy.js');
import type { BtcContext, CoinFeatures } from './features.js';

const btc = { ret30d: 5, regime: 'BULL', ret24h: 1 } as BtcContext;
const feat = (o: Partial<CoinFeatures>) => ({ close: 100, score: 80, signal: 'BUY', regime: 'BULL', volRatio: 5, atrPct: 1.2, hh20Atr: 0.4, emaUp: true, rsi: 60, atrPctile: 50, macdHist: 0, ret4h: 1, ...o }) as CoinFeatures;
const accounts = () => Object.fromEntries(PROFILE_IDS.map((p) => [p, new PaperPortfolio({ ...MONEY_PROFILES[p], feeRate: 0.001 })])) as never;

describe('judgeSignals: each profile accepts or rejects every signal, with reasons', () => {
  it('strong signal → all buy; 3.5x volume → Menengah and Agresif; SIDEWAYS → nobody', async () => {
    const pfs = accounts();
    const r = await judgeSignals({
      now: 0,
      btc,
      signals: [
        { symbol: 'SOLUSDT', f: feat({}) },
        { symbol: 'ENAUSDT', f: feat({ volRatio: 3.5 }) },
        { symbol: 'ZECUSDT', f: feat({ regime: 'SIDEWAYS' }) },
      ],
      pfs,
      priceOf: async () => 100,
    });
    const d = (sym: string, p: string) => r.decisions.find((x) => x.symbol === sym && x.profile === p)!;
    for (const p of PROFILE_IDS) expect(d('SOLUSDT', p).decision).toBe('ACCEPT');
    expect(d('ENAUSDT', 'AMAN')).toMatchObject({ decision: 'REJECT', stage: 'RULE', reasons: [{ code: 'VOLUME' }] });
    expect(d('ENAUSDT', 'MENENGAH').decision).toBe('ACCEPT');
    expect(d('ENAUSDT', 'AGRESIF').decision).toBe('ACCEPT');
    for (const p of PROFILE_IDS) expect(d('ZECUSDT', p).reasons).toEqual([expect.objectContaining({ code: 'COIN_REGIME' })]);
    expect(r.decisions).toHaveLength(9);
    expect(r.profiles.AMAN).toMatchObject({ accepted: 1, entered: 1, rejected: 2 });
    expect(r.profiles.AGRESIF).toMatchObject({ accepted: 2, entered: 2, rejected: 1 });
    expect(r.entries.map((e) => `${e.profile}:${e.symbol}`)).toEqual(['AMAN:SOLUSDT', 'MENENGAH:SOLUSDT', 'AGRESIF:SOLUSDT', 'MENENGAH:ENAUSDT', 'AGRESIF:ENAUSDT']);
    // Stop 2 ATR for everyone; no take profit except Aman's far one (12 ATR); out after 48h.
    expect(r.entries.every((e) => Math.abs(e.sl - 97.6) < 1e-9)).toBe(true);
    expect(r.entries.map((e) => (e.tp === null ? null : Math.round(e.tp * 10) / 10))).toEqual([114.4, null, null, null, null]);
    expect(pfs.AGRESIF.state.positions[0].timeoutAt).toBe(48 * 3_600_000);
    expect(pfs.AGRESIF.state.positions).toHaveLength(2);
  });

  it('money stage: a coin already held and a fill that ran away are rejected with their own codes', async () => {
    const pfs = accounts();
    await judgeSignals({ now: 0, btc, signals: [{ symbol: 'SOLUSDT', f: feat({}) }], pfs, priceOf: async () => 100 });
    const r = await judgeSignals({
      now: 3_600_000,
      btc,
      signals: [
        { symbol: 'SOLUSDT', f: feat({}) },
        { symbol: 'AVAXUSDT', f: feat({}) },
      ],
      pfs,
      priceOf: async (s) => (s === 'AVAXUSDT' ? 98 : 100),
    });
    const sol = r.decisions.find((x) => x.symbol === 'SOLUSDT' && x.profile === 'MENENGAH')!;
    expect(sol).toMatchObject({ decision: 'REJECT', stage: 'MONEY', reasons: [{ code: 'HAS_POSITION' }] });
    const avax = r.decisions.find((x) => x.symbol === 'AVAXUSDT' && x.profile === 'AGRESIF')!;
    expect(avax).toMatchObject({ decision: 'REJECT', stage: 'MONEY', reasons: [{ code: 'PRICE_MOVED' }] });
    expect(r.entries).toHaveLength(0);
  });

  it('BTC neutral → every profile holds cash, and says why', async () => {
    const r = await judgeSignals({ now: 0, btc: { ...btc, ret30d: -2 }, signals: [{ symbol: 'SOLUSDT', f: feat({}) }], pfs: accounts(), priceOf: async () => 100 });
    expect(r.entries).toHaveLength(0);
    expect(r.decisions.every((x) => (x.reasons as { code: string }[])[0].code === 'BTC_NEUTRAL')).toBe(true);
  });
});

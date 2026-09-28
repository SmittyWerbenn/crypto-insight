import { env, trackedSymbols } from '../../config/env.js';
import { SIGNAL_LABEL_ID as SIGNAL_LABEL } from '../../config/scoring.js';
import type { Timeframe } from '../../config/timeframes.js';
import { getDb, isDbReady } from '../../db/client.js';
import { watchlists } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { round } from '../../utils/math.js';
import { marketData } from '../binance/index.js';
import { cache } from '../cache/cache.js';
import { technicalAnalysis, ANALYSIS_CANDLES } from '../analysis/analysis.service.js';
import { getCandles } from '../market/candles.service.js';
import { allUsdtTickers } from '../market/market.service.js';
import { getPortfolio } from '../portfolio/portfolio.service.js';
import { holdMs, opportunityScore, planSymbol, RISK_PER_TRADE, type RiskProfile, type SymbolPlan } from './plan.js';

export interface PlannerInput {
  /** Capital in USDT (frontend converts from Rupiah). */
  capital: number;
  risk: RiskProfile;
  timeframe: Timeframe;
  maxPositions: number;
  fee: number;
  slippage: number;
  /** 'tracked' = dashboard coins + watchlist; 'top' = also the most liquid USDT pairs on Binance. */
  universe: 'tracked' | 'top';
}

const TOP_UNIVERSE = 20;

export interface PlanPick {
  rank: number;
  symbol: string;
  signal: string;
  signalLabel: string;
  technicalScore: number;
  entry: number;
  target: number;
  stop: number;
  targetPct: number;
  stopPct: number;
  riskReward: number | null;
  quantity: number;
  positionValue: number;
  profitIfTarget: number;
  lossIfStop: number;
  expectedValue: number;
  estimatedHoldMs: number | null;
  maxHoldMs: number;
  history: NonNullable<SymbolPlan['history']>;
  reasons: string[];
  risks: string[];
  riskLevel: string;
  /** Plain-language caveats derived from the historical simulation. */
  notes: string[];
}

function notesFor(h: NonNullable<SymbolPlan['history']>, tfLabel: string): string[] {
  const n: string[] = [];
  if ((h.hitRate ?? 0) < 20)
    n.push(`Target jarang tercapai (${h.hitRate}% dari ${h.sampleSize} kasus); keuntungan historis sebagian besar datang dari penjualan saat batas waktu tahan, bukan dari target.`);
  if (h.reliability === 'LIMITED') n.push(`Sampel historis terbatas (${h.sampleSize} kasus) — statistik bisa kurang andal.`);
  if (h.stopHit > h.targetHit) n.push(`Secara historis stop loss lebih sering kena (${h.stopHit}x) daripada target (${h.targetHit}x); profit bergantung pada ukuran target yang lebih besar dari risiko.`);
  n.push(`Dihitung pada timeframe ${tfLabel}. Pantau ulang setiap candle baru; rencana berubah jika sinyal berubah.`);
  return n;
}

async function symbolsToScan(universe: PlannerInput['universe']): Promise<string[]> {
  const set = new Set(trackedSymbols);
  if (universe === 'top') {
    try {
      const top = (await allUsdtTickers()).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, TOP_UNIVERSE);
      for (const t of top) set.add(t.symbol);
    } catch {
      /* fall back to tracked symbols */
    }
  }
  if (isDbReady()) {
    try {
      for (const w of await getDb().select({ symbol: watchlists.symbol }).from(watchlists)) set.add(w.symbol);
    } catch {
      /* watchlist optional */
    }
  }
  return [...set];
}

/**
 * Trade planner: which coins to buy now, where to take profit / cut loss, how long to hold,
 * position size for the user's capital and risk profile, and historically-grounded profit estimates.
 * Everything is computed from market data and the historical simulation — never guaranteed.
 */
export async function buildTradePlan(input: PlannerInput) {
  const costPerSidePct = (input.fee + input.slippage) * 100;
  const symbols = await symbolsToScan(input.universe);
  const plans: SymbolPlan[] = [];
  const failed: string[] = [];
  const scanOne = async (symbol: string) => {
    try {
      const candles = await getCandles(symbol, input.timeframe, { limit: ANALYSIS_CANDLES });
      if (!candles.length) throw new Error('no data');
      const last = candles[candles.length - 1].openTime;
      const key = `plan:${marketData.source}:${symbol}:${input.timeframe}:${last}:${costPerSidePct}`;
      const p = await cache.wrap(key, 3600, async () => planSymbol(symbol, input.timeframe, candles, costPerSidePct));
      plans.push(p);
    } catch (e) {
      logger.warn({ symbol, err: (e as Error).message }, 'Planner skipped symbol');
      failed.push(symbol);
    }
  };
  for (let i = 0; i < symbols.length; i += 4) await Promise.all(symbols.slice(i, i + 4).map(scanOne));

  // Conservative and moderate profiles skip high-volatility coins and plans whose target is rarely reached
  if (input.risk !== 'agresif') {
    for (const p of plans) {
      if (!p.eligible || !p.history) continue;
      if (p.analysis.risk.level === 'HIGH') {
        p.eligible = false;
        p.reason = `Risiko volatilitas tinggi — tidak cocok untuk profil ${input.risk} (pilih profil agresif untuk menampilkannya).`;
      } else if ((p.history.hitRate ?? 0) < 15) {
        p.eligible = false;
        p.reason = `Target jarang tercapai secara historis (${p.history.hitRate}%) — tidak cocok untuk profil ${input.risk}.`;
      }
    }
  }
  const eligible = plans.filter((p) => p.eligible && p.history).sort((a, b) => opportunityScore(b.history!) - opportunityScore(a.history!));
  const chosen = eligible.slice(0, input.maxPositions);
  const riskPerTrade = input.capital * RISK_PER_TRADE[input.risk];
  const maxPerPosition = input.capital / input.maxPositions;
  const cost = input.fee + input.slippage;

  const picks: PlanPick[] = chosen.map((p, idx) => {
    const entry = p.entry!;
    const stop = p.stop!;
    const target = p.target!;
    // Size so that hitting the stop loses about riskPerTrade, capped by an equal capital split
    let qty = riskPerTrade / (entry - stop);
    if (qty * entry > maxPerPosition) qty = maxPerPosition / entry;
    const positionValue = qty * entry;
    const fees = (v: number) => v * cost;
    const t = p.analysis;
    return {
      rank: idx + 1,
      symbol: p.symbol,
      signal: t.signal,
      signalLabel: SIGNAL_LABEL[t.signal],
      technicalScore: t.technicalScore,
      entry,
      target,
      stop,
      targetPct: p.targetPct!,
      stopPct: p.stopPct!,
      riskReward: t.levels?.riskReward ?? null,
      quantity: qty,
      positionValue: round(positionValue, 2),
      profitIfTarget: round(qty * (target - entry) - fees(positionValue) - fees(qty * target), 2),
      lossIfStop: round(-(qty * (entry - stop)) - fees(positionValue) - fees(qty * stop), 2),
      expectedValue: round((positionValue * (p.history!.expectancyNetPct ?? 0)) / 100, 2),
      estimatedHoldMs: p.history!.medianCandlesToTarget !== null ? holdMs(p.history!.medianCandlesToTarget, input.timeframe) : null,
      maxHoldMs: holdMs(p.maxHoldCandles, input.timeframe),
      history: p.history!,
      reasons: t.score.factors.filter((f) => f.type === 'positive').map((f) => f.text).slice(0, 5),
      risks: [...t.score.factors.filter((f) => f.type === 'negative').map((f) => f.text), ...t.risk.reasons].slice(0, 4),
      riskLevel: t.risk.level,
      notes: notesFor(p.history!, input.timeframe.toUpperCase()),
    };
  });

  // Holdings the engine currently rates SELL / STRONG SELL
  const sellSuggestions: { symbol: string; quantity: number; signalLabel: string; technicalScore: number; price: number; unrealizedPnl: number | null; unrealizedPnlPct: number | null; reasons: string[] }[] = [];
  if (isDbReady()) {
    try {
      const pf = await getPortfolio();
      for (const pos of pf.positions) {
        try {
          const t = await technicalAnalysis(pos.symbol, input.timeframe);
          if (t.signal === 'SELL' || t.signal === 'STRONG_SELL')
            sellSuggestions.push({ symbol: pos.symbol, quantity: pos.quantity, signalLabel: SIGNAL_LABEL[t.signal], technicalScore: t.technicalScore, price: pos.price ?? t.price, unrealizedPnl: pos.unrealizedPnl, unrealizedPnlPct: pos.unrealizedPnlPct, reasons: t.score.factors.filter((f) => f.type === 'negative').map((f) => f.text).slice(0, 4) });
        } catch {
          /* skip symbol */
        }
      }
    } catch {
      /* portfolio optional */
    }
  }

  const invested = picks.reduce((a, p) => a + p.positionValue, 0);
  return {
    generatedAt: new Date().toISOString(),
    source: marketData.source,
    input,
    summary: {
      scanned: plans.length,
      buySignals: plans.filter((p) => p.analysis.signal === 'BUY' || p.analysis.signal === 'STRONG_BUY').length,
      picks: picks.length,
      capitalUsed: round(invested, 2),
      cashReserve: round(input.capital - invested, 2),
      totalProfitIfAllTargets: round(picks.reduce((a, p) => a + p.profitIfTarget, 0), 2),
      totalLossIfAllStops: round(picks.reduce((a, p) => a + p.lossIfStop, 0), 2),
      totalExpectedValue: round(picks.reduce((a, p) => a + p.expectedValue, 0), 2),
      riskPerTrade: round(riskPerTrade, 2),
    },
    picks,
    notRecommended: plans
      .filter((p) => !chosen.includes(p))
      .map((p) => ({
        symbol: p.symbol,
        signal: p.analysis.signal,
        signalLabel: SIGNAL_LABEL[p.analysis.signal],
        technicalScore: p.analysis.technicalScore,
        reason: p.reason ?? `Peluang lebih rendah dibanding pilihan lain (maks. ${input.maxPositions} posisi).`,
        expectancyNetPct: p.history?.expectancyNetPct ?? null,
      })),
    sellSuggestions,
    failed,
    disclaimer:
      'Rencana ini adalah hasil analisa teknikal & simulasi historis, bukan jaminan. Estimasi untung/rugi dihitung dari level harga dan perilaku historis setup serupa setelah biaya. Harga bisa bergerak berbeda; selalu gunakan stop loss dan dana yang siap Anda risikokan.',
    timezone: env.APP_TIMEZONE,
  };
}

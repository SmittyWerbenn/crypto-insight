import { and, desc, eq } from 'drizzle-orm';
import { env, isAiConfigured, trackedSymbols } from '../../config/env.js';
import { SIGNAL_LABEL } from '../../config/scoring.js';
import type { Timeframe } from '../../config/timeframes.js';
import { getDb, isDbReady } from '../../db/client.js';
import { aiAnalysis, technicalIndicators } from '../../db/schema.js';
import type { DerivativesData } from '../../types/market.js';
import { logger } from '../../utils/logger.js';
import { mean, round } from '../../utils/math.js';
import { marketData } from '../binance/index.js';
import { getStatus } from '../binance/status.js';
import { cache } from '../cache/cache.js';
import { ClaudeError, claude } from '../claude/claude.service.js';
import type { CoinAnalysis, MarketSummary } from '../claude/schemas.js';
import { getCandles } from '../market/candles.service.js';
import { allUsdtTickers, computeBreadth, globalMarket, getTicker } from '../market/market.service.js';
import { fearGreed, latestNews } from '../sentiment/sentiment.service.js';
import { recordSignal } from '../signals/signals.service.js';
import { enforceCoinConsistency, enforceMarketConsistency } from './consistency.js';
import { analyzeCandles, type TechnicalAnalysis } from './technical-analysis.js';

export const ANALYSIS_CANDLES = 1500;

export async function derivativesFor(symbol: string): Promise<DerivativesData> {
  return cache.wrap(`deriv:${marketData.source}:${symbol}`, 120, () => marketData.derivatives(symbol));
}

/** Technical analysis on closed candles, cached per closed candle. */
export async function technicalAnalysis(symbol: string, tf: Timeframe): Promise<TechnicalAnalysis> {
  const candles = await getCandles(symbol, tf, { limit: ANALYSIS_CANDLES });
  if (!candles.length) throw new Error(`No market data for ${symbol}`);
  const last = candles[candles.length - 1];
  return cache.wrap(`tech:${marketData.source}:${symbol}:${tf}:${last.openTime}`, 3600, async () => {
    const t = analyzeCandles(symbol, tf, candles);
    if (isDbReady()) {
      const { priceAction, ...rest } = t.snapshot;
      await getDb()
        .insert(technicalIndicators)
        .values({ symbol, timeframe: tf, timestamp: t.candleTime, technicalScore: t.technicalScore, signal: t.signal, data: { ...rest, priceAction, components: t.score.components } })
        .onConflictDoNothing();
    }
    return t;
  });
}

/** The structured context Claude receives. Every number here is computed by the backend. */
export function buildCoinContext(t: TechnicalAnalysis, d: DerivativesData, fg: Awaited<ReturnType<typeof fearGreed>>, livePrice: number | null, newsSentiment: unknown) {
  const s = t.snapshot;
  const f = (h: number) => t.historical.forward.find((x) => x.hours === h) ?? null;
  return {
    symbol: t.symbol,
    timeframe: t.timeframe,
    dataSource: marketData.source,
    candleCloseTime: new Date(t.candleCloseTime + 1).toISOString(),
    price: s.price,
    livePrice,
    signal: t.signal,
    signalLabel: SIGNAL_LABEL[t.signal],
    technicalScore: t.technicalScore,
    scoreComponents: t.score.components.map((c) => ({ component: c.label, weight: c.weight, points: c.points, available: c.available })),
    engineFactors: t.score.factors,
    dataCompleteness: t.dataCompleteness,
    trend: { ma20: s.sma20, ma50: s.sma50, ma200: s.sma200, ema20: s.ema20, ema50: s.ema50, adx: s.adx, regime: t.regime },
    momentum: { rsi: s.rsi, macd: s.macdState, macdLine: s.macd, macdSignal: s.macdSignal, macdHistogram: s.macdHistogram, stochRsiK: s.stochRsiK, stochRsiD: s.stochRsiD, roc10: s.roc },
    volatility: { atr: s.atr, atrPct: s.atrPct, historicalVolatilityAnnualized: s.historicalVolatility, bollingerUpper: s.bbUpper, bollingerLower: s.bbLower, bollingerPercentB: s.bbPercentB },
    volume: { volume: s.volume, volumeMa20: s.volumeMa, volumeChangePct: s.volumeChangePct, obvSlope10: s.obvSlope },
    priceAction: { structure: s.priceAction.structure, breakout: s.priceAction.breakout, breakdown: s.priceAction.breakdown, support: s.priceAction.support, resistance: s.priceAction.resistance, supportLevels: s.priceAction.supportLevels, resistanceLevels: s.priceAction.resistanceLevels },
    risk: t.risk,
    levels: t.levels,
    scenario: t.scenarios,
    historical: {
      similarSetupDefinition: t.historical.setup,
      historicalSimilarSetups: t.historical.sampleSize,
      positiveOutcomes: t.historical.positive,
      negativeOutcomes: t.historical.negative,
      historicalPositiveRate: t.historical.historicalPositiveRate,
      outcomeHorizonCandles: t.historical.outcomeHorizon,
      medianReturn24h: f(24)?.median ?? null,
      medianReturn48h: f(48)?.median ?? null,
      forwardReturns: t.historical.forward,
      maxHistoricalGain: t.historical.maxHistoricalGain,
      maxHistoricalLoss: t.historical.maxHistoricalLoss,
      reliability: t.historical.reliability,
      note: t.historical.note,
    },
    derivatives: d.available
      ? { fundingRatePct: d.fundingRate, openInterest: d.openInterest, openInterestValueUsd: d.openInterestValue, openInterestChange24hPct: d.openInterestChangePct, longShortRatio: d.longShortRatio, futuresVolumeUsd: d.futuresQuoteVolume }
      : { unavailable: true, reason: d.error ?? 'not available' },
    fearGreed: fg ? { value: fg.value, classification: fg.classification } : null,
    newsSentiment,
    dataQualityWarnings: t.dataQuality.warnings,
  };
}

export interface CoinAnalysisResult {
  symbol: string;
  timeframe: Timeframe;
  source: 'binance' | 'mock';
  technical: TechnicalAnalysis;
  derivatives: DerivativesData;
  fearGreed: Awaited<ReturnType<typeof fearGreed>>;
  ai: {
    status: 'OK' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_REQUESTED';
    analysis: CoinAnalysis | null;
    model: string | null;
    generatedAt: string | null;
    cached: boolean;
    consistencyWarnings: string[];
    error: string | null;
    lastSuccessfulAt: string | null;
  };
}

async function lastAi(symbol: string, tf: string, kind: 'COIN' | 'MARKET') {
  if (!isDbReady()) return null;
  const [row] = await getDb()
    .select()
    .from(aiAnalysis)
    .where(and(eq(aiAnalysis.symbol, symbol), eq(aiAnalysis.timeframe, tf), eq(aiAnalysis.kind, kind), eq(aiAnalysis.status, 'OK')))
    .orderBy(desc(aiAnalysis.timestamp))
    .limit(1);
  return row ?? null;
}

/**
 * Full coin analysis. `ai`: 'auto' reuses a stored AI result for the same candle or calls Claude;
 * 'force' always calls Claude ("Analyze Now"); 'none' skips AI.
 */
export async function analyzeCoin(symbol: string, tf: Timeframe, ai: 'auto' | 'force' | 'none' = 'auto'): Promise<CoinAnalysisResult> {
  const t = await technicalAnalysis(symbol, tf);
  const [d, fg, ticker, news] = await Promise.all([
    derivativesFor(symbol),
    fearGreed(),
    getTicker(symbol).catch(() => null),
    latestNews(symbol.replace(/USDT$/, '')).catch(() => null),
  ]);
  const result: CoinAnalysisResult = {
    symbol,
    timeframe: tf,
    source: marketData.source,
    technical: t,
    derivatives: d,
    fearGreed: fg,
    ai: { status: 'NOT_REQUESTED', analysis: null, model: null, generatedAt: null, cached: false, consistencyWarnings: [], error: null, lastSuccessfulAt: null },
  };

  const prev = await lastAi(symbol, tf, 'COIN');
  if (ai === 'none') {
    if (!isAiConfigured() && !env.MOCK_MODE) {
      result.ai = { ...result.ai, status: 'NOT_CONFIGURED', error: 'Analisa AI tidak tersedia: API key penyedia AI belum dikonfigurasi. Data teknikal pasar tetap tersedia.' };
    }
    if (prev?.result && prev.candleTime === t.candleTime) {
      const r = prev.result as { analysis: CoinAnalysis; warnings: string[] };
      result.ai = { status: 'OK', analysis: r.analysis, model: prev.model, generatedAt: prev.timestamp.toISOString(), cached: true, consistencyWarnings: r.warnings, error: null, lastSuccessfulAt: prev.timestamp.toISOString() };
    }
    return result;
  }
  // Signals are recorded for every analysis cycle, with or without AI.
  const persistSignal = (analysisId: string | null) =>
    recordSignal(t, {
      aiConfidence: result.ai.status === 'OK' ? (result.ai.analysis?.confidence ?? null) : null,
      marketCondition: result.ai.status === 'OK' ? (result.ai.analysis?.marketCondition ?? null) : null,
      analysisId,
      fundingRate: d.fundingRate,
      openInterest: d.openInterest,
      fearGreed: fg?.value ?? null,
      volatilityRegime: volatilityRegimeOf(t),
    }).catch((e) => logger.warn({ err: (e as Error).message }, 'recordSignal failed'));

  if (!isAiConfigured() && !env.MOCK_MODE) {
    result.ai = { ...result.ai, status: 'NOT_CONFIGURED', error: 'Analisa AI tidak tersedia: API key penyedia AI belum dikonfigurasi. Data teknikal pasar tetap tersedia.' };
    await persistSignal(null);
    return result;
  }
  if (ai === 'auto' && prev?.result && prev.candleTime === t.candleTime) {
    const r = prev.result as { analysis: CoinAnalysis; warnings: string[] };
    result.ai = { status: 'OK', analysis: r.analysis, model: prev.model, generatedAt: prev.timestamp.toISOString(), cached: true, consistencyWarnings: r.warnings, error: null, lastSuccessfulAt: prev.timestamp.toISOString() };
    await persistSignal(prev.id);
    return result;
  }

  const newsSentiment = news?.available ? { provider: news.provider, breakdownPct: news.sentimentBreakdown, headlines: news.items.slice(0, 5).map((n) => ({ title: n.title, sentiment: n.sentiment, publishedAt: n.publishedAt })) } : null;
  const context = buildCoinContext(t, d, fg, ticker?.lastPrice ?? null, newsSentiment);
  let analysisId: string | null = null;
  try {
    let data: CoinAnalysis;
    let model: string;
    let cached = false;
    if (!isAiConfigured() && env.MOCK_MODE) {
      ({ data, model } = mockCoinAnalysis(t));
    } else {
      const r = await claude.analyzeCoin({ symbol, timeframe: tf, candleTime: t.candleTime }, context, ai === 'force');
      data = r.data;
      model = r.model;
      cached = r.cached;
    }
    const { analysis, warnings } = enforceCoinConsistency(data, t);
    if (warnings.length) logger.info({ symbol, warnings }, 'AI output adjusted for consistency');
    const now = new Date();
    if (isDbReady()) {
      const [row] = await getDb()
        .insert(aiAnalysis)
        .values({ symbol, timeframe: tf, timestamp: now, candleTime: t.candleTime, kind: 'COIN', model, status: 'OK', context, result: { analysis, warnings } })
        .returning({ id: aiAnalysis.id });
      analysisId = row.id;
    }
    result.ai = { status: 'OK', analysis, model, generatedAt: now.toISOString(), cached, consistencyWarnings: warnings, error: null, lastSuccessfulAt: now.toISOString() };
  } catch (e) {
    const msg = e instanceof ClaudeError ? `${e.code}: ${e.message}` : (e as Error).message;
    logger.warn({ symbol, err: msg }, 'AI coin analysis failed');
    if (isDbReady()) await getDb().insert(aiAnalysis).values({ symbol, timeframe: tf, timestamp: new Date(), candleTime: t.candleTime, kind: 'COIN', model: claude.modelName, status: 'UNAVAILABLE', context, error: msg });
    result.ai = {
      ...result.ai,
      status: 'UNAVAILABLE',
      error: 'Analisa AI sementara tidak tersedia. Data teknikal pasar tetap tersedia.',
      lastSuccessfulAt: prev?.timestamp.toISOString() ?? null,
      // Show the last valid AI analysis (clearly timestamped) if one exists
      analysis: prev?.result ? (prev.result as { analysis: CoinAnalysis }).analysis : null,
      generatedAt: prev?.timestamp.toISOString() ?? null,
      model: prev?.model ?? null,
    };
  }

  await persistSignal(result.ai.status === 'OK' ? analysisId : null);
  return result;
}

/** HIGH when current annualized volatility exceeds its median over the last 100 candles (causal). */
function volatilityRegimeOf(t: TechnicalAnalysis): 'HIGH' | 'LOW' | null {
  const hv = t.snapshot.historicalVolatility;
  return hv === null ? null : t.volatilityMedian !== null && hv > t.volatilityMedian ? 'HIGH' : 'LOW';
}

/** Deterministic, clearly-labelled AI placeholder used ONLY in MOCK_MODE without an API key. */
function mockCoinAnalysis(t: TechnicalAnalysis): { data: CoinAnalysis; model: string } {
  const pos = t.score.factors.filter((f) => f.type === 'positive').map((f) => f.text);
  const neg = t.score.factors.filter((f) => f.type === 'negative').map((f) => f.text);
  const sc = t.scenarios!;
  return {
    model: 'mock (MOCK_MODE)',
    data: {
      marketCondition: t.technicalScore >= 65 ? 'BULLISH_MODERATE' : t.technicalScore < 45 ? 'BEARISH_MODERATE' : 'NEUTRAL',
      signal: t.signal,
      technicalScore: t.technicalScore,
      confidence: null,
      confidenceRationale: '[MOCK] Placeholder — no AI model was called.',
      summary: `[MOCK] ${t.symbol} ${SIGNAL_LABEL[t.signal]} dengan technical score ${t.technicalScore}/100. Ini adalah teks placeholder MOCK_MODE, bukan analisis AI.`,
      observedFacts: pos.slice(0, 3).concat(neg.slice(0, 2)),
      technicalInterpretation: '[MOCK] Placeholder.',
      historicalEvidence: `[MOCK] ${t.historical.sampleSize} setup serupa.`,
      reasons: pos.length ? pos : ['[MOCK] Tidak ada faktor positif'],
      risks: neg.length ? neg : ['[MOCK] Tidak ada faktor negatif'],
      uncertainty: '[MOCK] Placeholder.',
      historicalContext: { sampleSize: 0, positiveRate: null, medianReturn24h: null, medianReturn48h: null },
      scenario: {
        bullish: { target: sc.bullish.target, potential: sc.bullish.potential, explanation: sc.bullish.trigger },
        base: { low: sc.base.low, high: sc.base.high, explanation: sc.base.description },
        bearish: { target: sc.bearish.target, potential: sc.bearish.potential, explanation: sc.bearish.trigger },
      },
    },
  };
}

/** Backend-computed market condition from average score and breadth. */
export function computeMarketCondition(avgScore: number, breadthLabel: string): MarketSummary['marketCondition'] {
  const adj = avgScore + (breadthLabel === 'POSITIVE' ? 3 : breadthLabel === 'NEGATIVE' ? -3 : 0);
  if (adj >= 75) return 'BULLISH_STRONG';
  if (adj >= 58) return 'BULLISH_MODERATE';
  if (adj > 42) return 'NEUTRAL';
  if (adj > 28) return 'BEARISH_MODERATE';
  return 'BEARISH_STRONG';
}

export interface DailyRow {
  symbol: string;
  price: number;
  changePct: number | null;
  signal: string;
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
  error?: string;
}

/** AI Daily Analysis table: technicals for every tracked symbol + latest AI confidence. */
export async function dailyAnalysis(tf: Timeframe = env.ANALYSIS_TIMEFRAME as Timeframe, symbols = trackedSymbols) {
  const tickers = new Map((await allUsdtTickers().catch(() => [])).map((t) => [t.symbol, t]));
  const rows = await Promise.all(
    symbols.map(async (symbol): Promise<DailyRow | null> => {
      try {
        const t = await technicalAnalysis(symbol, tf);
        const ai = await lastAi(symbol, tf, 'COIN');
        const aiRes = ai?.result as { analysis: CoinAnalysis } | undefined;
        const tk = tickers.get(symbol);
        return {
          symbol,
          price: tk?.lastPrice ?? t.price,
          changePct: tk ? round(tk.priceChangePercent, 2) : null,
          signal: t.signal,
          signalLabel: t.signalLabel,
          technicalScore: t.technicalScore,
          aiConfidence: ai && ai.candleTime === t.candleTime ? (aiRes?.analysis.confidence ?? null) : null,
          upsidePct: t.levels?.upsidePct ?? null,
          downsidePct: t.levels?.downsidePct ?? null,
          target: t.levels?.target ?? null,
          stop: t.levels?.stop ?? null,
          historicalPositiveRate: t.historical.historicalPositiveRate,
          historicalSampleSize: t.historical.sampleSize,
          historicalReliability: t.historical.reliability,
          risk: t.risk.level,
          rsi: t.snapshot.rsi,
          support: t.snapshot.priceAction.support,
          resistance: t.snapshot.priceAction.resistance,
          candleTime: t.candleTime,
        };
      } catch (e) {
        logger.warn({ symbol, err: (e as Error).message }, 'Daily analysis failed for symbol');
        return null;
      }
    }),
  );
  const ok = rows.filter((r): r is DailyRow => r !== null).sort((a, b) => b.technicalScore - a.technicalScore);
  return { timeframe: tf, source: marketData.source, generatedAt: new Date().toISOString(), rows: ok, failed: symbols.filter((s) => !ok.find((r) => r.symbol === s)) };
}

/** Market-wide context → Claude market summary (rate-limited by AI_MARKET_SUMMARY_MINUTES unless forced). */
export async function marketSummary(force = false) {
  const tf = env.ANALYSIS_TIMEFRAME as Timeframe;
  const [daily, tickers, global, fg, btcDeriv, ethDeriv] = await Promise.all([
    dailyAnalysis(tf),
    allUsdtTickers(),
    globalMarket(),
    fearGreed(),
    derivativesFor('BTCUSDT'),
    derivativesFor('ETHUSDT'),
  ]);
  const liquid = tickers.filter((t) => t.quoteVolume >= 1_000_000 || marketData.source === 'mock');
  const breadth = computeBreadth(liquid);
  const techs = await Promise.all(daily.rows.map((r) => technicalAnalysis(r.symbol, tf)));
  const avgScore = mean(daily.rows.map((r) => r.technicalScore));
  const condition = computeMarketCondition(avgScore, breadth.label);
  const btc = techs.find((t) => t.symbol === 'BTCUSDT');
  const alts = techs.filter((t) => t.symbol !== 'BTCUSDT');
  const volRatios = techs.map((t) => t.snapshot.volumeRatio).filter((v): v is number => v !== null);
  const hvs = techs.map((t) => t.snapshot.historicalVolatility).filter((v): v is number => v !== null);
  const levels = new Map(techs.map((t) => [t.symbol, { support: t.snapshot.priceAction.support, resistance: t.snapshot.priceAction.resistance }]));
  const context = {
    timeframe: tf,
    dataSource: marketData.source,
    engineMarketCondition: condition,
    averageTechnicalScore: round(avgScore, 1),
    signalCounts: daily.rows.reduce<Record<string, number>>((a, r) => ((a[r.signal] = (a[r.signal] ?? 0) + 1), a), {}),
    btc: btc
      ? { price: btc.price, signal: btc.signal, score: btc.technicalScore, rsi: btc.snapshot.rsi, aboveMa20: btc.snapshot.sma20 !== null ? btc.price > btc.snapshot.sma20 : null, aboveMa50: btc.snapshot.sma50 !== null ? btc.price > btc.snapshot.sma50 : null, aboveMa200: btc.snapshot.sma200 !== null ? btc.price > btc.snapshot.sma200 : null, regime: btc.regime, support: btc.snapshot.priceAction.support, resistance: btc.snapshot.priceAction.resistance }
      : null,
    altcoins: alts.map((t) => ({ symbol: t.symbol, signal: t.signal, score: t.technicalScore, rsi: t.snapshot.rsi, regime: t.regime, upsidePct: t.levels?.upsidePct ?? null, downsidePct: t.levels?.downsidePct ?? null, risk: t.risk.level, support: t.snapshot.priceAction.support, resistance: t.snapshot.priceAction.resistance, historicalPositiveRate: t.historical.historicalPositiveRate, historicalSampleSize: t.historical.sampleSize })),
    breadth,
    global,
    averageVolumeRatioVs20: volRatios.length ? round(mean(volRatios), 2) : null,
    averageAnnualizedVolatilityPct: hvs.length ? round(mean(hvs), 1) : null,
    fearGreed: fg ? { value: fg.value, classification: fg.classification } : null,
    derivatives: {
      BTCUSDT: btcDeriv.available ? { fundingRatePct: btcDeriv.fundingRate, openInterestChange24hPct: btcDeriv.openInterestChangePct, longShortRatio: btcDeriv.longShortRatio } : { unavailable: true },
      ETHUSDT: ethDeriv.available ? { fundingRatePct: ethDeriv.fundingRate, openInterestChange24hPct: ethDeriv.openInterestChangePct, longShortRatio: ethDeriv.longShortRatio } : { unavailable: true },
    },
    historicalSignalContext: {
      averageHistoricalPositiveRate: round(mean(techs.map((t) => t.historical.historicalPositiveRate).filter((v): v is number => v !== null)), 1),
      symbolsWithReliableSample: techs.filter((t) => t.historical.reliability === 'GOOD' || t.historical.reliability === 'MODERATE').length,
    },
  };

  const base = { condition, context, breadth, global, fearGreed: fg, source: marketData.source };
  const prev = await lastAi('MARKET', tf, 'MARKET');
  const fresh = prev && Date.now() - prev.timestamp.getTime() < env.AI_MARKET_SUMMARY_MINUTES * 60_000;
  const prevOut = prev ? { ...(prev.result as { summary: MarketSummary; warnings: string[] }), model: prev.model, generatedAt: prev.timestamp.toISOString() } : null;
  if (!force && fresh && prevOut) return { ...base, ai: { status: 'OK' as const, ...prevOut, cached: true, error: null } };
  if (!isAiConfigured() && !env.MOCK_MODE) return { ...base, ai: { status: 'NOT_CONFIGURED' as const, summary: null, warnings: [], model: null, generatedAt: null, cached: false, error: 'Analisa AI tidak tersedia: API key penyedia AI belum dikonfigurasi. Data teknikal pasar tetap tersedia.' } };
  if (!isAiConfigured() && env.MOCK_MODE) {
    const summary: MarketSummary = {
      marketCondition: condition, headline: '[MOCK] Market summary placeholder', summary: '[MOCK] MOCK_MODE aktif — tidak ada panggilan AI. Semua angka di dashboard berasal dari data sintetis.', btcTrend: '[MOCK]', altcoinTrend: '[MOCK]', breadth: `[MOCK] ${breadth.advancers} naik / ${breadth.decliners} turun`, volume: '[MOCK]', volatility: '[MOCK]', sentiment: '[MOCK]', derivatives: '[MOCK]', historicalContext: '[MOCK]', opportunities: [], risks: ['[MOCK] Data sintetis'], keyLevels: [], confidence: null, uncertainty: '[MOCK]',
    };
    return { ...base, ai: { status: 'OK' as const, summary, warnings: [], model: 'mock (MOCK_MODE)', generatedAt: new Date().toISOString(), cached: false, error: null } };
  }
  try {
    const r = await claude.summarizeMarket(context, force);
    const { summary, warnings } = enforceMarketConsistency(r.data, levels, condition);
    const now = new Date();
    if (isDbReady()) await getDb().insert(aiAnalysis).values({ symbol: 'MARKET', timeframe: tf, timestamp: now, kind: 'MARKET', model: r.model, status: 'OK', context, result: { summary, warnings } });
    return { ...base, ai: { status: 'OK' as const, summary, warnings, model: r.model, generatedAt: now.toISOString(), cached: r.cached, error: null } };
  } catch (e) {
    const msg = e instanceof ClaudeError ? `${e.code}: ${e.message}` : (e as Error).message;
    logger.warn({ err: msg }, 'AI market summary failed');
    if (isDbReady()) await getDb().insert(aiAnalysis).values({ symbol: 'MARKET', timeframe: tf, timestamp: new Date(), kind: 'MARKET', model: claude.modelName, status: 'UNAVAILABLE', context, error: msg });
    return {
      ...base,
      ai: { status: 'UNAVAILABLE' as const, summary: prevOut?.summary ?? null, warnings: prevOut?.warnings ?? [], model: prevOut?.model ?? null, generatedAt: prevOut?.generatedAt ?? null, cached: true, error: 'Analisa AI sementara tidak tersedia. Data teknikal pasar tetap tersedia.', lastSuccessfulAt: prevOut?.generatedAt ?? null },
    };
  }
}

export function aiStatus() {
  return { configured: isAiConfigured(), model: claude.modelName, mock: env.MOCK_MODE && !isAiConfigured(), status: getStatus('claude') };
}

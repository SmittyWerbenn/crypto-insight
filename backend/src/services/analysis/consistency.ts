import type { CoinAnalysis, MarketSummary } from '../claude/schemas.js';
import type { TechnicalAnalysis } from './technical-analysis.js';

const close = (a: number | null | undefined, b: number | null | undefined, tol = 1e-6) =>
  a === b || (a != null && b != null && Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 1e-4));

/** Some models answer confidence on a 0-1 scale despite the prompt; the app uses 0-100. */
export const normalizeConfidence = (c: number | null) => (c !== null && c > 0 && c <= 1 ? Math.round(c * 100) : c);

/**
 * Claude may interpret but never originate numbers. Any backend-owned value that differs is
 * replaced with the backend value and reported, and confidence is capped when data is weak.
 */
export function enforceCoinConsistency(ai: CoinAnalysis, t: TechnicalAnalysis): { analysis: CoinAnalysis; warnings: string[] } {
  const warnings: string[] = [];
  const out: CoinAnalysis = structuredClone(ai);
  out.confidence = normalizeConfidence(out.confidence);
  if (out.signal !== t.signal) {
    warnings.push(`AI signal ${out.signal} replaced with engine signal ${t.signal}`);
    out.signal = t.signal;
  }
  if (!close(out.technicalScore, t.technicalScore)) {
    warnings.push('AI technicalScore replaced with engine value');
    out.technicalScore = t.technicalScore;
  }
  const h = t.historical;
  const f24 = h.forward.find((x) => x.hours === 24)?.median ?? null;
  const f48 = h.forward.find((x) => x.hours === 48)?.median ?? null;
  const hc = { sampleSize: h.sampleSize, positiveRate: h.historicalPositiveRate, medianReturn24h: f24, medianReturn48h: f48 };
  if (
    out.historicalContext.sampleSize !== hc.sampleSize ||
    !close(out.historicalContext.positiveRate, hc.positiveRate) ||
    !close(out.historicalContext.medianReturn24h, hc.medianReturn24h) ||
    !close(out.historicalContext.medianReturn48h, hc.medianReturn48h)
  ) {
    warnings.push('AI historicalContext replaced with engine statistics');
  }
  out.historicalContext = hc;
  if (t.scenarios) {
    const s = t.scenarios;
    if (
      !close(out.scenario.bullish.target, s.bullish.target) ||
      !close(out.scenario.bearish.target, s.bearish.target) ||
      !close(out.scenario.base.low, s.base.low) ||
      !close(out.scenario.base.high, s.base.high)
    )
      warnings.push('AI scenario levels replaced with engine levels');
    out.scenario = {
      bullish: { target: s.bullish.target, potential: s.bullish.potential, explanation: out.scenario.bullish.explanation },
      base: { low: s.base.low, high: s.base.high, explanation: out.scenario.base.explanation },
      bearish: { target: s.bearish.target, potential: s.bearish.potential, explanation: out.scenario.bearish.explanation },
    };
  }
  // Confidence caps: incomplete indicators or weak historical evidence
  const cap = t.dataCompleteness < 0.8 ? null : t.dataCompleteness < 1 ? 50 : h.reliability === 'INSUFFICIENT' ? 50 : h.reliability === 'LIMITED' ? 65 : 100;
  if (cap === null) {
    if (out.confidence !== null) warnings.push('Confidence set to N/A due to incomplete data');
    out.confidence = null;
  } else if (out.confidence !== null && out.confidence > cap) {
    warnings.push(`Confidence capped at ${cap} (data completeness / sample size)`);
    out.confidence = cap;
  }
  return { analysis: out, warnings };
}

export function enforceMarketConsistency(ai: MarketSummary, allowedLevels: Map<string, { support: number | null; resistance: number | null }>, condition: MarketSummary['marketCondition']) {
  const warnings: string[] = [];
  const out = structuredClone(ai);
  out.confidence = normalizeConfidence(out.confidence);
  if (out.marketCondition !== condition) {
    warnings.push(`AI market condition ${out.marketCondition} replaced with engine condition ${condition}`);
    out.marketCondition = condition;
  }
  out.keyLevels = out.keyLevels
    .filter((k) => allowedLevels.has(k.symbol))
    .map((k) => {
      const ref = allowedLevels.get(k.symbol)!;
      if (!close(k.support, ref.support) || !close(k.resistance, ref.resistance)) warnings.push(`Key levels for ${k.symbol} replaced with engine levels`);
      return { symbol: k.symbol, support: ref.support, resistance: ref.resistance };
    });
  return { summary: out, warnings };
}

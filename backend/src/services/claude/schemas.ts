import { z } from 'zod';

export const MARKET_CONDITIONS = ['BULLISH_STRONG', 'BULLISH_MODERATE', 'NEUTRAL', 'BEARISH_MODERATE', 'BEARISH_STRONG'] as const;
export const SIGNALS = ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'] as const;

const nnum = z.number().nullable();

export const CoinAnalysisSchema = z.object({
  marketCondition: z.enum(MARKET_CONDITIONS),
  signal: z.enum(SIGNALS),
  technicalScore: z.number().min(0).max(100),
  /** Confidence in the quality/consistency of the setup given available data. NOT a probability of profit. */
  confidence: z.number().min(0).max(100).nullable(),
  confidenceRationale: z.string().min(1),
  summary: z.string().min(1),
  observedFacts: z.array(z.string()).min(1),
  technicalInterpretation: z.string().min(1),
  historicalEvidence: z.string().min(1),
  reasons: z.array(z.string()).min(1),
  risks: z.array(z.string()).min(1),
  uncertainty: z.string().min(1),
  historicalContext: z.object({
    sampleSize: z.number().int().min(0),
    positiveRate: nnum,
    medianReturn24h: nnum,
    medianReturn48h: nnum,
  }),
  scenario: z.object({
    bullish: z.object({ target: z.number(), potential: z.number(), explanation: z.string() }),
    base: z.object({ low: z.number(), high: z.number(), explanation: z.string() }),
    bearish: z.object({ target: z.number(), potential: z.number(), explanation: z.string() }),
  }),
});
export type CoinAnalysis = z.infer<typeof CoinAnalysisSchema>;

export const MarketSummarySchema = z.object({
  marketCondition: z.enum(MARKET_CONDITIONS),
  headline: z.string().min(1),
  summary: z.string().min(1),
  btcTrend: z.string().min(1),
  altcoinTrend: z.string().min(1),
  breadth: z.string().min(1),
  volume: z.string().min(1),
  volatility: z.string().min(1),
  sentiment: z.string().min(1),
  derivatives: z.string().min(1),
  historicalContext: z.string().min(1),
  opportunities: z.array(z.string()),
  risks: z.array(z.string()).min(1),
  keyLevels: z.array(z.object({ symbol: z.string(), support: nnum, resistance: nnum })),
  confidence: z.number().min(0).max(100).nullable(),
  uncertainty: z.string().min(1),
});
export type MarketSummary = z.infer<typeof MarketSummarySchema>;

/* JSON Schemas for Claude structured outputs (kept in sync with the Zod schemas above). */
const str = { type: 'string' };
const num = { type: 'number' };
const nullableNum = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const strArr = { type: 'array', items: str };
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const CoinAnalysisJsonSchema = obj({
  marketCondition: { type: 'string', enum: [...MARKET_CONDITIONS] },
  signal: { type: 'string', enum: [...SIGNALS] },
  technicalScore: num,
  confidence: nullableNum,
  confidenceRationale: str,
  summary: str,
  observedFacts: strArr,
  technicalInterpretation: str,
  historicalEvidence: str,
  reasons: strArr,
  risks: strArr,
  uncertainty: str,
  historicalContext: obj({ sampleSize: { type: 'integer' }, positiveRate: nullableNum, medianReturn24h: nullableNum, medianReturn48h: nullableNum }),
  scenario: obj({
    bullish: obj({ target: num, potential: num, explanation: str }),
    base: obj({ low: num, high: num, explanation: str }),
    bearish: obj({ target: num, potential: num, explanation: str }),
  }),
});

export const MarketSummaryJsonSchema = obj({
  marketCondition: { type: 'string', enum: [...MARKET_CONDITIONS] },
  headline: str,
  summary: str,
  btcTrend: str,
  altcoinTrend: str,
  breadth: str,
  volume: str,
  volatility: str,
  sentiment: str,
  derivatives: str,
  historicalContext: str,
  opportunities: strArr,
  risks: strArr,
  keyLevels: { type: 'array', items: obj({ symbol: str, support: nullableNum, resistance: nullableNum }) },
  confidence: nullableNum,
  uncertainty: str,
});

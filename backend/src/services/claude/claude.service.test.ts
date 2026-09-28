import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeError, ClaudeService, type ClaudeTransport } from './claude.service.js';
import type { CoinAnalysis } from './schemas.js';
import { enforceCoinConsistency, normalizeConfidence } from '../analysis/consistency.js';
import { analyzeCandles } from '../analysis/technical-analysis.js';
import { randomWalk } from '../../test-utils/candles.js';

const valid: CoinAnalysis = {
  marketCondition: 'BULLISH_MODERATE',
  signal: 'BUY',
  technicalScore: 78,
  confidence: 72,
  confidenceRationale: 'Indicators agree; sample adequate.',
  summary: 'Momentum positif moderat.',
  observedFacts: ['Price above MA20'],
  technicalInterpretation: 'Trend naik.',
  historicalEvidence: '124 setup serupa.',
  reasons: ['MACD bullish'],
  risks: ['RSI mendekati overbought'],
  uncertainty: 'Volatilitas tinggi.',
  historicalContext: { sampleSize: 124, positiveRate: 62.1, medianReturn24h: 4.1, medianReturn48h: 5.2 },
  scenario: {
    bullish: { target: 70100, potential: 7.3, explanation: 'Break resistance' },
    base: { low: 63500, high: 67000, explanation: 'Range' },
    bearish: { target: 60500, potential: -7.4, explanation: 'Break support' },
  },
};

const transport = (impl: ClaudeTransport['create']): ClaudeTransport => ({ create: vi.fn(impl) });
const reply = (text: string, stop = 'end_turn') => async () => ({ content: [{ type: 'text', text }], stop_reason: stop, model: 'claude-opus-5' });
const ctx = { symbol: 'BTCUSDT', timeframe: '4h', candleTime: Math.floor(Math.random() * 1e12) };

describe('ClaudeService', () => {
  it('parses a valid structured JSON response', async () => {
    const t = transport(reply(JSON.stringify(valid)));
    const svc = new ClaudeService(t, 'claude-opus-5');
    const r = await svc.analyzeCoin(ctx, { a: 1 });
    expect(r.data.signal).toBe('BUY');
    expect(r.cached).toBe(false);
    const params = (t.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, any>;
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.system).toMatch(/Never invent/);
  });

  it('does not call Claude twice for the same context', async () => {
    const t = transport(reply(JSON.stringify(valid)));
    const svc = new ClaudeService(t, 'claude-opus-5');
    const c = { ...ctx, candleTime: 12345 };
    await svc.analyzeCoin(c, { same: true });
    const second = await svc.analyzeCoin(c, { same: true });
    expect(second.cached).toBe(true);
    expect(t.create).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid JSON', async () => {
    const svc = new ClaudeService(transport(reply('{"marketCondition": "BULL')), 'claude-opus-5');
    await expect(svc.analyzeCoin({ ...ctx, candleTime: 1 }, { b: 1 })).rejects.toMatchObject({ code: 'INVALID_JSON' });
  });

  it('rejects responses with missing fields', async () => {
    const { risks: _r, scenario: _s, ...partial } = valid;
    const svc = new ClaudeService(transport(reply(JSON.stringify(partial))), 'claude-opus-5');
    const err = await svc.analyzeCoin({ ...ctx, candleTime: 2 }, { c: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeError);
    expect(err.code).toBe('SCHEMA_MISMATCH');
    expect(err.message).toMatch(/risks|scenario/);
  });

  it('maps API errors', async () => {
    const svc = new ClaudeService(
      transport(async () => {
        throw new Anthropic.InternalServerError(500, { type: 'error' }, 'boom', new Headers());
      }),
      'claude-opus-5',
    );
    await expect(svc.analyzeCoin({ ...ctx, candleTime: 3 }, { d: 1 })).rejects.toMatchObject({ code: 'API_ERROR' });
  });

  it('maps timeouts', async () => {
    const svc = new ClaudeService(
      transport(async () => {
        throw new Anthropic.APIConnectionTimeoutError();
      }),
      'claude-opus-5',
    );
    await expect(svc.analyzeCoin({ ...ctx, candleTime: 4 }, { e: 1 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('handles refusal and truncation stop reasons', async () => {
    const r1 = new ClaudeService(transport(reply('', 'refusal')), 'claude-opus-5');
    await expect(r1.analyzeCoin({ ...ctx, candleTime: 5 }, { f: 1 })).rejects.toMatchObject({ code: 'REFUSAL' });
    const r2 = new ClaudeService(transport(reply('{"a":', 'max_tokens')), 'claude-opus-5');
    await expect(r2.analyzeCoin({ ...ctx, candleTime: 6 }, { g: 1 })).rejects.toMatchObject({ code: 'TRUNCATED' });
  });

  it('reports NOT_CONFIGURED without an API key', async () => {
    const svc = new ClaudeService(null);
    await expect(svc.analyzeCoin({ ...ctx, candleTime: 7 }, {})).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});

describe('consistency enforcement', () => {
  it('replaces AI-invented numbers with engine values', () => {
    const t = analyzeCandles('TESTUSDT', '4h', randomWalk(600, 17, 0.002, 0.02).map((c, i) => ({ ...c, openTime: i * 14_400_000, closeTime: (i + 1) * 14_400_000 - 1 })));
    const { analysis, warnings } = enforceCoinConsistency({ ...valid, signal: 'STRONG_SELL', technicalScore: 3 }, t);
    expect(analysis.signal).toBe(t.signal);
    expect(analysis.technicalScore).toBe(t.technicalScore);
    expect(analysis.historicalContext.sampleSize).toBe(t.historical.sampleSize);
    expect(analysis.scenario.bullish.target).toBe(t.scenarios!.bullish.target);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('normalizes 0-1 confidence to 0-100', () => {
    expect(normalizeConfidence(0.7)).toBe(70);
    expect(normalizeConfidence(72)).toBe(72);
    expect(normalizeConfidence(0)).toBe(0);
    expect(normalizeConfidence(null)).toBeNull();
  });
});

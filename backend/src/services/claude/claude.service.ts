import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { markFailure, markSuccess } from '../binance/status.js';
import { cache } from '../cache/cache.js';
import { CoinAnalysisJsonSchema, CoinAnalysisSchema, MarketSummaryJsonSchema, MarketSummarySchema, type CoinAnalysis, type MarketSummary } from './schemas.js';
import { SYSTEM_PROMPT, coinUserPrompt, marketUserPrompt } from './prompts.js';

export type ClaudeErrorCode = 'NOT_CONFIGURED' | 'TIMEOUT' | 'RATE_LIMITED' | 'API_ERROR' | 'CONNECTION' | 'INVALID_JSON' | 'SCHEMA_MISMATCH' | 'REFUSAL' | 'TRUNCATED';

export class ClaudeError extends Error {
  constructor(
    public code: ClaudeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Minimal surface of the SDK we use — injectable for tests. */
export interface ClaudeTransport {
  create(params: Record<string, unknown>): Promise<{ content: { type: string; text?: string }[]; stop_reason: string | null; model: string; usage?: unknown }>;
}

function sdkTransport(): ClaudeTransport {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: env.ANTHROPIC_TIMEOUT_MS, maxRetries: 2 });
  return {
    create: (params) => client.beta.messages.create(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) as never,
  };
}

const supportsAdaptiveThinking = (m: string) => !/haiku|claude-3|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0/.test(m);
const supportsFallbacks = (m: string) => /^claude-(opus-5|fable-5|mythos-5)/.test(m);

export class ClaudeService {
  constructor(
    private transport: ClaudeTransport | null = env.ANTHROPIC_API_KEY ? sdkTransport() : null,
    private model = env.ANTHROPIC_MODEL,
  ) {}

  get configured() {
    return this.transport !== null;
  }

  get modelName() {
    return this.model;
  }

  private async call<T>(schema: z.ZodType<T>, jsonSchema: object, userPrompt: string): Promise<{ data: T; model: string }> {
    if (!this.transport) throw new ClaudeError('NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not configured');
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      output_config: { effort: env.ANTHROPIC_EFFORT, format: { type: 'json_schema', schema: jsonSchema } },
    };
    if (supportsAdaptiveThinking(this.model)) params.thinking = { type: 'adaptive' };
    if (env.ANTHROPIC_ENABLE_FALLBACKS && supportsFallbacks(this.model)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    let res: Awaited<ReturnType<ClaudeTransport['create']>>;
    try {
      res = await this.transport.create(params);
    } catch (e) {
      markFailure('claude', (e as Error).message);
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ClaudeError('TIMEOUT', 'Claude request timed out');
      if (e instanceof Anthropic.RateLimitError) throw new ClaudeError('RATE_LIMITED', 'Claude rate limit reached');
      if (e instanceof Anthropic.APIConnectionError) throw new ClaudeError('CONNECTION', 'Could not reach Claude API');
      if (e instanceof Anthropic.APIError) throw new ClaudeError('API_ERROR', `Claude API error ${e.status ?? ''}: ${e.message}`);
      if ((e as Error).name === 'AbortError' || /timed? ?out/i.test((e as Error).message)) throw new ClaudeError('TIMEOUT', 'Claude request timed out');
      throw new ClaudeError('API_ERROR', (e as Error).message);
    }
    if (res.stop_reason === 'refusal') throw new ClaudeError('REFUSAL', 'Claude declined to produce this analysis');
    if (res.stop_reason === 'max_tokens') throw new ClaudeError('TRUNCATED', 'Claude response was truncated');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      markFailure('claude', 'invalid JSON');
      throw new ClaudeError('INVALID_JSON', 'Claude returned invalid JSON');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      markFailure('claude', 'schema mismatch');
      logger.warn({ issues: parsed.error.issues.slice(0, 5) }, 'Claude response failed schema validation');
      throw new ClaudeError('SCHEMA_MISMATCH', `Claude response did not match schema: ${parsed.error.issues.map((i) => i.path.join('.')).slice(0, 5).join(', ')}`);
    }
    markSuccess('claude');
    return { data: parsed.data, model: res.model };
  }

  static hashContext(ctx: unknown): string {
    return createHash('sha256').update(JSON.stringify(ctx)).digest('hex').slice(0, 24);
  }

  /** Cached by (symbol, timeframe, candle time, context hash) — the same context never triggers a second call. */
  async analyzeCoin(ctx: { symbol: string; timeframe: string; candleTime: number }, full: unknown, force = false) {
    const key = `ai:coin:${ctx.symbol}:${ctx.timeframe}:${ctx.candleTime}:${ClaudeService.hashContext(full)}`;
    if (!force) {
      const hit = await cache.get<{ data: CoinAnalysis; model: string }>(key);
      if (hit) return { ...hit, cached: true };
    }
    const r = await this.call(CoinAnalysisSchema, CoinAnalysisJsonSchema, coinUserPrompt(full));
    await cache.set(key, r, env.AI_CACHE_TTL_SECONDS);
    return { ...r, cached: false };
  }

  async summarizeMarket(full: unknown, force = false) {
    const key = `ai:market:${ClaudeService.hashContext(full)}`;
    if (!force) {
      const hit = await cache.get<{ data: MarketSummary; model: string }>(key);
      if (hit) return { ...hit, cached: true };
    }
    const r = await this.call(MarketSummarySchema, MarketSummaryJsonSchema, marketUserPrompt(full));
    await cache.set(key, r, env.AI_CACHE_TTL_SECONDS);
    return { ...r, cached: false };
  }
}

export const claude = new ClaudeService();

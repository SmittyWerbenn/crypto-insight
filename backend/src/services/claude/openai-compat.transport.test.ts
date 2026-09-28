import { describe, expect, it, vi } from 'vitest';
import { ClaudeService } from './claude.service.js';
import { openAiCompatTransport, type CompatOptions } from './openai-compat.transport.js';

const summary = {
  marketCondition: 'NEUTRAL',
  headline: 'Pasar datar',
  summary: 'Ringkasan.',
  btcTrend: 'Sideways',
  altcoinTrend: 'Campuran',
  breadth: 'Seimbang',
  volume: 'Rendah',
  volatility: 'Sedang',
  sentiment: 'Netral',
  derivatives: 'Funding netral',
  historicalContext: 'Tidak ada',
  opportunities: [],
  risks: ['Volatilitas'],
  keyLevels: [{ symbol: 'BTCUSDT', support: 60000, resistance: null }],
  confidence: 50,
  uncertainty: 'Tinggi',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const completion = (content: string, finish = 'stop', extra: Record<string, unknown> = {}) => json({ model: 'gemini-test', choices: [{ message: { content, ...extra }, finish_reason: finish }] });

function setup(responses: Response[], opts: Partial<CompatOptions> = {}) {
  const fetchImpl = vi.fn(async () => responses.shift() ?? completion(''));
  const t = openAiCompatTransport({ baseUrl: 'https://ai.example/v1/', apiKey: 'k', jsonMode: 'json_schema', timeoutMs: 5000, fetchImpl: fetchImpl as unknown as typeof fetch, ...opts });
  return { svc: new ClaudeService(t, 'gemini-test'), fetchImpl };
}
const bodyOf = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse((f.mock.calls[i] as unknown as [string, RequestInit])[1].body as string);

describe('openAiCompatTransport', () => {
  it('sends a json_schema chat completion and parses the reply', async () => {
    const { svc, fetchImpl } = setup([completion(JSON.stringify(summary))], { reasoningEffort: 'low' });
    const r = await svc.summarizeMarket({ ctx: Math.random() }, true);
    expect(r.data.headline).toBe('Pasar datar');
    expect(r.model).toBe('gemini-test');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    const body = bodyOf(fetchImpl);
    expect(body.model).toBe('gemini-test');
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[0].content).toMatch(/Never invent/);
    expect(body.messages[1]).toMatchObject({ role: 'user' });
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema.required).toContain('headline');
    expect(body.reasoning_effort).toBe('low');
    expect(body.thinking).toBeUndefined();
  });

  it('puts the schema in the prompt in json_object mode', async () => {
    const { svc, fetchImpl } = setup([completion(JSON.stringify(summary))], { jsonMode: 'json_object' });
    await svc.summarizeMarket({ ctx: Math.random() }, true);
    const body = bodyOf(fetchImpl);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toMatch(/JSON Schema exactly/);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('retries 429 and 5xx, then succeeds', async () => {
    const { svc, fetchImpl } = setup([json({}, 429, { 'retry-after': '0.01' }), json({}, 503, { 'retry-after': '0.01' }), completion(JSON.stringify(summary))]);
    await svc.summarizeMarket({ ctx: Math.random() }, true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('maps errors, truncation and refusals', async () => {
    const quota = setup([json({ error: 'quota' }, 429)], { maxRetries: 0 });
    await expect(quota.svc.summarizeMarket({ a: Math.random() }, true)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const bad = setup([json({ error: { message: 'bad key' } }, 400)]);
    await expect(bad.svc.summarizeMarket({ a: Math.random() }, true)).rejects.toMatchObject({ code: 'API_ERROR', message: expect.stringMatching(/400.*bad key/) });
    const long = setup([completion('{"headline":', 'length')]);
    await expect(long.svc.summarizeMarket({ a: Math.random() }, true)).rejects.toMatchObject({ code: 'TRUNCATED' });
    const refused = setup([completion('', 'stop', { refusal: 'no' })]);
    await expect(refused.svc.summarizeMarket({ a: Math.random() }, true)).rejects.toMatchObject({ code: 'REFUSAL' });
    const invalid = setup([completion('not json')]);
    await expect(invalid.svc.summarizeMarket({ a: Math.random() }, true)).rejects.toMatchObject({ code: 'INVALID_JSON' });
  });

  it('retries a transient connection failure', async () => {
    let calls = 0;
    const flaky = (async () => {
      if (calls++ === 0) throw new TypeError('fetch failed');
      return completion(JSON.stringify(summary));
    }) as unknown as typeof fetch;
    const t = openAiCompatTransport({ baseUrl: 'https://x', apiKey: 'k', jsonMode: 'json_schema', timeoutMs: 5000, maxRetries: 1, fetchImpl: flaky });
    await new ClaudeService(t, 'm').summarizeMarket({ a: Math.random() }, true);
    expect(calls).toBe(2);
  });

  it('maps timeouts and connection failures', async () => {
    const timeout = openAiCompatTransport({ baseUrl: 'https://x', apiKey: 'k', jsonMode: 'json_schema', timeoutMs: 1, fetchImpl: (async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }) as typeof fetch });
    await expect(new ClaudeService(timeout, 'm').summarizeMarket({ a: Math.random() }, true)).rejects.toMatchObject({ code: 'TIMEOUT' });
    const down = openAiCompatTransport({ baseUrl: 'https://x', apiKey: 'k', jsonMode: 'json_schema', timeoutMs: 1, maxRetries: 0, fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    await expect(new ClaudeService(down, 'm').summarizeMarket({ a: Math.random() }, true)).rejects.toMatchObject({ code: 'CONNECTION' });
  });
});

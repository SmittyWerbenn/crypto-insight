/**
 * OpenAI-compatible chat-completions transport (Google Gemini, Groq, OpenRouter, ...).
 * Translates the Anthropic-shaped params built by ClaudeService and maps the reply back,
 * so parsing, schema validation, caching and consistency checks stay provider-independent.
 */
import { ClaudeError, type ClaudeTransport } from './errors.js';

export interface CompatOptions {
  baseUrl: string;
  apiKey: string;
  /** 'json_schema' = strict structured output; 'json_object' = JSON mode with the schema in the prompt (for providers without json_schema). */
  jsonMode: 'json_schema' | 'json_object';
  reasoningEffort?: string;
  timeoutMs: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: unknown;
}

const STOP_REASON: Record<string, string> = { length: 'max_tokens', content_filter: 'refusal' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function openAiCompatTransport(o: CompatOptions): ClaudeTransport {
  const doFetch = o.fetchImpl ?? fetch;
  const url = `${o.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const maxRetries = o.maxRetries ?? 2;

  return {
    async create(params) {
      const schema = (params.output_config as { format?: { schema?: object } } | undefined)?.format?.schema;
      let system = String(params.system ?? '');
      if (schema && o.jsonMode === 'json_object') system += `\n\nThe JSON must match this JSON Schema exactly:\n${JSON.stringify(schema)}`;
      const body: Record<string, unknown> = {
        model: params.model,
        max_tokens: params.max_tokens,
        messages: [{ role: 'system', content: system }, ...(params.messages as unknown[])],
        response_format: schema && o.jsonMode === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'analysis', strict: true, schema } } : { type: 'json_object' },
      };
      if (o.reasoningEffort) body.reasoning_effort = o.reasoningEffort;

      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await doFetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(o.timeoutMs),
          });
        } catch (e) {
          const name = (e as Error).name;
          if (name === 'TimeoutError' || name === 'AbortError') throw new ClaudeError('TIMEOUT', 'AI request timed out');
          throw new ClaudeError('CONNECTION', `Could not reach AI provider: ${(e as Error).message}`);
        }
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const retryAfter = Number(res.headers.get('retry-after'));
          await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt, 30_000));
          continue;
        }
        if (!res.ok) {
          const text = (await res.text().catch(() => '')).slice(0, 500);
          if (res.status === 429) throw new ClaudeError('RATE_LIMITED', `AI provider rate limit reached: ${text}`);
          throw new ClaudeError('API_ERROR', `AI provider error ${res.status}: ${text}`);
        }
        const data = (await res.json()) as ChatCompletion;
        const choice = data.choices?.[0];
        const stop = choice?.message?.refusal ? 'refusal' : (STOP_REASON[choice?.finish_reason ?? ''] ?? 'end_turn');
        return { content: [{ type: 'text', text: choice?.message?.content ?? '' }], stop_reason: stop, model: data.model ?? String(params.model), usage: data.usage };
      }
    },
  };
}

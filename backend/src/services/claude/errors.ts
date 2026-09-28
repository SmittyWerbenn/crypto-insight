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

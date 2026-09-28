export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
  }
}

/** fetch with timeout and JSON parsing. */
export async function fetchJson<T>(url: string, opts: { timeoutMs: number; headers?: Record<string, string> }): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json', ...(opts.headers ?? {}) } });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} for ${new URL(url).pathname}`, text.slice(0, 300));
    return JSON.parse(text) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new HttpError(0, `Request timed out after ${opts.timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

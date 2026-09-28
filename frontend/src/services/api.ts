export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Backend origin. Empty = same origin (Docker/nginx or Vite proxy). Set VITE_API_URL for GitHub Pages builds. */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');
const BASE = API_BASE;

export const apiUrl = (path: string) => `${BASE}${path}`;

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(BASE + path, {
    ...rest,
    headers: { accept: 'application/json', ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const details = body?.details;
    const msg = Array.isArray(details) && details.length ? `${body.message}: ${details.map((d: { path: string; message: string }) => `${d.path} ${d.message}`).join('; ')}` : (body?.message ?? `Request failed (${res.status})`);
    throw new ApiError(res.status, body?.error ?? 'ERROR', msg, body);
  }
  return body as T;
}

export const streamUrl = (kline?: string) => `${BASE}/api/stream${kline ? `?kline=${encodeURIComponent(kline)}` : ''}`;

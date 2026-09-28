import { useAuth } from '@/stores/auth';

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

/** For URLs the browser fetches itself (EventSource, download links), which cannot send an Authorization header. */
const withToken = (url: string) => {
  const token = useAuth.getState().token;
  return token ? `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}` : url;
};

export const apiUrl = (path: string) => withToken(`${BASE}${path}`);

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const token = useAuth.getState().token;
  const res = await fetch(BASE + path, {
    ...rest,
    headers: { accept: 'application/json', ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // Expired or revoked token: drop it so the app falls back to the login screen.
    if (res.status === 401 && body?.error === 'AUTH_REQUIRED' && token) useAuth.getState().setToken(null);
    const details = body?.details;
    const msg = Array.isArray(details) && details.length ? `${body.message}: ${details.map((d: { path: string; message: string }) => `${d.path} ${d.message}`).join('; ')}` : (body?.message ?? `Request failed (${res.status})`);
    throw new ApiError(res.status, body?.error ?? 'ERROR', msg, body);
  }
  return body as T;
}

export const streamUrl = (kline?: string) => withToken(`${BASE}/api/stream${kline ? `?kline=${encodeURIComponent(kline)}` : ''}`);

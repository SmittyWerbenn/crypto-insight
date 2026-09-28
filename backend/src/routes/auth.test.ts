/** Password auth (mock mode). APP_PASSWORD must be set before env.ts is first imported. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.APP_PASSWORD = 'correct horse battery staple';
const { buildApp } = await import('../app.js');
const { issueToken, verifyToken } = await import('../services/auth.js');

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => app.close());

const login = (password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });

describe('auth', () => {
  it('keeps health and session public', async () => {
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    const s = await app.inject('/api/auth/session');
    expect(s.json()).toEqual({ authRequired: true, authenticated: false });
  });

  it('rejects API calls without a valid token', async () => {
    const r = await app.inject('/api/status');
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('AUTH_REQUIRED');
    expect((await app.inject({ url: '/api/status', headers: { authorization: 'Bearer nope.nope' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/watchlist', payload: { symbol: 'BTCUSDT' } })).statusCode).toBe(401);
  });

  it('rejects a wrong password', async () => {
    const r = await login('wrong');
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('INVALID_PASSWORD');
  });

  it('issues a token that unlocks the API', async () => {
    const r = await login('correct horse battery staple');
    expect(r.statusCode).toBe(200);
    const { token, expiresAt } = r.json();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ url: '/api/status', headers })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/session', headers })).json().authenticated).toBe(true);
  });

  it('accepts ?access_token only on stream/export paths', async () => {
    const { token } = issueToken();
    expect((await app.inject(`/api/status?access_token=${token}`)).statusCode).toBe(401);
    expect((await app.inject(`/api/backtest/00000000-0000-4000-8000-000000000000/export?access_token=${token}`)).statusCode).toBe(404);
  });

  it('rejects expired and tampered tokens', () => {
    const { token } = issueToken(Date.now() - 1000 * 3_600_000);
    expect(verifyToken(token)).toBe(false);
    const fresh = issueToken().token;
    expect(verifyToken(fresh)).toBe(true);
    const [p, s] = fresh.split('.');
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 1e12 })).toString('base64url');
    expect(verifyToken(`${forged}.${s}`)).toBe(false);
    expect(verifyToken(`${p}.${s.slice(0, -2)}xx`)).toBe(false);
  });
});

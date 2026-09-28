/**
 * Single-user password auth with stateless HMAC-signed tokens.
 * The signing key is derived from APP_PASSWORD, so changing the password revokes every issued token.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export const isAuthEnabled = () => Boolean(env.APP_PASSWORD);

const sha256 = (v: string) => createHash('sha256').update(v).digest();
const signingKey = () => sha256(`cryptoinsight-auth:${env.APP_PASSWORD ?? ''}`);
const sign = (payload: string) => createHmac('sha256', signingKey()).update(payload).digest('base64url');

/** Constant-time comparison (hashing first makes the lengths equal). */
export function checkPassword(candidate: string): boolean {
  if (!env.APP_PASSWORD) return false;
  return timingSafeEqual(sha256(candidate), sha256(env.APP_PASSWORD));
}

export function issueToken(now = Date.now()): { token: string; expiresAt: string } {
  const exp = now + env.AUTH_TOKEN_TTL_HOURS * 3_600_000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(exp).toISOString() };
}

export function verifyToken(token: string | undefined, now = Date.now()): boolean {
  if (!token || !env.APP_PASSWORD) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: unknown };
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}

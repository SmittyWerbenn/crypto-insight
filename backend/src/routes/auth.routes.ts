import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { checkPassword, isAuthEnabled, issueToken, verifyToken } from '../services/auth.js';
import { AppError } from '../utils/errors.js';

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/session']);
// EventSource and <a download> cannot send headers, so these accept ?access_token=.
const QUERY_TOKEN_PATHS = [/^\/api\/stream$/, /^\/api\/backtest\/[^/]+\/export$/];

export function requestToken(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  const path = req.url.split('?')[0];
  if (QUERY_TOKEN_PATHS.some((r) => r.test(path))) {
    const t = (req.query as Record<string, unknown> | undefined)?.access_token;
    if (typeof t === 'string') return t;
  }
  return undefined;
}

/** Registered on the root instance (not as an encapsulated plugin) so the hook guards every route. */
export function registerAuth(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    if (!isAuthEnabled() || req.method === 'OPTIONS') return;
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || PUBLIC_PATHS.has(path)) return;
    if (!verifyToken(requestToken(req))) throw new AppError(401, 'AUTH_REQUIRED', 'Login required');
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    if (!isAuthEnabled()) throw new AppError(400, 'AUTH_DISABLED', 'Authentication is not configured on this server');
    const { password } = z.object({ password: z.string().min(1).max(512) }).parse(req.body);
    if (!checkPassword(password)) throw new AppError(401, 'INVALID_PASSWORD', 'Wrong password');
    return issueToken();
  });

  app.get('/api/auth/session', async (req) => ({
    authRequired: isAuthEnabled(),
    authenticated: isAuthEnabled() ? verifyToken(requestToken(req)) : true,
  }));
}

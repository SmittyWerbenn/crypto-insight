import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isDbReady } from '../db/client.js';
import { ALERT_TYPES, createAlert, deleteAlert, listAlerts } from '../services/alerts/alerts.service.js';
import { addToWatchlist, addTransaction, deleteTransaction, getPortfolio, getWatchlist, removeFromWatchlist } from '../services/portfolio/portfolio.service.js';
import { AppError } from '../utils/errors.js';
import { IdParam, SymbolParam } from '../utils/validation.js';

const symbol = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/, 'Invalid symbol');

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (/^\/api\/(watchlist|portfolio|alerts)/.test(req.url) && !isDbReady()) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Fitur ini membutuhkan database (DATABASE_URL).');
  });

  app.get('/api/watchlist', async () => getWatchlist());
  app.post('/api/watchlist', async (req, reply) => reply.status(201).send(await addToWatchlist(z.object({ symbol }).parse(req.body).symbol)));
  app.delete('/api/watchlist/:symbol', async (req, reply) => {
    await removeFromWatchlist(SymbolParam.parse(req.params).symbol);
    return reply.status(204).send();
  });

  app.get('/api/portfolio', async () => getPortfolio());
  app.post('/api/portfolio/transaction', async (req, reply) => {
    const body = z
      .object({
        symbol,
        side: z.enum(['BUY', 'SELL']).default('BUY'),
        quantity: z.number().positive().max(1e15),
        price: z.number().positive().max(1e12),
        executedAt: z.coerce.date().optional(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(req.body);
    return reply.status(201).send(await addTransaction(body));
  });
  app.delete('/api/portfolio/transaction/:id', async (req, reply) => {
    await deleteTransaction(IdParam.parse(req.params).id);
    return reply.status(204).send();
  });

  app.get('/api/alerts', async () => listAlerts());
  app.post('/api/alerts', async (req, reply) => {
    const body = z
      .object({ symbol, type: z.enum(ALERT_TYPES), value: z.number().finite().nullable().optional() })
      .refine((a) => a.type.startsWith('SIGNAL_') || typeof a.value === 'number', { message: 'nilai wajib diisi untuk jenis peringatan ini', path: ['value'] })
      .parse(req.body);
    return reply.status(201).send(await createAlert(body));
  });
  app.delete('/api/alerts/:id', async (req, reply) => {
    await deleteAlert(IdParam.parse(req.params).id);
    return reply.status(204).send();
  });
}

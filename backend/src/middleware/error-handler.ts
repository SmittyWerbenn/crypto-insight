import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { HttpError } from '../utils/http.js';
import { getStatus } from '../services/binance/status.js';
import { InvalidMarketDataError } from '../services/analysis/technical-analysis.js';
import { BacktestDataError } from '../services/backtest/backtest.service.js';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Permintaan tidak valid', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof AppError) return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    if (err instanceof InvalidMarketDataError) return reply.status(422).send({ error: 'INVALID_MARKET_DATA', message: err.message });
    if (err instanceof BacktestDataError) return reply.status(422).send({ error: 'BACKTEST_DATA', message: `Backtest tidak dapat diselesaikan. Alasan: ${err.message}` });
    if (err instanceof HttpError) {
      if (err.status === 400) return reply.status(400).send({ error: 'UPSTREAM_BAD_REQUEST', message: err.body ?? err.message });
      const s = getStatus('binance');
      return reply.status(503).send({ error: 'BINANCE_UNAVAILABLE', message: 'Data pasar Binance sementara tidak tersedia.', lastSuccessfulUpdate: s.lastSuccess });
    }
    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) return reply.status(fe.statusCode).send({ error: fe.code ?? 'BAD_REQUEST', message: fe.message });
    req.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server' });
  });
}

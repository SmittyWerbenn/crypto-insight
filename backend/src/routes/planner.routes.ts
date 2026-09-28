import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildTradePlan } from '../services/planner/planner.service.js';

const PlannerSchema = z.object({
  capital: z.number().positive().max(1e10),
  risk: z.enum(['konservatif', 'moderat', 'agresif']).default('moderat'),
  timeframe: z.enum(['1h', '4h', '1d']).default('4h'),
  maxPositions: z.number().int().min(1).max(10).default(3),
  fee: z.number().min(0).max(0.05).default(0.001),
  slippage: z.number().min(0).max(0.05).default(0.0005),
  universe: z.enum(['tracked', 'top']).default('top'),
});

export async function plannerRoutes(app: FastifyInstance) {
  app.post('/api/planner', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => buildTradePlan(PlannerSchema.parse(req.body)));
}

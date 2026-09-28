import { z } from 'zod';
import { BACKTEST_TIMEFRAMES } from '../../config/timeframes.js';

const symbol = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/, 'Invalid symbol');
const tf = z
  .string()
  .transform((v) => (v === '1D' ? '1d' : v))
  .pipe(z.enum(BACKTEST_TIMEFRAMES as [string, ...string[]]));
const range = z.object({ min: z.number(), max: z.number(), step: z.number().positive() });

export const BacktestRequestSchema = z
  .object({
    symbol,
    timeframe: tf,
    strategy: z.string().min(1).max(64).default('ma-rsi-macd'),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    initialCapital: z.number().positive().max(1e12).default(10_000),
    positionSize: z.number().gt(0).max(1).default(0.1),
    stopLoss: z.number().min(0).max(0.95).optional(),
    takeProfit: z.number().min(0).max(10).optional(),
    fee: z.number().min(0).max(0.05).default(0.001),
    slippage: z.number().min(0).max(0.05).default(0.0005),
    params: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
    mode: z.enum(['standard', 'walk-forward', 'out-of-sample', 'optimization', 'matrix']).default('standard'),
    walkForward: z.object({ trainDays: z.number().int().min(7).max(1000).default(90), testDays: z.number().int().min(3).max(365).default(30) }).optional(),
    outOfSample: z.object({ splitRatio: z.number().min(0.5).max(0.9).default(0.7) }).optional(),
    optimization: z
      .object({
        ranges: z.record(z.string(), range).refine((r) => Object.keys(r).length <= 6, 'At most 6 parameters'),
        objective: z.enum(['sharpe', 'roi', 'profitFactor']).default('sharpe'),
        maxCombinations: z.number().int().min(1).max(500).default(100),
        minTrades: z.number().int().min(1).max(1000).default(5),
      })
      .optional(),
    matrix: z.object({ symbols: z.array(symbol).min(1).max(10), timeframes: z.array(tf).min(1).max(4) }).optional(),
    monteCarlo: z.object({ iterations: z.number().int().min(100).max(10_000).default(1000), drawdownThreshold: z.number().min(1).max(95).default(20) }).optional(),
  })
  .refine((r) => r.endDate > r.startDate, { message: 'endDate must be after startDate', path: ['endDate'] })
  .refine((r) => r.endDate.getTime() - r.startDate.getTime() <= 5 * 366 * 86_400_000, { message: 'Maximum period is 5 years', path: ['startDate'] })
  .refine((r) => r.mode !== 'optimization' || r.optimization, { message: 'optimization settings required', path: ['optimization'] })
  .refine((r) => r.mode !== 'matrix' || r.matrix, { message: 'matrix settings required', path: ['matrix'] });

export type BacktestRequest = z.infer<typeof BacktestRequestSchema>;

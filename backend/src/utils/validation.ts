import { z } from 'zod';
import { TIMEFRAMES, normalizeTimeframe } from '../config/timeframes.js';

export const SymbolParam = z.object({ symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/, 'Invalid symbol') });
export const TimeframeSchema = z
  .string()
  .refine((v) => {
    try {
      normalizeTimeframe(v);
      return true;
    } catch {
      return false;
    }
  }, `Timeframe must be one of ${TIMEFRAMES.join(', ')}`)
  .transform((v) => normalizeTimeframe(v));
export const IdParam = z.object({ id: z.string().uuid() });

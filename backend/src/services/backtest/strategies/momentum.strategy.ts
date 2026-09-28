import type { Candle } from '../../../types/market.js';
import type { StrategyAction, StrategyContext } from '../types.js';
import { BaseStrategy, NONE } from './base.strategy.js';

/** Momentum: RSI crosses above 50 with positive ROC and StochRSI K > D. */
export class MomentumStrategy extends BaseStrategy {
  id = 'momentum';
  name = 'Momentum (RSI cross + ROC + StochRSI)';
  description = 'Enter when RSI crosses above 50, ROC > threshold and StochRSI K > D. Exit when RSI < exit level or ROC turns negative.';
  defaultParams = { rocMin: 0, rsiExit: 45 };

  evaluate(_c: Candle, ctx: StrategyContext): StrategyAction {
    if (ctx.index < 1) return NONE;
    const s = ctx.snapshot();
    const p = ctx.snapshot(1);
    if (s.rsi === null || p.rsi === null || s.roc === null) return NONE;
    if (!ctx.inPosition) {
      const ok = p.rsi <= 50 && s.rsi > 50 && s.roc > this.num(ctx, 'rocMin') && s.stochRsiK !== null && s.stochRsiD !== null && s.stochRsiK > s.stochRsiD;
      return ok ? { action: 'ENTER_LONG', reason: `RSI crossed 50 (${s.rsi.toFixed(1)}), ROC ${s.roc.toFixed(2)}%` } : NONE;
    }
    if (s.rsi < this.num(ctx, 'rsiExit')) return { action: 'EXIT', reason: `RSI ${s.rsi.toFixed(1)} < ${this.num(ctx, 'rsiExit')}` };
    if (s.roc < 0) return { action: 'EXIT', reason: 'ROC turned negative' };
    return NONE;
  }
}

import type { Candle } from '../../../types/market.js';
import type { StrategyAction, StrategyContext } from '../types.js';
import { BaseStrategy, NONE } from './base.strategy.js';

/** Trend following: EMA20 > EMA50, price above MA200, ADX confirms trend, range breakout entry. */
export class TrendFollowingStrategy extends BaseStrategy {
  id = 'trend-following';
  name = 'Trend Following (EMA + ADX + Breakout)';
  description = 'Enter on a 20-candle breakout while EMA20 > EMA50, price > MA200 and ADX ≥ threshold. Exit when price closes below EMA50 or EMA20 crosses below EMA50.';
  defaultParams = { adxMin: 20, requireBreakout: true };

  evaluate(_c: Candle, ctx: StrategyContext): StrategyAction {
    const s = ctx.snapshot();
    if (s.ema20 === null || s.ema50 === null) return NONE;
    if (!ctx.inPosition) {
      if (s.sma200 === null || s.adx === null) return NONE;
      const ok =
        s.ema20 > s.ema50 &&
        s.price > s.sma200 &&
        s.adx >= this.num(ctx, 'adxMin') &&
        (!this.bool(ctx, 'requireBreakout') || s.priceAction.breakout);
      return ok ? { action: 'ENTER_LONG', reason: `Trend breakout, ADX ${s.adx.toFixed(1)}` } : NONE;
    }
    if (s.price < s.ema50) return { action: 'EXIT', reason: 'Close below EMA50' };
    if (s.ema20 < s.ema50) return { action: 'EXIT', reason: 'EMA20 crossed below EMA50' };
    return NONE;
  }
}

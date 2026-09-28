import type { Candle } from '../../../types/market.js';
import type { Strategy, StrategyAction, StrategyContext, StrategyParams } from '../types.js';

export abstract class BaseStrategy implements Strategy {
  abstract id: string;
  abstract name: string;
  abstract description: string;
  abstract defaultParams: StrategyParams;
  indicatorParamKeys: string[] = [];

  abstract evaluate(candle: Candle, ctx: StrategyContext): StrategyAction;

  protected num(ctx: StrategyContext, key: string): number {
    const v = ctx.params[key] ?? this.defaultParams[key];
    return Number(v);
  }

  protected bool(ctx: StrategyContext, key: string): boolean {
    const v = ctx.params[key] ?? this.defaultParams[key];
    return Boolean(v);
  }
}

export const NONE: StrategyAction = { action: 'NONE' };

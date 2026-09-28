import type { Candle } from '../../../types/market.js';
import type { StrategyAction, StrategyContext } from '../types.js';
import { BaseStrategy, NONE } from './base.strategy.js';

/**
 * CryptoInsight AI Technical Strategy: MA + RSI + MACD + Volume, gated by the technical score.
 */
export class MaRsiMacdStrategy extends BaseStrategy {
  id = 'ma-rsi-macd';
  name = 'CryptoInsight AI Technical Strategy (MA + RSI + MACD + Volume)';
  description = 'Enter when price > MA fast > MA slow, MACD bullish, RSI in range, volume above average and score ≥ entry threshold. Exit on score < exit threshold or bearish MACD crossover.';
  defaultParams = {
    maFast: 20,
    maSlow: 50,
    rsiMin: 50,
    rsiMax: 70,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    volumeMultiplier: 1,
    entryScore: 65,
    exitScore: 45,
    exitOnMacdCross: true,
  };
  indicatorParamKeys = ['maFast', 'maSlow', 'macdFast', 'macdSlow', 'macdSignal'];

  evaluate(_c: Candle, ctx: StrategyContext): StrategyAction {
    const s = ctx.snapshot();
    const score = ctx.score().score;
    if (!ctx.inPosition) {
      if (s.sma20 === null || s.sma50 === null || s.rsi === null || s.macdHistogram === null || s.volumeRatio === null) return NONE;
      const ok =
        s.price > s.sma20 &&
        s.sma20 > s.sma50 &&
        s.macdHistogram > 0 &&
        s.rsi >= this.num(ctx, 'rsiMin') &&
        s.rsi <= this.num(ctx, 'rsiMax') &&
        s.volumeRatio > this.num(ctx, 'volumeMultiplier') &&
        score >= this.num(ctx, 'entryScore');
      return ok ? { action: 'ENTER_LONG', reason: `Score ${score}, RSI ${s.rsi.toFixed(1)}, MACD bullish, volume ${s.volumeRatio.toFixed(2)}x` } : NONE;
    }
    if (score < this.num(ctx, 'exitScore')) return { action: 'EXIT', reason: `Technical score ${score} < ${this.num(ctx, 'exitScore')}` };
    if (this.bool(ctx, 'exitOnMacdCross') && s.macdState === 'bearish_cross') return { action: 'EXIT', reason: 'Bearish MACD crossover' };
    return NONE;
  }
}

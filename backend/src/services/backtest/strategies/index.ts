import type { Strategy } from '../types.js';
import { MaRsiMacdStrategy } from './ma-rsi-macd.strategy.js';
import { MomentumStrategy } from './momentum.strategy.js';
import { TrendFollowingStrategy } from './trend-following.strategy.js';

const registry = new Map<string, Strategy>(
  [new MaRsiMacdStrategy(), new TrendFollowingStrategy(), new MomentumStrategy()].map((s) => [s.id, s]),
);

/** Register an additional strategy (used by tests and plugins). */
export function registerStrategy(s: Strategy): void {
  registry.set(s.id, s);
}

export function getStrategy(id: string): Strategy {
  const s = registry.get(id);
  if (!s) throw new Error(`Unknown strategy: ${id}`);
  return s;
}

export function listStrategies() {
  return [...registry.values()].map((s) => ({ id: s.id, name: s.name, description: s.description, defaultParams: s.defaultParams }));
}

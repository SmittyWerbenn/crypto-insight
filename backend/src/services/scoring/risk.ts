import type { TechnicalSnapshot } from '../technical/engine.js';

export type RiskLevel = 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH';

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

/** Risk from volatility (ATR% and annualized HV), RSI extremes and extension from MA20. */
export function assessRisk(s: TechnicalSnapshot): RiskAssessment {
  let pts = 0;
  const reasons: string[] = [];
  const hv = s.historicalVolatility;
  if (hv !== null) {
    if (hv > 90) {
      pts += 3;
      reasons.push(`High annualized volatility (${hv.toFixed(0)}%)`);
    } else if (hv > 60) pts += 2;
    else if (hv > 40) pts += 1;
  }
  if (s.rsi !== null && (s.rsi > 75 || s.rsi < 25)) {
    pts += 1;
    reasons.push(`RSI at extreme (${s.rsi.toFixed(1)})`);
  }
  if (s.atr !== null && s.sma20 !== null && Math.abs(s.price - s.sma20) > 2 * s.atr) {
    pts += 1;
    reasons.push('Price extended >2 ATR from MA20');
  }
  if (s.priceAction.breakdown) {
    pts += 1;
    reasons.push('Recent breakdown below range');
  }
  const level: RiskLevel = pts >= 4 ? 'HIGH' : pts >= 3 ? 'MEDIUM' : pts >= 2 ? 'LOW_MEDIUM' : 'LOW';
  return { level, reasons };
}

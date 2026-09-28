import type { Candle } from '../../types/market.js';

export type SignalStatus = 'PENDING' | 'OPEN' | 'TARGET_HIT' | 'STOP_HIT' | 'TIMEOUT' | 'INVALIDATED' | 'AMBIGUOUS';
export const FINAL_STATUSES: SignalStatus[] = ['TARGET_HIT', 'STOP_HIT', 'TIMEOUT', 'INVALIDATED', 'AMBIGUOUS'];

export interface TrackedSignal {
  direction: 'LONG' | 'SHORT_OR_REDUCE';
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  /** Open time of the signal candle; evaluation starts on the next candle. */
  candleTime: number;
}

export interface OutcomeResult {
  status: SignalStatus;
  exitPrice: number | null;
  exitTime: number | null;
  returnPercent: number | null;
  mfe: number;
  mae: number;
  candlesEvaluated: number;
  note: string | null;
}

/**
 * Outcome definitions:
 *   TARGET_HIT  – target reached before stop
 *   STOP_HIT    – stop reached before target
 *   TIMEOUT     – neither within `window` candles; exit at last close
 *   AMBIGUOUS   – both inside one candle and lower-timeframe data could not order them
 *                 (excluded from win/loss statistics)
 *   OPEN        – still running
 * Returns are expressed from the signal direction's point of view (a SELL that falls is positive).
 */
export function evaluateOutcome(
  sig: TrackedSignal,
  candlesAfter: Candle[],
  window: number,
  resolve?: (c: Candle) => 'TARGET' | 'STOP' | null,
): OutcomeResult {
  const long = sig.direction === 'LONG';
  const dirRet = (px: number) => ((long ? px - sig.entryPrice : sig.entryPrice - px) / sig.entryPrice) * 100;
  let mfe = 0;
  let mae = 0;
  const cs = candlesAfter.filter((c) => c.openTime > sig.candleTime).slice(0, window);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const fav = long ? c.high : c.low;
    const adv = long ? c.low : c.high;
    const hitTarget = long ? c.high >= sig.targetPrice : c.low <= sig.targetPrice;
    const hitStop = long ? c.low <= sig.stopPrice : c.high >= sig.stopPrice;
    const base = { candlesEvaluated: i + 1 };
    if (hitTarget && hitStop) {
      const r = resolve?.(c) ?? null;
      if (r === null) {
        return { ...base, status: 'AMBIGUOUS', exitPrice: null, exitTime: c.openTime, returnPercent: null, mfe: Math.max(mfe, dirRet(sig.targetPrice)), mae: Math.min(mae, dirRet(sig.stopPrice)), note: 'Target dan stop tersentuh dalam candle yang sama; urutannya tidak dapat ditentukan dari data timeframe lebih kecil.' };
      }
      const px = r === 'TARGET' ? sig.targetPrice : sig.stopPrice;
      return { ...base, status: r === 'TARGET' ? 'TARGET_HIT' : 'STOP_HIT', exitPrice: px, exitTime: c.openTime, returnPercent: dirRet(px), mfe: Math.max(mfe, dirRet(sig.targetPrice)), mae: Math.min(mae, r === 'STOP' ? dirRet(sig.stopPrice) : dirRet(adv)), note: 'Ditentukan dengan candle timeframe lebih kecil.' };
    }
    if (hitStop) return { ...base, status: 'STOP_HIT', exitPrice: sig.stopPrice, exitTime: c.openTime, returnPercent: dirRet(sig.stopPrice), mfe: Math.max(mfe, dirRet(fav)), mae: Math.min(mae, dirRet(sig.stopPrice)), note: null };
    if (hitTarget) return { ...base, status: 'TARGET_HIT', exitPrice: sig.targetPrice, exitTime: c.openTime, returnPercent: dirRet(sig.targetPrice), mfe: Math.max(mfe, dirRet(sig.targetPrice)), mae: Math.min(mae, dirRet(adv)), note: null };
    mfe = Math.max(mfe, dirRet(fav));
    mae = Math.min(mae, dirRet(adv));
  }
  if (cs.length >= window) {
    const last = cs[cs.length - 1];
    return { status: 'TIMEOUT', exitPrice: last.close, exitTime: last.closeTime, returnPercent: dirRet(last.close), mfe, mae, candlesEvaluated: cs.length, note: `Target/stop tidak tercapai dalam ${window} candle` };
  }
  return { status: cs.length ? 'OPEN' : 'PENDING', exitPrice: null, exitTime: null, returnPercent: null, mfe, mae, candlesEvaluated: cs.length, note: null };
}

/** Walk lower-timeframe candles inside a parent candle to see which level was touched first. */
export function resolveWithLowerTimeframe(lower: Candle[], direction: TrackedSignal['direction'], target: number, stop: number): 'TARGET' | 'STOP' | null {
  const long = direction === 'LONG';
  for (const c of lower) {
    const t = long ? c.high >= target : c.low <= target;
    const s = long ? c.low <= stop : c.high >= stop;
    if (t && s) return null;
    if (t) return 'TARGET';
    if (s) return 'STOP';
  }
  return null;
}

export function isSuccess(status: SignalStatus, ret: number | null): boolean | null {
  if (status === 'TARGET_HIT') return true;
  if (status === 'STOP_HIT') return false;
  if (status === 'TIMEOUT' || status === 'INVALIDATED') return ret !== null ? ret > 0 : null;
  return null;
}

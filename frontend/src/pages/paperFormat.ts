/* Paper Trading is booked in Rupiah, independent of the display currency. */
export const fmtRp = (v: number | null | undefined, signed = false) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const s = v < 0 ? '-' : signed && v > 0 ? '+' : '';
  return `${s}Rp ${Math.abs(v).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
};
export const pct = (v: number | null | undefined, d = 1, signed = false) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${signed && v > 0 ? '+' : ''}${v.toFixed(d)}%`);
export const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink-2');
export const AXIS = { fontSize: 11, fill: '#8491a5' };

export type ProfileId = 'AMAN' | 'MENENGAH' | 'AGRESIF';
/** Fixed categorical order (validated palette: blue, orange, aqua); the entity keeps its color everywhere. */
export const PROFILES: { id: ProfileId; label: string; color: string; blurb: string }[] = [
  { id: 'AMAN', label: 'Aman', color: '#2a78d6', blurb: 'Filter ketat · sedikit trade · banyak cash · target dekat' },
  { id: 'MENENGAH', label: 'Menengah', color: '#eb6834', blurb: 'Filter sedang · trade sedang · exposure seimbang' },
  { id: 'AGRESIF', label: 'Agresif', color: '#1baf7a', blurb: 'Filter longgar · banyak trade · exposure tinggi · tetap ada risk control' },
];
export const PROFILE_LABEL: Record<ProfileId, string> = { AMAN: 'Aman', MENENGAH: 'Menengah', AGRESIF: 'Agresif' };

export const REJECT_LABEL: Record<string, string> = {
  BTC_BEAR: 'BTC Bear',
  BTC_NEUTRAL: 'BTC Neutral',
  COIN_REGIME: 'Regime koin tidak sesuai',
  VOLUME: 'Volume tidak cukup',
  MOMENTUM: 'Momentum lemah (EMA20 < EMA50)',
  BREAKOUT_WEAK: 'Breakout terlalu tipis',
  ATR_LOW: 'ATR terlalu kecil (target < biaya)',
  RISK_HIGH: 'Risk terlalu tinggi (ATR besar)',
  PRICE_MOVED: 'Harga sudah bergerak dari signal',
  HAS_POSITION: 'Sudah memiliki posisi',
  MAX_POSITIONS: 'Maksimum posisi tercapai',
  MAX_EXPOSURE: 'Maksimum exposure tercapai',
  CLUSTER: 'Correlated exposure terlalu tinggi',
  CASH: 'Cash tidak cukup',
  NO_PRICE: 'Harga live tidak tersedia',
};
/** Rule filters vs money-management caps — "filter too strict" vs "no room". */
export const MONEY_CODES = new Set(['PRICE_MOVED', 'HAS_POSITION', 'MAX_POSITIONS', 'MAX_EXPOSURE', 'CLUSTER', 'CASH', 'NO_PRICE']);

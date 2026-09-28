export const TZ = 'Asia/Jakarta';

/*
 * Display currency.
 * All market data from Binance (and every backend number) is in USDT. For display we convert
 * with a live USDT→IDR rate from the backend (/api/market/fx). The rate is kept in module state
 * so the plain formatter functions below can use it; `useFx` in stores/fx.ts keeps it in sync
 * and remounts the page when it changes.
 */
export type DisplayCurrency = 'IDR' | 'USD';

const fx = { currency: 'USD' as DisplayCurrency, rate: 1 };

export function setFxState(currency: DisplayCurrency, rate: number) {
  fx.currency = currency;
  fx.rate = currency === 'IDR' && rate > 0 ? rate : 1;
}

export const displayCurrency = () => fx.currency;
export const currencySymbol = () => (fx.currency === 'IDR' ? 'Rp' : '$');
/** USDT amount → display currency. */
export const toDisplay = (usdt: number) => usdt * fx.rate;
/** Display-currency amount (user input) → USDT for the backend. */
export const fromDisplay = (v: number) => v / fx.rate;

const locale = () => (fx.currency === 'IDR' ? 'id-ID' : 'en-US');

/** Price without currency symbol, converted to the display currency. */
export function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const x = toDisplay(v);
  const abs = Math.abs(x);
  if (fx.currency === 'IDR') {
    const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
    return x.toLocaleString('id-ID', { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits });
  }
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 8;
  return x.toLocaleString('en-US', { minimumFractionDigits: abs >= 1000 ? 2 : Math.min(2, digits), maximumFractionDigits: digits });
}

/** Price with currency symbol, e.g. "Rp 1.389.120.000" or "$84,824.01". */
export function fmtPriceSym(v: number | null | undefined): string {
  const p = fmtPrice(v);
  if (p === '–') return p;
  return fx.currency === 'IDR' ? `Rp ${p}` : `$${p}`;
}

/** Money amount (P&L, capital, fees) in the display currency. `digits` applies to USD; IDR uses whole rupiah. */
export function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const x = toDisplay(v);
  const sign = x < 0 ? '-' : '';
  if (fx.currency === 'IDR') return `${sign}Rp ${Math.abs(x).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
  return `${sign}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export const fmtMoney = fmtUsd;

/** Compact money: IDR uses Indonesian units (rb, jt, M = miliar, T = triliun). */
export function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const x = toDisplay(v);
  const a = Math.abs(x);
  const sign = x < 0 ? '-' : '';
  if (fx.currency === 'IDR') {
    const [d, s] = a >= 1e12 ? [1e12, ' T'] : a >= 1e9 ? [1e9, ' M'] : a >= 1e6 ? [1e6, ' jt'] : a >= 1e3 ? [1e3, ' rb'] : [1, ''];
    return `${sign}Rp ${(a / d).toLocaleString('id-ID', { maximumFractionDigits: 2 })}${s}`;
  }
  const [d, s] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  return `${sign}$${(a / d).toFixed(2)}${s}`;
}

export function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${signed && v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

/** Plain number (quantities, indicator values) — never currency-converted. */
export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return v.toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtDate(ts: number | string | Date | null | undefined, withTime = true): string {
  if (ts === null || ts === undefined) return '–';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: withTime ? undefined : 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(d) + (withTime ? ' WIB' : '');
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–';
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export const baseAsset = (s: string) => s.replace(/USDT$/, '');
export const toneOf = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down');

/** Date with year and time, for long histories. */
export function fmtDateTime(ts: number | string | Date | null | undefined): string {
  if (ts === null || ts === undefined) return '–';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

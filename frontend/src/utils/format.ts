export const TZ = 'Asia/Jakarta';

export function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: abs >= 1000 ? 2 : Math.min(2, digits), maximumFractionDigits: digits });
}

export function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtCompact(v: number | null | undefined, prefix = '$'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const [d, s] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  return `${v < 0 ? '-' : ''}${prefix}${(a / d).toFixed(a >= 1e3 ? 2 : 2)}${s}`;
}

export function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${signed && v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
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

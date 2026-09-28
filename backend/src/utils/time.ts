import { env } from '../config/env.js';

export function formatLocal(ts: number | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: env.APP_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(ts);
}

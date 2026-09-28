/** Tracks upstream health so the UI can show "Connected" / last successful update. */
export interface ServiceStatus {
  name: string;
  connected: boolean;
  lastSuccess: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

const statuses = new Map<string, ServiceStatus>();

function get(name: string): ServiceStatus {
  let s = statuses.get(name);
  if (!s) {
    s = { name, connected: false, lastSuccess: null, lastError: null, lastErrorAt: null };
    statuses.set(name, s);
  }
  return s;
}

export function markSuccess(name: string) {
  const s = get(name);
  s.connected = true;
  s.lastSuccess = new Date().toISOString();
}

export function markFailure(name: string, err: string) {
  const s = get(name);
  s.connected = false;
  s.lastError = err;
  s.lastErrorAt = new Date().toISOString();
}

export function getStatus(name: string): ServiceStatus {
  return { ...get(name) };
}

export function allStatuses(): ServiceStatus[] {
  return [...statuses.values()].map((s) => ({ ...s }));
}

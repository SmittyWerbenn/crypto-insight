import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from '@/services/api';
import { setFxState, type DisplayCurrency } from '@/utils/format';

export interface FxRate {
  base: 'USDT';
  quote: 'IDR';
  rate: number;
  source: string;
  updatedAt: number;
}

const readCurrency = (): DisplayCurrency => {
  try {
    return localStorage.getItem('ci.currency') === 'USD' ? 'USD' : 'IDR';
  } catch {
    return 'IDR';
  }
};

interface FxState {
  /** Preferred display currency (default Rupiah). */
  preferred: DisplayCurrency;
  /** Currency actually in use: falls back to USD when no IDR rate is available. */
  active: DisplayCurrency;
  rate: FxRate | null;
  error: boolean;
  setPreferred: (c: DisplayCurrency) => void;
}

function apply(preferred: DisplayCurrency, rate: FxRate | null): DisplayCurrency {
  const active: DisplayCurrency = preferred === 'IDR' && rate ? 'IDR' : 'USD';
  setFxState(active, rate?.rate ?? 1);
  return active;
}

export const useFx = create<FxState>((set, get) => ({
  preferred: readCurrency(),
  active: 'USD',
  rate: null,
  error: false,
  setPreferred: (preferred) => {
    try {
      localStorage.setItem('ci.currency', preferred);
    } catch {
      /* storage unavailable */
    }
    set({ preferred, active: apply(preferred, get().rate) });
  },
}));

/** Fetches USDT→IDR from the backend every 10 minutes and applies it to all formatters. */
export function useFxSync() {
  const q = useQuery({ queryKey: ['fx'], queryFn: () => api<FxRate>('/api/market/fx'), refetchInterval: 10 * 60_000, staleTime: 5 * 60_000, retry: 2 });
  useEffect(() => {
    const { preferred } = useFx.getState();
    if (q.data) useFx.setState({ rate: q.data, error: false, active: apply(preferred, q.data) });
    else if (q.error) useFx.setState({ error: true, active: apply(preferred, useFx.getState().rate) });
  }, [q.data, q.error]);
}

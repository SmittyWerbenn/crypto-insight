import { create } from 'zustand';

export interface LiveTicker {
  symbol: string;
  price: number;
  changePct: number;
  eventTime: number;
}

export interface AlertEvent {
  id: string;
  symbol: string;
  type: string;
  value: number | null;
  triggeredValue: number;
  at: number;
}

interface LiveState {
  connected: boolean;
  lastEvent: number | null;
  tickers: Record<string, LiveTicker>;
  notifications: (AlertEvent & { read: boolean })[];
  setConnected: (c: boolean) => void;
  pushTicker: (t: LiveTicker) => void;
  pushAlert: (a: AlertEvent) => void;
  markAllRead: () => void;
}

export const useLive = create<LiveState>((set) => ({
  connected: false,
  lastEvent: null,
  tickers: {},
  notifications: [],
  setConnected: (connected) => set({ connected }),
  pushTicker: (t) => set((s) => ({ tickers: { ...s.tickers, [t.symbol]: t }, lastEvent: Date.now() })),
  pushAlert: (a) => set((s) => ({ notifications: [{ ...a, read: false }, ...s.notifications].slice(0, 50) })),
  markAllRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
}));

interface UiState {
  timeframe: string;
  setTimeframe: (tf: string) => void;
}

const readTf = () => {
  try {
    return localStorage.getItem('ci.timeframe') ?? '4h';
  } catch {
    return '4h';
  }
};

export const useUi = create<UiState>((set) => ({
  timeframe: readTf(),
  setTimeframe: (timeframe) => {
    try {
      localStorage.setItem('ci.timeframe', timeframe);
    } catch {
      /* storage unavailable */
    }
    set({ timeframe });
  },
}));

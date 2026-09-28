import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type {
  AppConfig,
  BacktestJob,
  BacktestMetrics,
  Candle,
  CoinAnalysisResponse,
  DailyRow,
  MarketSummaryResponse,
  Overview,
  PerfSummary,
  SignalRow,
  StatusResponse,
  Trade,
} from '@/types/api';

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: () => api<StatusResponse>('/api/status'), refetchInterval: 15_000 });
export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/api/config'), staleTime: Infinity });
export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/api/market/overview'), refetchInterval: 30_000 });
export const useDaily = (tf?: string) =>
  useQuery({ queryKey: ['daily', tf], queryFn: () => api<{ timeframe: string; rows: DailyRow[]; failed: string[]; generatedAt: string }>(`/api/analysis/daily${tf ? `?timeframe=${tf}` : ''}`), refetchInterval: 60_000 });
export const useSummary = () => useQuery({ queryKey: ['summary'], queryFn: () => api<MarketSummaryResponse>('/api/analysis/summary'), refetchInterval: 5 * 60_000 });

export function useRefreshSummary() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<MarketSummaryResponse>('/api/analysis/summary', { method: 'POST' }), onSuccess: (d) => qc.setQueryData(['summary'], d) });
}

export const useAnalysis = (symbol: string, tf: string) =>
  useQuery({ queryKey: ['analysis', symbol, tf], queryFn: () => api<CoinAnalysisResponse>(`/api/analysis/${symbol}?timeframe=${tf}`), placeholderData: keepPreviousData, refetchInterval: 60_000 });

export function useAnalyzeNow(symbol: string, tf: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean) => api<CoinAnalysisResponse>(`/api/analysis/${symbol}?timeframe=${tf}`, { method: 'POST', json: { force } }),
    onSuccess: (d) => {
      qc.setQueryData(['analysis', symbol, tf], d);
      void qc.invalidateQueries({ queryKey: ['daily'] });
    },
  });
}

export interface KlinesResponse {
  candles: Candle[];
  indicators: Record<'sma20' | 'sma50' | 'sma200' | 'bbUpper' | 'bbMiddle' | 'bbLower' | 'rsi' | 'macd' | 'macdSignal' | 'macdHistogram' | 'volumeMa', (number | null)[]> | null;
  source: string;
}
export const useKlines = (symbol: string, tf: string, limit = 300) =>
  useQuery({ queryKey: ['klines', symbol, tf, limit], queryFn: () => api<KlinesResponse>(`/api/market/klines/${symbol}?timeframe=${tf}&limit=${limit}&indicators=true`), placeholderData: keepPreviousData, refetchInterval: 5 * 60_000 });

export const useSignals = (params: Record<string, string | undefined>) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: ['signals', qs], queryFn: () => api<{ items: SignalRow[]; total: number }>(`/api/signals?${qs}`), placeholderData: keepPreviousData });
};

export interface PerformanceResponse {
  overall: PerfSummary;
  byCoin: (PerfSummary & { key: string })[];
  bySignal: (PerfSummary & { key: string })[];
  byTimeframe: (PerfSummary & { key: string })[];
  byMarketCondition: (PerfSummary & { key: string })[];
  holdSignals: number;
  definitions: Record<string, string | number>;
  unavailable?: boolean;
  message?: string;
}
export const usePerformance = () => useQuery({ queryKey: ['performance'], queryFn: () => api<PerformanceResponse>('/api/signals/performance') });

export const useBacktests = () => useQuery({ queryKey: ['backtests'], queryFn: () => api<{ id: string; status: string; mode: string; symbol: string; timeframe: string; strategy: string; createdAt: string; roi: number | null; winRate: number | null; maxDrawdown: number | null; totalTrades: number | null; error: string | null }[]>('/api/backtest') });

export const useBacktest = (id: string | null) =>
  useQuery({
    queryKey: ['backtest', id],
    queryFn: () => api<BacktestJob>(`/api/backtest/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'COMPLETED' || q.state.data.status === 'FAILED') ? false : 1000),
  });
export const useBacktestTrades = (id: string | null, enabled: boolean) => useQuery({ queryKey: ['bt-trades', id], queryFn: () => api<Trade[]>(`/api/backtest/${id}/trades`), enabled: Boolean(id) && enabled });
export const useBacktestDrawdown = (id: string | null, enabled: boolean) =>
  useQuery({ queryKey: ['bt-dd', id], queryFn: () => api<{ time: number; peak: number; equity: number; drawdownPct: number }[]>(`/api/backtest/${id}/drawdown`), enabled: Boolean(id) && enabled });
export type { BacktestMetrics };

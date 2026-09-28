import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { streamUrl } from '@/services/api';
import { useLive, type AlertEvent, type LiveTicker } from '@/stores/live';

/** Single app-wide SSE connection to the backend (never to Binance directly). */
export function useGlobalStream() {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const { setConnected, pushTicker, pushAlert } = useLive.getState();
    const connect = () => {
      es = new EventSource(streamUrl());
      es.addEventListener('hello', () => setConnected(true));
      es.addEventListener('ticker', (e) => pushTicker(JSON.parse((e as MessageEvent).data) as LiveTicker));
      es.addEventListener('alert', (e) => {
        pushAlert(JSON.parse((e as MessageEvent).data) as AlertEvent);
        void qc.invalidateQueries({ queryKey: ['alerts'] });
      });
      es.addEventListener('candle-closed', () => {
        void qc.invalidateQueries({ queryKey: ['daily'] });
        void qc.invalidateQueries({ queryKey: ['analysis'] });
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      clearTimeout(retry);
      es?.close();
    };
  }, [qc]);
}

export interface LiveKline {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

/** Per-chart kline stream. */
export function useKlineStream(symbol: string, timeframe: string, onKline: (k: LiveKline) => void) {
  useEffect(() => {
    const es = new EventSource(streamUrl(`${symbol}:${timeframe}`));
    es.addEventListener('kline', (e) => onKline(JSON.parse((e as MessageEvent).data) as LiveKline));
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);
}

import WebSocket from 'ws';
import { env, trackedSymbols } from '../../config/env.js';
import type { Timeframe } from '../../config/timeframes.js';
import { logger } from '../../utils/logger.js';
import { cache } from '../cache/cache.js';
import { marketData } from './index.js';
import { markFailure, markSuccess } from './status.js';

export interface LiveTicker {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  changePct: number;
  eventTime: number;
}

export interface LiveKline {
  symbol: string;
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

export const CHANNEL_TICKER = 'stream:ticker';
export const channelKline = (symbol: string, tf: string) => `stream:kline:${symbol}:${tf}`;
export const CHANNEL_CANDLE_CLOSED = 'stream:candle-closed';

/**
 * Binance WebSocket → Redis pub/sub. Frontend never talks to Binance directly: it receives
 * these events over SSE. Dynamic kline subscriptions are ref-counted per (symbol, timeframe).
 */
class MarketStream {
  private ws: WebSocket | null = null;
  private urls = [env.BINANCE_WS_URL, env.BINANCE_WS_FALLBACK_URL].filter(Boolean);
  private urlIdx = 0;
  private attempts = 0;
  private klineRefs = new Map<string, number>();
  private msgId = 1;
  private stopped = false;
  private mockTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;

  private baseStreams(): string[] {
    return trackedSymbols.flatMap((s) => [`${s.toLowerCase()}@miniTicker`, `${s.toLowerCase()}@kline_${env.ANALYSIS_TIMEFRAME}`]);
  }

  start() {
    this.stopped = false;
    if (env.MOCK_MODE) return this.startMock();
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
    if (this.mockTimer) clearInterval(this.mockTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  get connected() {
    return env.MOCK_MODE ? true : this.ws?.readyState === WebSocket.OPEN;
  }

  private connect() {
    const streams = [...this.baseStreams(), ...[...this.klineRefs.keys()]];
    const url = `${this.urls[this.urlIdx]}/stream?streams=${streams.join('/')}`;
    const ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    this.ws = ws;
    ws.on('open', () => {
      this.attempts = 0;
      this.lastMessageAt = Date.now();
      markSuccess('binance_ws');
      logger.info({ url: this.urls[this.urlIdx], streams: streams.length }, 'Binance WebSocket connected');
    });
    ws.on('message', (buf) => this.onMessage(buf.toString()));
    ws.on('error', (e) => {
      markFailure('binance_ws', e.message);
      logger.warn({ err: e.message }, 'Binance WebSocket error');
    });
    ws.on('close', () => {
      if (this.stopped) return;
      this.attempts++;
      if (this.attempts % 2 === 0) this.urlIdx = (this.urlIdx + 1) % this.urls.length; // alternate endpoints
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts, 5));
      logger.warn({ delay }, 'Binance WebSocket closed, reconnecting');
      setTimeout(() => this.connect(), delay);
    });
    if (!this.heartbeat)
      this.heartbeat = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastMessageAt > 60_000) {
          logger.warn('Binance WebSocket stale, forcing reconnect');
          this.ws.terminate();
        }
      }, 30_000);
  }

  private onMessage(raw: string) {
    this.lastMessageAt = Date.now();
    let msg: { stream?: string; data?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const d = msg.data as Record<string, any> | undefined;
    if (!d) return;
    if (d.e === '24hrMiniTicker') {
      const open = Number(d.o);
      const price = Number(d.c);
      const t: LiveTicker = { symbol: d.s, price, open, high: Number(d.h), low: Number(d.l), volume: Number(d.v), quoteVolume: Number(d.q), changePct: ((price - open) / open) * 100, eventTime: d.E };
      void cache.set(`live:ticker:${t.symbol}`, t, 120);
      void cache.publish(CHANNEL_TICKER, t);
    } else if (d.e === 'kline') {
      const k = d.k;
      const kl: LiveKline = { symbol: d.s, timeframe: k.i, openTime: k.t, closeTime: k.T, open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v), closed: Boolean(k.x) };
      void cache.publish(channelKline(kl.symbol, kl.timeframe), kl);
      if (kl.closed) void cache.publish(CHANNEL_CANDLE_CLOSED, kl);
    }
  }

  /** Ref-counted dynamic kline subscription for chart streaming. */
  subscribeKline(symbol: string, tf: Timeframe): () => void {
    const key = `${symbol.toLowerCase()}@kline_${tf}`;
    const n = this.klineRefs.get(key) ?? 0;
    this.klineRefs.set(key, n + 1);
    if (n === 0 && !this.baseStreams().includes(key)) this.send('SUBSCRIBE', [key]);
    return () => {
      const m = (this.klineRefs.get(key) ?? 1) - 1;
      if (m <= 0) {
        this.klineRefs.delete(key);
        if (!this.baseStreams().includes(key)) this.send('UNSUBSCRIBE', [key]);
      } else this.klineRefs.set(key, m);
    };
  }

  private send(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]) {
    if (env.MOCK_MODE) return;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method, params, id: this.msgId++ }));
  }

  private startMock() {
    const tick = async () => {
      for (const s of trackedSymbols) {
        const t = await marketData.ticker24h(s);
        const live: LiveTicker = { symbol: s, price: t.lastPrice, open: t.openPrice, high: t.highPrice, low: t.lowPrice, volume: t.volume, quoteVolume: t.quoteVolume, changePct: t.priceChangePercent, eventTime: Date.now() };
        await cache.set(`live:ticker:${s}`, live, 120);
        await cache.publish(CHANNEL_TICKER, live);
      }
      for (const key of this.klineRefs.keys()) {
        const [sym, rest] = key.split('@kline_');
        const [k] = (await marketData.klines(sym.toUpperCase(), rest as Timeframe, { limit: 1 })).slice(-1);
        if (k) await cache.publish(channelKline(sym.toUpperCase(), rest), { symbol: sym.toUpperCase(), timeframe: rest, ...k, closed: false });
      }
    };
    void tick();
    this.mockTimer = setInterval(() => void tick().catch(() => undefined), 3000);
  }
}

export const marketStream = new MarketStream();

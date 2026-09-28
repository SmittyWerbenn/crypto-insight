import { Redis } from 'ioredis';
import { EventEmitter } from 'node:events';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Redis-backed cache + pub/sub with an in-memory fallback (used in tests and when Redis is down,
 * so the API degrades instead of failing).
 */
class Cache {
  private redis: Redis | null = null;
  private sub: Redis | null = null;
  private mem = new Map<string, { v: string; exp: number }>();
  private bus = new EventEmitter();
  private ready = false;

  constructor() {
    this.bus.setMaxListeners(1000);
  }

  get isRedisReady() {
    return this.ready;
  }

  get connection(): Redis | null {
    return this.ready ? this.redis : null;
  }

  async init(): Promise<boolean> {
    if (!env.REDIS_URL) {
      logger.warn('REDIS_URL not set — using in-memory cache');
      return false;
    }
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true, enableOfflineQueue: false });
    this.sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    this.redis.on('error', (e) => {
      if (this.ready) logger.error({ err: e.message }, 'Redis error');
    });
    this.redis.on('ready', () => (this.ready = true));
    this.redis.on('end', () => (this.ready = false));
    try {
      await this.redis.connect();
      await this.sub.connect();
      this.sub.on('message', (channel, msg) => this.bus.emit(channel, msg));
      this.ready = true;
      logger.info('Redis connected');
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Redis unreachable — falling back to in-memory cache');
      this.ready = false;
    }
    return this.ready;
  }

  async get<T>(key: string): Promise<T | null> {
    let raw: string | null = null;
    if (this.ready && this.redis) {
      try {
        raw = await this.redis.get(key);
      } catch {
        raw = null;
      }
    } else {
      const e = this.mem.get(key);
      if (e && e.exp > Date.now()) raw = e.v;
      else if (e) this.mem.delete(key);
    }
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.ready && this.redis) {
      try {
        await this.redis.set(key, raw, 'EX', ttlSeconds);
        return;
      } catch {
        /* fall through to memory */
      }
    }
    this.mem.set(key, { v: raw, exp: Date.now() + ttlSeconds * 1000 });
    if (this.mem.size > 5000) {
      const now = Date.now();
      for (const [k, e] of this.mem) if (e.exp < now) this.mem.delete(k);
    }
  }

  async del(key: string): Promise<void> {
    this.mem.delete(key);
    if (this.ready && this.redis) await this.redis.del(key).catch(() => undefined);
  }

  /** Get-or-compute with single-flight de-duplication per process. */
  private inflight = new Map<string, Promise<unknown>>();
  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const p = fn()
      .then(async (v) => {
        await this.set(key, v, ttlSeconds);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    const msg = JSON.stringify(payload);
    if (this.ready && this.redis) {
      await this.redis.publish(channel, msg).catch(() => this.bus.emit(channel, msg));
    } else this.bus.emit(channel, msg);
  }

  subscribe(channel: string, handler: (payload: string) => void): () => void {
    this.bus.on(channel, handler);
    if (this.ready && this.sub && this.bus.listenerCount(channel) === 1) void this.sub.subscribe(channel).catch(() => undefined);
    return () => {
      this.bus.off(channel, handler);
      if (this.ready && this.sub && this.bus.listenerCount(channel) === 0) void this.sub.unsubscribe(channel).catch(() => undefined);
    };
  }

  async close() {
    await this.redis?.quit().catch(() => undefined);
    await this.sub?.quit().catch(() => undefined);
  }
}

export const cache = new Cache();

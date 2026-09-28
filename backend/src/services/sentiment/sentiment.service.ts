import { desc } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { getDb, isDbReady } from '../../db/client.js';
import { news, sentiment } from '../../db/schema.js';
import { fetchJson } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { markFailure, markSuccess } from '../binance/status.js';
import { cache } from '../cache/cache.js';

export interface FearGreed {
  value: number;
  classification: string;
  timestamp: number;
  history: { value: number; timestamp: number }[];
}

/** Crypto Fear & Greed Index (alternative.me). Supporting context only. */
export async function fearGreed(): Promise<FearGreed | null> {
  if (env.MOCK_MODE) return null;
  try {
    return await cache.wrap('sentiment:feargreed', 900, async () => {
      const r = await fetchJson<{ data: { value: string; value_classification: string; timestamp: string }[] }>(`${env.FEAR_GREED_API_URL}?limit=30`, { timeoutMs: 8000 });
      markSuccess('fear_greed');
      const [cur] = r.data;
      const out: FearGreed = {
        value: Number(cur.value),
        classification: cur.value_classification,
        timestamp: Number(cur.timestamp) * 1000,
        history: r.data.map((d) => ({ value: Number(d.value), timestamp: Number(d.timestamp) * 1000 })).reverse(),
      };
      if (isDbReady()) {
        await getDb()
          .insert(sentiment)
          .values({ source: 'fear_greed', timestamp: new Date(out.timestamp), value: out.value, classification: out.classification })
          .onConflictDoNothing();
      }
      return out;
    });
  } catch (e) {
    markFailure('fear_greed', (e as Error).message);
    logger.warn({ err: (e as Error).message }, 'Fear & Greed unavailable');
    return null;
  }
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string | null;
  publishedAt: string;
  coins: string[];
  sentiment: 'positive' | 'negative' | 'neutral' | null;
}

export interface NewsResult {
  available: boolean;
  provider: string | null;
  items: NewsItem[];
  sentimentBreakdown: { positive: number; neutral: number; negative: number; total: number } | null;
  message?: string;
}

/**
 * News via CryptoPanic (requires CRYPTOPANIC_API_KEY). Sentiment is derived from community votes.
 * Without a key, news is reported as unavailable — nothing is fabricated.
 */
export async function latestNews(currency?: string): Promise<NewsResult> {
  if (!env.CRYPTOPANIC_API_KEY) {
    return { available: false, provider: null, items: [], sentimentBreakdown: null, message: 'News provider not configured. Set CRYPTOPANIC_API_KEY to enable news & sentiment.' };
  }
  try {
    return await cache.wrap(`news:${currency ?? 'all'}`, 600, async () => {
      const params = new URLSearchParams({ auth_token: env.CRYPTOPANIC_API_KEY!, public: 'true', kind: 'news' });
      if (currency) params.set('currencies', currency);
      const r = await fetchJson<{ results: { id: number; title: string; url: string; published_at: string; source?: { title: string }; currencies?: { code: string }[]; votes?: Record<string, number> }[] }>(
        `https://cryptopanic.com/api/developer/v2/posts/?${params}`,
        { timeoutMs: 10_000 },
      );
      markSuccess('news');
      const items: NewsItem[] = r.results.map((p) => {
        const v = p.votes ?? {};
        const pos = (v.positive ?? 0) + (v.liked ?? 0);
        const neg = (v.negative ?? 0) + (v.disliked ?? 0) + (v.toxic ?? 0);
        const s: NewsItem['sentiment'] = pos + neg === 0 ? 'neutral' : pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
        return { id: `cp-${p.id}`, title: p.title, url: p.url, source: p.source?.title ?? null, publishedAt: p.published_at, coins: (p.currencies ?? []).map((c) => c.code), sentiment: s };
      });
      if (isDbReady() && items.length) {
        await getDb()
          .insert(news)
          .values(items.map((i) => ({ id: i.id, title: i.title, url: i.url, source: i.source, publishedAt: new Date(i.publishedAt), coins: i.coins, sentiment: i.sentiment })))
          .onConflictDoNothing();
      }
      const total = items.length;
      const cnt = (k: string) => (total ? Math.round((items.filter((i) => i.sentiment === k).length / total) * 1000) / 10 : 0);
      return { available: true, provider: 'CryptoPanic', items, sentimentBreakdown: { positive: cnt('positive'), neutral: cnt('neutral'), negative: cnt('negative'), total } };
    });
  } catch (e) {
    markFailure('news', (e as Error).message);
    const stored = isDbReady() ? await getDb().select().from(news).orderBy(desc(news.publishedAt)).limit(30) : [];
    return {
      available: false,
      provider: 'CryptoPanic',
      items: stored.map((n) => ({ id: n.id, title: n.title, url: n.url, source: n.source, publishedAt: n.publishedAt.toISOString(), coins: n.coins as string[], sentiment: n.sentiment as NewsItem['sentiment'] })),
      sentimentBreakdown: null,
      message: `News provider temporarily unavailable: ${(e as Error).message}`,
    };
  }
}

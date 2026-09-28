import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Newspaper } from 'lucide-react';
import { api } from '@/services/api';
import { Badge, Card, CardBody, CardHeader, EmptyState, Notice, PageHeader, Stat } from '@/components/ui/primitives';
import { fmtDate } from '@/utils/format';

interface NewsResp {
  available: boolean;
  provider: string | null;
  items: { id: string; title: string; url: string; source: string | null; publishedAt: string; coins: string[]; sentiment: 'positive' | 'negative' | 'neutral' | null }[];
  sentimentBreakdown: { positive: number; neutral: number; negative: number; total: number } | null;
  message?: string;
}

export default function News() {
  const news = useQuery({ queryKey: ['news'], queryFn: () => api<NewsResp>('/api/news'), refetchInterval: 10 * 60_000 });
  const fg = useQuery({ queryKey: ['global'], queryFn: () => api<{ fearGreed: { value: number; classification: string; history: { value: number; timestamp: number }[] } | null }>('/api/market/global') });
  const b = news.data?.sentimentBreakdown;
  return (
    <div className="space-y-5">
      <PageHeader title="News & Sentiment" description="Sentiment is supporting context only — never proof of future price movement." />
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="Fear & Greed Index" subtitle="alternative.me · daily" />
          <CardBody>
            {fg.data?.fearGreed ? (
              <div className="flex items-end gap-6">
                <Stat label="Today" value={<span className="text-3xl">{fg.data.fearGreed.value}</span>} sub={fg.data.fearGreed.classification} />
                <div className="flex h-16 flex-1 items-end gap-0.5" role="img" aria-label="Fear and greed, last 30 days">
                  {fg.data.fearGreed.history.map((h) => (
                    <div key={h.timestamp} title={`${fmtDate(h.timestamp, false)}: ${h.value}`} className="flex-1 rounded-t-sm bg-series-1/70" style={{ height: `${h.value}%` }} />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-3">Fear & Greed data unavailable.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="News Sentiment" subtitle={news.data?.provider ?? 'No provider'} />
          <CardBody>
            {b ? (
              <div className="grid grid-cols-3 gap-4">
                <Stat label="Positive" value={<span className="text-up">{b.positive}%</span>} />
                <Stat label="Neutral" value={`${b.neutral}%`} />
                <Stat label="Negative" value={<span className="text-down">{b.negative}%</span>} />
              </div>
            ) : (
              <p className="text-sm text-ink-3">{news.data?.message ?? 'Loading…'}</p>
            )}
          </CardBody>
        </Card>
      </div>
      {news.data && !news.data.available && <Notice tone="info">{news.data.message}</Notice>}
      <Card>
        <CardHeader title="Latest headlines" />
        {news.data?.items.length ? (
          <ul className="divide-y divide-border">
            {news.data.items.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium hover:text-primary">
                    {n.title} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <div className="mt-0.5 text-xs text-ink-3">
                    {n.source} · {fmtDate(n.publishedAt)} {n.coins.length > 0 && `· ${n.coins.join(', ')}`}
                  </div>
                </div>
                {n.sentiment && <Badge tone={n.sentiment === 'positive' ? 'up' : n.sentiment === 'negative' ? 'down' : 'neutral'}>{n.sentiment}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Newspaper className="h-8 w-8" />} title="No news available" />
        )}
      </Card>
    </div>
  );
}

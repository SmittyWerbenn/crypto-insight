import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useOverview } from '@/hooks/queries';
import { Card, CardHeader, Input, Notice, PageHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { Change } from '@/components/ui/domain';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { Mover } from '@/types/api';
import { baseAsset, fmtCompact, fmtPct, fmtPrice } from '@/utils/format';

type View = 'gainers' | 'losers' | 'volatility';

export default function Markets() {
  const [view, setView] = useState<View>('gainers');
  const [q, setQ] = useState('');
  const overview = useOverview();
  const list = useQuery({ queryKey: ['movers', view], queryFn: () => api<Mover[]>(`/api/market/${view}?limit=50`), refetchInterval: 30_000 });
  const rows = useMemo(() => (list.data ?? []).filter((m) => m.symbol.includes(q.toUpperCase())), [list.data, q]);
  return (
    <div>
      <PageHeader title="Markets" description="Binance spot USDT pairs (stablecoins & leveraged tokens excluded, ≥ $1M 24h volume)." />
      {overview.error && <Notice tone="error" title="Binance market data temporarily unavailable.">{(overview.error as Error).message}</Notice>}
      <Card>
        <CardHeader
          title={view === 'volatility' ? 'Most Volatile (24h range)' : view === 'gainers' ? 'Top Gainers' : 'Top Losers'}
          action={
            <div className="flex gap-2">
              <Input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-32" />
              <Segmented<View> value={view} onChange={setView} options={[{ value: 'gainers', label: 'Gainers' }, { value: 'losers', label: 'Losers' }, { value: 'volatility', label: 'Volatile' }]} />
            </div>
          }
        />
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>Pair</TH>
                <TH className="text-right">Price</TH>
                <TH className="text-right">24h Change</TH>
                <TH className="text-right">24h Range</TH>
                <TH className="text-right">24h Volume</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((m, i) => (
                <TR key={m.symbol} className="hover:bg-slate-50/70">
                  <TD className="text-ink-3">{i + 1}</TD>
                  <TD>
                    <Link to={`/analysis/${m.symbol}`} className="font-semibold hover:text-primary">
                      {baseAsset(m.symbol)}
                      <span className="font-normal text-ink-3">/USDT</span>
                    </Link>
                  </TD>
                  <TD className="text-right">{fmtPrice(m.price)}</TD>
                  <TD className="text-right">
                    <Change value={m.changePct} />
                  </TD>
                  <TD className="text-right">{fmtPct(m.rangePct, 1, false)}</TD>
                  <TD className="text-right">{fmtCompact(m.quoteVolume)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

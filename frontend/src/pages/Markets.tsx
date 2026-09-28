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
      <PageHeader title="Pasar" description="Pasangan spot USDT Binance (tanpa stablecoin & token leverage, volume 24j ≥ $1 jt)." />
      {overview.error && <Notice tone="error" title="Data pasar Binance sementara tidak tersedia.">{(overview.error as Error).message}</Notice>}
      <Card>
        <CardHeader
          title={view === 'volatility' ? 'Paling Volatil (rentang 24j)' : view === 'gainers' ? 'Kenaikan Tertinggi' : 'Penurunan Terdalam'}
          action={
            <div className="flex gap-2">
              <Input placeholder="Saring…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-32" />
              <Segmented<View> value={view} onChange={setView} options={[{ value: 'gainers', label: 'Naik' }, { value: 'losers', label: 'Turun' }, { value: 'volatility', label: 'Volatil' }]} />
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
                <TH>Pasangan</TH>
                <TH className="text-right">Harga</TH>
                <TH className="text-right">Perubahan 24j</TH>
                <TH className="text-right">Rentang 24j</TH>
                <TH className="text-right">Volume 24j</TH>
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

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import type { DailyRow } from '@/types/api';
import { Button, Card, CardHeader, EmptyState, Input, Notice, PageHeader } from '@/components/ui/primitives';
import { DailyTable } from '@/components/dashboard/DailyTable';

export default function Watchlist() {
  const qc = useQueryClient();
  const [sym, setSym] = useState('');
  const wl = useQuery({ queryKey: ['watchlist'], queryFn: () => api<{ symbols: string[]; rows: DailyRow[]; failed: string[] }>('/api/watchlist'), refetchInterval: 60_000 });
  const add = useMutation({
    mutationFn: (symbol: string) => api('/api/watchlist', { method: 'POST', json: { symbol } }),
    onSuccess: () => {
      setSym('');
      void qc.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
  const del = useMutation({ mutationFn: (s: string) => api(`/api/watchlist/${s}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }) });
  return (
    <div>
      <PageHeader
        title="Watchlist"
        actions={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const s = sym.trim().toUpperCase();
              if (s) add.mutate(s.endsWith('USDT') ? s : `${s}USDT`);
            }}
          >
            <Input placeholder="e.g. LINK or LINKUSDT" value={sym} onChange={(e) => setSym(e.target.value)} className="w-48" />
            <Button type="submit" loading={add.isPending}>
              Add
            </Button>
          </form>
        }
      />
      {add.error && <Notice tone="error" className="mb-4">{(add.error as Error).message}</Notice>}
      {wl.error && <Notice tone="error">{(wl.error as Error).message}</Notice>}
      <Card>
        <CardHeader title="Watched coins" />
        {wl.data && wl.data.symbols.length === 0 ? (
          <EmptyState icon={<Star className="h-8 w-8" />} title="Your watchlist is empty">
            Add a coin above or use the Watch button on a coin page.
          </EmptyState>
        ) : (
          <DailyTable
            rows={wl.data?.rows}
            loading={wl.isLoading}
            extra={(r) => (
              <Button size="icon" variant="danger" onClick={() => del.mutate(r.symbol)} aria-label={`Remove ${r.symbol}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          />
        )}
        {wl.data?.failed.length ? <p className="px-5 pb-4 text-xs text-warn">Could not analyse: {wl.data.failed.join(', ')}</p> : null}
      </Card>
    </div>
  );
}

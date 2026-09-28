import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Select } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { baseAsset, fmtDate, fmtNum } from '@/utils/format';

const TYPES: { value: string; label: string; needsValue: boolean }[] = [
  { value: 'PRICE_ABOVE', label: 'Price >', needsValue: true },
  { value: 'PRICE_BELOW', label: 'Price <', needsValue: true },
  { value: 'RSI_ABOVE', label: 'RSI >', needsValue: true },
  { value: 'RSI_BELOW', label: 'RSI <', needsValue: true },
  { value: 'SCORE_ABOVE', label: 'Technical Score >', needsValue: true },
  { value: 'SCORE_BELOW', label: 'Technical Score <', needsValue: true },
  { value: 'SIGNAL_BUY', label: 'Signal = BUY (or stronger)', needsValue: false },
  { value: 'SIGNAL_STRONG_BUY', label: 'Signal = STRONG BUY', needsValue: false },
  { value: 'SIGNAL_SELL', label: 'Signal = SELL (or stronger)', needsValue: false },
];

interface AlertRow {
  id: string;
  symbol: string;
  type: string;
  value: number | null;
  active: boolean;
  triggeredAt: string | null;
  triggeredValue: number | null;
  createdAt: string;
}

export default function Alerts() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['alerts'], queryFn: () => api<AlertRow[]>('/api/alerts'), refetchInterval: 30_000 });
  const [f, setF] = useState({ symbol: 'BTC', type: 'PRICE_ABOVE', value: '' });
  const t = TYPES.find((x) => x.value === f.type)!;
  const add = useMutation({
    mutationFn: () => {
      const s = f.symbol.toUpperCase();
      return api('/api/alerts', { method: 'POST', json: { symbol: s.endsWith('USDT') ? s : `${s}USDT`, type: f.type, value: t.needsValue ? Number(f.value) : null } });
    },
    onSuccess: () => {
      setF({ ...f, value: '' });
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/api/alerts/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }) });
  return (
    <div className="space-y-5">
      <PageHeader title="Alerts" description="Price alerts are checked on live ticks; RSI, score and signal alerts on each analysis cycle (4H timeframe). One-shot." />
      <Card>
        <CardHeader title="New alert" />
        <CardBody>
          <form
            className="grid grid-cols-2 items-end gap-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label="Coin">
              <Input required value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} />
            </Field>
            <Field label="Condition">
              <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {TYPES.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Value">
              <Input type="number" step="any" required={t.needsValue} disabled={!t.needsValue} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
            </Field>
            <Button type="submit" loading={add.isPending}>
              Create alert
            </Button>
          </form>
          {add.error && <Notice tone="error" className="mt-3">{(add.error as Error).message}</Notice>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Your alerts" />
        {list.error && <Notice tone="error" className="mx-5 mb-4">{(list.error as Error).message}</Notice>}
        {list.data?.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Coin</TH>
                <TH>Condition</TH>
                <TH>Status</TH>
                <TH>Triggered</TH>
                <TH>Created</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {list.data.map((a) => (
                <TR key={a.id}>
                  <TD className="font-semibold">{baseAsset(a.symbol)}</TD>
                  <TD>
                    {TYPES.find((x) => x.value === a.type)?.label ?? a.type} {a.value !== null ? fmtNum(a.value, 8) : ''}
                  </TD>
                  <TD>{a.active ? <Badge tone="blue">Active</Badge> : <Badge tone="up">Triggered</Badge>}</TD>
                  <TD>{a.triggeredAt ? `${fmtDate(a.triggeredAt)} @ ${fmtNum(a.triggeredValue, 8)}` : '–'}</TD>
                  <TD>{fmtDate(a.createdAt)}</TD>
                  <TD className="text-right">
                    <Button size="icon" variant="danger" onClick={() => del.mutate(a.id)} aria-label="Delete alert">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={<Bell className="h-8 w-8" />} title="No alerts" />
        )}
      </Card>
    </div>
  );
}

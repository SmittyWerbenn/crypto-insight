import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Select } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { baseAsset, currencySymbol, fmtDate, fmtNum, fmtPriceSym, fromDisplay } from '@/utils/format';

const isPrice = (type: string) => type.startsWith('PRICE_');

const TYPES: { value: string; label: string; needsValue: boolean }[] = [
  { value: 'PRICE_ABOVE', label: 'Harga >', needsValue: true },
  { value: 'PRICE_BELOW', label: 'Harga <', needsValue: true },
  { value: 'RSI_ABOVE', label: 'RSI >', needsValue: true },
  { value: 'RSI_BELOW', label: 'RSI <', needsValue: true },
  { value: 'SCORE_ABOVE', label: 'Skor Teknikal >', needsValue: true },
  { value: 'SCORE_BELOW', label: 'Skor Teknikal <', needsValue: true },
  { value: 'SIGNAL_BUY', label: 'Sinyal = BELI (atau lebih kuat)', needsValue: false },
  { value: 'SIGNAL_STRONG_BUY', label: 'Sinyal = BELI KUAT', needsValue: false },
  { value: 'SIGNAL_SELL', label: 'Sinyal = JUAL (atau lebih kuat)', needsValue: false },
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
      // Price thresholds are entered in the display currency; the backend compares in USDT
      const value = !t.needsValue ? null : isPrice(f.type) ? fromDisplay(Number(f.value)) : Number(f.value);
      return api('/api/alerts', { method: 'POST', json: { symbol: s.endsWith('USDT') ? s : `${s}USDT`, type: f.type, value } });
    },
    onSuccess: () => {
      setF({ ...f, value: '' });
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/api/alerts/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }) });
  return (
    <div className="space-y-5">
      <PageHeader title="Peringatan" description="Peringatan harga dicek dari harga live; peringatan RSI, skor, dan sinyal dicek setiap siklus analisa (timeframe 4J). Sekali terpicu." />
      <Card>
        <CardHeader title="Peringatan baru" />
        <CardBody>
          <form
            className="grid grid-cols-2 items-end gap-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label="Koin">
              <Input required value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} />
            </Field>
            <Field label="Kondisi">
              <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {TYPES.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={isPrice(f.type) ? `Price (${currencySymbol()})` : 'Nilai'}>
              <Input type="number" step="any" required={t.needsValue} disabled={!t.needsValue} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
            </Field>
            <Button type="submit" loading={add.isPending}>
              Buat peringatan
            </Button>
          </form>
          {add.error && <Notice tone="error" className="mt-3">{(add.error as Error).message}</Notice>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Peringatan Anda" />
        {list.error && <Notice tone="error" className="mx-5 mb-4">{(list.error as Error).message}</Notice>}
        {list.data?.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Koin</TH>
                <TH>Kondisi</TH>
                <TH>Status</TH>
                <TH>Terpicu</TH>
                <TH>Dibuat</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {list.data.map((a) => (
                <TR key={a.id}>
                  <TD className="font-semibold">{baseAsset(a.symbol)}</TD>
                  <TD>
                    {TYPES.find((x) => x.value === a.type)?.label ?? a.type} {a.value !== null ? (isPrice(a.type) ? fmtPriceSym(a.value) : fmtNum(a.value, 2)) : ''}
                  </TD>
                  <TD>{a.active ? <Badge tone="blue">Aktif</Badge> : <Badge tone="up">Terpicu</Badge>}</TD>
                  <TD>{a.triggeredAt ? `${fmtDate(a.triggeredAt)} @ ${isPrice(a.type) ? fmtPriceSym(a.triggeredValue) : fmtNum(a.triggeredValue, 2)}` : '–'}</TD>
                  <TD>{fmtDate(a.createdAt)}</TD>
                  <TD className="text-right">
                    <Button size="icon" variant="danger" onClick={() => del.mutate(a.id)} aria-label="Hapus peringatan">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={<Bell className="h-8 w-8" />} title="Belum ada peringatan" />
        )}
      </Card>
    </div>
  );
}

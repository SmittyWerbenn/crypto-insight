import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Select, Stat } from '@/components/ui/primitives';
import { Change } from '@/components/ui/domain';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { baseAsset, currencySymbol, displayCurrency, fmtDate, fmtNum, fmtPrice, fmtUsd, fromDisplay } from '@/utils/format';

interface PortfolioResp {
  summary: { totalInvestment: number; currentValue: number; unrealizedPnl: number; dailyPnl: number; roi: number | null; realizedPnl: number };
  positions: { symbol: string; quantity: number; averageBuyPrice: number; price: number | null; invested: number; currentValue: number | null; unrealizedPnl: number | null; unrealizedPnlPct: number | null; dailyPnl: number | null; change24hPct: number | null; allocationPct: number | null }[];
  transactions: { id: string; symbol: string; side: string; quantity: number; price: number; executedAt: string; note: string | null }[];
  note: string;
}

export default function Portfolio() {
  const qc = useQueryClient();
  const p = useQuery({ queryKey: ['portfolio'], queryFn: () => api<PortfolioResp>('/api/portfolio'), refetchInterval: 30_000 });
  const [form, setForm] = useState({ symbol: '', side: 'BUY', quantity: '', price: '' });
  const add = useMutation({
    mutationFn: () => api('/api/portfolio/transaction', { method: 'POST', json: { symbol: form.symbol.toUpperCase().endsWith('USDT') ? form.symbol.toUpperCase() : `${form.symbol.toUpperCase()}USDT`, side: form.side, quantity: Number(form.quantity), price: fromDisplay(Number(form.price)) } }),
    onSuccess: () => {
      setForm({ symbol: '', side: 'BUY', quantity: '', price: '' });
      void qc.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/api/portfolio/transaction/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['portfolio'] }) });
  const s = p.data?.summary;
  return (
    <div className="space-y-5">
      <PageHeader title="Portofolio" description="Pencatatan manual, hanya-baca. CryptoInsight AI tidak pernah terhubung ke akun exchange Anda atau menempatkan order." />
      {p.error && <Notice tone="error">{(p.error as Error).message}</Notice>}
      {s && (
        <Card className="p-5">
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Total Investasi" value={fmtUsd(s.totalInvestment)} />
            <Stat label="Nilai Saat Ini" value={fmtUsd(s.currentValue)} />
            <Stat label="Untung/Rugi Belum Terealisasi" value={<span className={s.unrealizedPnl >= 0 ? 'text-up' : 'text-down'}>{fmtUsd(s.unrealizedPnl)}</span>} />
            <Stat label="Untung/Rugi Harian" value={<span className={s.dailyPnl >= 0 ? 'text-up' : 'text-down'}>{fmtUsd(s.dailyPnl)}</span>} />
            <Stat label="ROI" value={<Change value={s.roi} />} />
            <Stat label="Untung/Rugi Terealisasi" value={fmtUsd(s.realizedPnl)} />
          </div>
        </Card>
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Aset Dimiliki" />
          {p.data?.positions.length ? (
            <Table>
              <THead>
                <TR>
                  {['Koin', 'Jumlah', 'Rata-rata Beli', 'Harga', '24h', 'Nilai', 'Untung/Rugi Belum Terealisasi', 'Alokasi'].map((h, i) => (
                    <TH key={h} className={i ? 'text-right' : ''}>
                      {h}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {p.data.positions.map((x) => (
                  <TR key={x.symbol}>
                    <TD className="font-semibold">{baseAsset(x.symbol)}</TD>
                    <TD className="text-right">{fmtNum(x.quantity, 8)}</TD>
                    <TD className="text-right">{fmtPrice(x.averageBuyPrice)}</TD>
                    <TD className="text-right">{fmtPrice(x.price)}</TD>
                    <TD className="text-right">
                      <Change value={x.change24hPct} />
                    </TD>
                    <TD className="text-right">{fmtUsd(x.currentValue)}</TD>
                    <TD className="text-right">
                      <span className={(x.unrealizedPnl ?? 0) >= 0 ? 'text-up' : 'text-down'}>{fmtUsd(x.unrealizedPnl)}</span> <Change value={x.unrealizedPnlPct} className="text-xs" />
                    </TD>
                    <TD className="text-right">{x.allocationPct !== null ? `${x.allocationPct}%` : '–'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState icon={<Briefcase className="h-8 w-8" />} title="Belum ada aset">
              Catat transaksi beli untuk mulai melacak.
            </EmptyState>
          )}
        </Card>
        <Card>
          <CardHeader title="Tambah transaksi" />
          <CardBody>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Koin">
                  <Input required placeholder="BTC" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} />
                </Field>
                <Field label="Jenis">
                  <Select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
                    <option>BUY</option>
                    <option>SELL</option>
                  </Select>
                </Field>
                <Field label="Jumlah">
                  <Input required type="number" step="any" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                </Field>
                <Field label={`Harga per koin (${currencySymbol()})`} hint={displayCurrency() === 'IDR' ? 'Dikonversi ke USDT dengan kurs saat ini' : undefined}>
                  <Input required type="number" step="any" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                </Field>
              </div>
              {add.error && <Notice tone="error">{(add.error as Error).message}</Notice>}
              <Button type="submit" className="w-full" loading={add.isPending}>
                Simpan
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Transaksi" />
        {p.data?.transactions.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Tanggal</TH>
                <TH>Koin</TH>
                <TH>Jenis</TH>
                <TH className="text-right">Jumlah</TH>
                <TH className="text-right">Harga</TH>
                <TH className="text-right">Total</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {p.data.transactions.map((t) => (
                <TR key={t.id}>
                  <TD>{fmtDate(t.executedAt)}</TD>
                  <TD>{baseAsset(t.symbol)}</TD>
                  <TD className={t.side === 'BUY' ? 'text-up' : 'text-down'}>{t.side}</TD>
                  <TD className="text-right">{fmtNum(t.quantity, 8)}</TD>
                  <TD className="text-right">{fmtPrice(t.price)}</TD>
                  <TD className="text-right">{fmtUsd(t.quantity * t.price)}</TD>
                  <TD className="text-right">
                    <Button size="icon" variant="danger" onClick={() => del.mutate(t.id)} aria-label="Hapus transaksi">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="px-5 pb-5 text-sm text-ink-3">Belum ada transaksi.</p>
        )}
      </Card>
    </div>
  );
}

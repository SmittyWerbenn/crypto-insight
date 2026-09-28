import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History as HistoryIcon, Search } from 'lucide-react';
import { api } from '@/services/api';
import { usePerformance, useSignals, type PerformanceResponse } from '@/hooks/queries';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Select, Stat } from '@/components/ui/primitives';
import { Change, Confidence, ConfidenceHeader, ReliabilityBadge, SignalBadge } from '@/components/ui/domain';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { baseAsset, fmtDate, fmtDuration, fmtPrice } from '@/utils/format';
import type { PerfSummary } from '@/types/api';

const RESULT_LABEL: Record<string, string> = { TARGET_HIT: 'Target tercapai', STOP_HIT: 'Kena stop', OPEN: 'Berjalan', PENDING: 'Menunggu', TIMEOUT: 'Waktu habis', INVALIDATED: 'Dibatalkan', AMBIGUOUS: 'Ambigu', NOT_TRACKED: 'Tidak dilacak' };

const RESULT_TONE: Record<string, 'up' | 'down' | 'blue' | 'neutral' | 'warn'> = { TARGET_HIT: 'up', STOP_HIT: 'down', OPEN: 'blue', PENDING: 'blue', TIMEOUT: 'neutral', INVALIDATED: 'warn', AMBIGUOUS: 'warn', NOT_TRACKED: 'neutral' };

function Breakdown({ title, rows }: { title: string; rows: (PerfSummary & { key: string })[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length ? (
        <Table>
          <THead>
            <TR>
              <TH />
              <TH className="text-right">Sinyal</TH>
              <TH className="text-right">Dievaluasi</TH>
              <TH className="text-right">Win Rate</TH>
              <TH className="text-right">Rata-rata Return</TH>
              <TH className="text-right">PF</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD className="font-medium">{baseAsset(r.key).replace('_', ' ')}</TD>
                <TD className="text-right">{r.total}</TD>
                <TD className="text-right">{r.evaluated}</TD>
                <TD className="text-right">{r.winRate !== null ? `${r.winRate}%` : '–'}</TD>
                <TD className="text-right">
                  <Change value={r.averageReturn} />
                </TD>
                <TD className="text-right">{r.profitFactor ?? '–'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="px-5 pb-5 text-sm text-ink-3">Belum ada sinyal yang dievaluasi.</p>
      )}
    </Card>
  );
}

function PerformanceDashboard({ p }: { p: PerformanceResponse }) {
  const o = p.overall;
  return (
    <>
      <Card>
        <CardHeader title="Performa Sinyal AI" subtitle={`Sinyal dilacak langsung · jendela evaluasi ${p.definitions.evaluationWindowCandles} candle`} />
        <CardBody>
          {o.evaluated < 30 && <Notice tone="warn" className="mb-4">Sampel historis terbatas ({o.evaluated} dievaluasi). Statistik performa mungkin kurang andal.</Notice>}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7">
            <Stat label="Total sinyal" value={o.total} sub={`${o.open} berjalan · ${p.holdSignals} tahan`} />
            <Stat label="Berhasil" value={<span className="text-up">{o.successful}</span>} />
            <Stat label="Gagal" value={<span className="text-down">{o.failed}</span>} />
            <Stat label="Win rate" value={o.winRate !== null ? `${o.winRate}%` : '–'} />
            <Stat label="Rata-rata return" value={<Change value={o.averageReturn} />} />
            <Stat label="Median return" value={<Change value={o.medianReturn} />} />
            <Stat label="Terbaik / Terburuk" value={<><Change value={o.bestReturn} /> / <Change value={o.worstReturn} /></>} />
            <Stat label="Rata-rata waktu ke target" value={fmtDuration(o.averageTimeToTargetMs)} />
            <Stat label="Rata-rata waktu ke stop" value={fmtDuration(o.averageTimeToStopMs)} />
            <Stat label="Ambigu (dikecualikan)" value={o.ambiguous} />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
            Berhasil = TARGET_HIT, atau TIMEOUT/INVALIDATED dengan return positif. Gagal = STOP_HIT, atau TIMEOUT/INVALIDATED dengan return nol/negatif. Dikecualikan: AMBIGUOUS, OPEN, PENDING, HOLD. Performa historis tidak menjamin performa di masa depan.
          </p>
        </CardBody>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title="Per Koin" rows={p.byCoin} />
        <Breakdown title="Per Sinyal" rows={p.bySignal} />
        <Breakdown title="Per Timeframe" rows={p.byTimeframe} />
        <Breakdown title="Per Kondisi Pasar" rows={p.byMarketCondition} />
      </div>
    </>
  );
}

interface StudyResp {
  sampleSize: number;
  winRate: number | null;
  averageReturn: number | null;
  medianReturn: number | null;
  bestReturn: number | null;
  worstReturn: number | null;
  averageHoldingMs: number;
  maxDrawdown: number | null;
  reliability: string;
  warning: string | null;
  note: string;
  candlesScanned: number;
}

function HistoricalQuery() {
  const [f, setF] = useState({ symbol: 'BTCUSDT', timeframe: '4h', signal: 'BUY', rsiMin: '50', rsiMax: '70', macd: 'bullish', priceAboveMa50: 'true', priceAboveMa20: '', volumeAboveAvg: '', horizon: '6' });
  const [qs, setQs] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['study', qs], queryFn: () => api<StudyResp>(`/api/signals/query?${qs}`), enabled: Boolean(qs) });
  const run = () => setQs(new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString());
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const tri = (k: keyof typeof f, label: string) => (
    <Field label={label}>
      <Select value={f[k]} onChange={set(k)}>
        <option value="">Semua</option>
        <option value="true">Ya</option>
        <option value="false">Tidak</option>
      </Select>
    </Field>
  );
  const r = q.data;
  return (
    <Card>
      <CardHeader title="Kueri Performa Historis" subtitle='mis. "Bagaimana performa sinyal BELI BTC saat RSI 50–70, MACD bullish, dan harga > MA50?"' />
      <CardBody>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Simbol">
            <Input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Timeframe">
            <Select value={f.timeframe} onChange={set('timeframe')}>
              {['15m', '1h', '4h', '1d'].map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sinyal">
            <Select value={f.signal} onChange={set('signal')}>
              <option value="">Semua</option>
              {['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'].map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="RSI min">
            <Input type="number" value={f.rsiMin} onChange={set('rsiMin')} />
          </Field>
          <Field label="RSI max">
            <Input type="number" value={f.rsiMax} onChange={set('rsiMax')} />
          </Field>
          <Field label="MACD">
            <Select value={f.macd} onChange={set('macd')}>
              <option value="">Semua</option>
              <option value="bullish">Bullish</option>
              <option value="bearish">Bearish</option>
            </Select>
          </Field>
          {tri('priceAboveMa20', 'Harga > MA20')}
          {tri('priceAboveMa50', 'Harga > MA50')}
          {tri('volumeAboveAvg', 'Volume > rata-rata')}
          <Field label="Lama tahan (candle)">
            <Input type="number" min={1} max={200} value={f.horizon} onChange={set('horizon')} />
          </Field>
        </div>
        <Button className="mt-4" onClick={run} loading={q.isFetching}>
          {!q.isFetching && <Search className="h-4 w-4" />} Jalankan kueri
        </Button>
        {q.error && <Notice tone="error" className="mt-4">{(q.error as Error).message}</Notice>}
        {r && (
          <div className="mt-5 rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs text-ink-3">{r.candlesScanned} candle dipindai</span>
              <ReliabilityBadge reliability={r.reliability} n={r.sampleSize} />
            </div>
            {r.warning && <Notice tone="warn" className="mb-3">{r.warning}</Notice>}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Jumlah sampel" value={r.sampleSize} />
              <Stat label="Win rate" value={r.winRate !== null ? `${r.winRate}%` : '–'} />
              <Stat label="Rata-rata return" value={<Change value={r.averageReturn} />} />
              <Stat label="Median return" value={<Change value={r.medianReturn} />} />
              <Stat label="Return terbaik" value={<Change value={r.bestReturn} />} />
              <Stat label="Return terburuk" value={<Change value={r.worstReturn} />} />
              <Stat label="Rata-rata lama tahan" value={fmtDuration(r.averageHoldingMs)} />
              <Stat label="Max drawdown (dalam trade)" value={<Change value={r.maxDrawdown} />} />
            </div>
            <p className="mt-3 text-[11px] text-ink-3">{r.note}</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function History() {
  const [filters, setFilters] = useState<Record<string, string>>({ symbol: '', signal: '', status: '' });
  const signals = useSignals({ signal: filters.signal || undefined, status: filters.status || undefined, limit: '200' });
  const perf = usePerformance();
  const items = (signals.data?.items ?? []).filter((s) => !filters.symbol || s.symbol.includes(filters.symbol.toUpperCase()));
  return (
    <div className="space-y-5">
      <PageHeader title="Riwayat Sinyal" description="Setiap sinyal yang terbit pada candle yang sudah close, lengkap dengan snapshot fitur dan hasil yang dilacak." />
      {perf.data && !perf.data.unavailable && <PerformanceDashboard p={perf.data} />}
      {perf.data?.unavailable && <Notice tone="warn">{perf.data.message}</Notice>}
      <Card>
        <CardHeader
          title="Sinyal"
          subtitle={`${signals.data?.total ?? 0} total`}
          action={
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Koin" className="h-8 w-24" value={filters.symbol} onChange={(e) => setFilters({ ...filters, symbol: e.target.value })} />
              <Select className="h-8 w-32" value={filters.signal} onChange={(e) => setFilters({ ...filters, signal: e.target.value })}>
                <option value="">Semua sinyal</option>
                {['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'].map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </Select>
              <Select className="h-8 w-32" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">Semua hasil</option>
                {['PENDING', 'OPEN', 'TARGET_HIT', 'STOP_HIT', 'TIMEOUT', 'INVALIDATED', 'AMBIGUOUS'].map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        {items.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Tanggal</TH>
                <TH>Simbol</TH>
                <TH>TF</TH>
                <TH>Sinyal</TH>
                <TH className="text-right">Skor</TH>
                <TH className="text-right">
                  <ConfidenceHeader />
                </TH>
                <TH className="text-right">Masuk</TH>
                <TH className="text-right">Target</TH>
                <TH className="text-right">Stop</TH>
                <TH>Hasil</TH>
                <TH className="text-right">Return</TH>
                <TH className="text-right">MFE / MAE</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((s) => (
                <TR key={s.id}>
                  <TD>{fmtDate(s.date)}</TD>
                  <TD className="font-semibold">{baseAsset(s.symbol)}</TD>
                  <TD>{s.timeframe.toUpperCase()}</TD>
                  <TD>
                    <SignalBadge signal={s.signal} />
                  </TD>
                  <TD className="text-right">{s.technicalScore.toFixed(0)}</TD>
                  <TD className="text-right">
                    <Confidence value={s.aiConfidence} />
                  </TD>
                  <TD className="text-right">{fmtPrice(s.entry)}</TD>
                  <TD className="text-right">{fmtPrice(s.target)}</TD>
                  <TD className="text-right">{fmtPrice(s.stop)}</TD>
                  <TD title={s.note ?? ''}>
                    <Badge tone={RESULT_TONE[s.result ?? ''] ?? 'neutral'}>{RESULT_LABEL[s.result ?? ''] ?? (s.result ?? '–')}</Badge>
                  </TD>
                  <TD className="text-right">
                    <Change value={s.returnPercent} />
                  </TD>
                  <TD className="text-right text-xs">
                    {s.mfe !== null ? (
                      <>
                        <span className="text-up">{s.mfe.toFixed(1)}%</span> / <span className="text-down">{s.mae?.toFixed(1)}%</span>
                      </>
                    ) : (
                      '–'
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={<HistoryIcon className="h-8 w-8" />} title="Belum ada sinyal">
            Sinyal dicatat oleh job analisa (setiap 15 menit) pada candle yang sudah close.
          </EmptyState>
        )}
      </Card>
      <HistoricalQuery />
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronDown, ChevronRight, History, Play, Radar } from 'lucide-react';
import { api } from '@/services/api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Notice, PageHeader, Stat } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PickCard, TAG_STYLE, type Pick } from './Planner';
import { baseAsset, fmtDate, fmtPct, fmtPriceSym, fmtUsd } from '@/utils/format';
import { cn } from '@/utils/cn';

type Tag = 'Harian' | 'Swing' | 'Posisi';

interface StyleSummary {
  scanned: number;
  buySignals: number;
  picks: number;
  capitalUsed: number;
  cashReserve: number;
  totalProfitIfAllTargets: number;
  totalLossIfAllStops: number;
  totalExpectedValue: number;
}

interface StyleResult {
  tag: Tag;
  timeframe: string;
  summary: StyleSummary | null;
  picks: (Pick & { tag: Tag })[];
  notRecommended: number;
  error: string | null;
}

interface ScenarioRun {
  id: string;
  createdAt: string;
  trigger: string;
  status: 'OK' | 'FAILED';
  fxRate: number | null;
  capitalIdr: number;
  styles: StyleResult[];
  error: string | null;
  durationMs: number | null;
}

interface ScenarioState {
  config: { capitalIdr: number; risk: string; maxPositions: number; universe: string; intervalHours: number };
  running: boolean;
  nextRunAt: string;
  latest: ScenarioRun | null;
}

interface Totals {
  closed: number;
  open: number;
  targetHit: number;
  stopHit: number;
  timeout: number;
  realizedPnl: number;
  openPnl: number;
}

interface RunListItem {
  id: string;
  createdAt: string;
  trigger: string;
  status: string;
  error: string | null;
  picksByTag: Record<string, number>;
  evaluation: Totals | null;
}

interface Outcome {
  symbol: string;
  tag: Tag;
  status: string;
  entry: number;
  target: number;
  stop: number;
  exitPrice: number | null;
  lastPrice: number | null;
  pnl: number | null;
  pnlPct: number | null;
  positionValue: number;
}

const STATUS_LABEL: Record<string, { label: string; tone: 'up' | 'down' | 'blue' | 'neutral' | 'warn' }> = {
  TARGET_HIT: { label: 'Target tercapai', tone: 'up' },
  STOP_HIT: { label: 'Kena cut loss', tone: 'down' },
  TIMEOUT: { label: 'Dijual (waktu habis)', tone: 'neutral' },
  OPEN: { label: 'Berjalan', tone: 'blue' },
  PENDING: { label: 'Menunggu candle', tone: 'blue' },
  AMBIGUOUS: { label: 'Ambigu', tone: 'warn' },
};

const TRIGGER_LABEL: Record<string, string> = { schedule: 'Terjadwal', manual: 'Manual', startup: 'Susulan' };

function TagChip({ tag }: { tag: string }) {
  return <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', TAG_STYLE[tag] ?? 'bg-slate-100 text-ink-2')}>{tag}</span>;
}

function RunDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['scenario-run', id], queryFn: () => api<ScenarioRun & { evaluation: { outcomes: Outcome[]; totals: Totals } | null }>(`/api/scenario/runs/${id}`) });
  if (q.isLoading) return <p className="px-5 py-3 text-xs text-ink-3">Mengecek hasil…</p>;
  const outcomes = q.data?.evaluation?.outcomes ?? [];
  if (!outcomes.length) return <p className="px-5 py-3 text-xs text-ink-3">Scan ini tidak menghasilkan rekomendasi beli.</p>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Koin</TH>
          <TH>Gaya</TH>
          <TH className="text-right">Beli</TH>
          <TH className="text-right">Target</TH>
          <TH className="text-right">Cut loss</TH>
          <TH>Status</TH>
          <TH className="text-right">Harga jual / terakhir</TH>
          <TH className="text-right">Untung/rugi</TH>
        </TR>
      </THead>
      <TBody>
        {outcomes.map((o, i) => {
          const st = STATUS_LABEL[o.status] ?? { label: o.status, tone: 'neutral' as const };
          return (
            <TR key={`${o.symbol}-${o.tag}-${i}`}>
              <TD className="font-semibold">{baseAsset(o.symbol)}</TD>
              <TD>
                <TagChip tag={o.tag} />
              </TD>
              <TD className="text-right">{fmtPriceSym(o.entry)}</TD>
              <TD className="text-right text-up">{fmtPriceSym(o.target)}</TD>
              <TD className="text-right text-down">{fmtPriceSym(o.stop)}</TD>
              <TD>
                <Badge tone={st.tone}>{st.label}</Badge>
              </TD>
              <TD className="text-right">{fmtPriceSym(o.exitPrice ?? o.lastPrice)}</TD>
              <TD className={cn('text-right font-medium', (o.pnl ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                {o.pnl !== null ? `${o.pnl >= 0 ? '+' : ''}${fmtUsd(o.pnl)} (${fmtPct(o.pnlPct)})` : '–'}
                {(o.status === 'OPEN' || o.status === 'PENDING') && <span className="block text-[10px] font-normal text-ink-3">belum terealisasi</span>}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

function RunHistory() {
  const q = useQuery({ queryKey: ['scenario-runs'], queryFn: () => api<RunListItem[]>('/api/scenario/runs?limit=20'), refetchInterval: 5 * 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  const runs = q.data ?? [];
  const closedPnl = runs.reduce((a, r) => a + (r.evaluation?.realizedPnl ?? 0), 0);
  const counts = runs.reduce((a, r) => ({ t: a.t + (r.evaluation?.targetHit ?? 0), s: a.s + (r.evaluation?.stopHit ?? 0), w: a.w + (r.evaluation?.timeout ?? 0) }), { t: 0, s: 0, w: 0 });
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <History className="h-4 w-4" /> Riwayat scan & hasilnya
          </span>
        }
        subtitle="Setiap rekomendasi dilacak dari waktu scan: apakah harga menyentuh target, cut loss, atau batas waktu lebih dulu (paper trading, tanpa order nyata)."
      />
      {runs.length > 0 && (
        <CardBody className="grid grid-cols-2 gap-4 border-b border-border pb-4 sm:grid-cols-4">
          <Stat label="Scan tersimpan" value={runs.length} />
          <Stat label="Target tercapai" value={<span className="text-up">{counts.t}</span>} />
          <Stat label="Kena cut loss" value={<span className="text-down">{counts.s}</span>} sub={`${counts.w} dijual karena waktu habis`} />
          <Stat label="Total untung/rugi terealisasi" value={<span className={closedPnl >= 0 ? 'text-up' : 'text-down'}>{closedPnl >= 0 ? '+' : ''}{fmtUsd(closedPnl)}</span>} sub="Dari posisi yang sudah selesai" />
        </CardBody>
      )}
      {runs.length === 0 ? (
        <EmptyState icon={<History className="h-8 w-8" />} title="Belum ada riwayat scan" />
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((r) => (
            <li key={r.id}>
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left text-[13px] hover:bg-bg">
                {open === r.id ? <ChevronDown className="h-4 w-4 text-ink-3" /> : <ChevronRight className="h-4 w-4 text-ink-3" />}
                <span className="num font-medium">{fmtDate(r.createdAt)}</span>
                <Badge tone="neutral">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</Badge>
                {r.status === 'FAILED' ? (
                  <Badge tone="down">Gagal</Badge>
                ) : (
                  <span className="flex gap-1.5">
                    {Object.entries(r.picksByTag).map(([tag, n]) => (
                      <span key={tag} className="text-xs text-ink-2">
                        <TagChip tag={tag} /> {n}
                      </span>
                    ))}
                  </span>
                )}
                {r.evaluation && (
                  <span className="ml-auto flex items-center gap-3 text-xs">
                    <span className="text-up">{r.evaluation.targetHit} target</span>
                    <span className="text-down">{r.evaluation.stopHit} cut loss</span>
                    <span className="text-ink-3">{r.evaluation.open} berjalan</span>
                    <span className={cn('num font-semibold', r.evaluation.realizedPnl + r.evaluation.openPnl >= 0 ? 'text-up' : 'text-down')}>
                      {fmtUsd(r.evaluation.realizedPnl + r.evaluation.openPnl)}
                    </span>
                  </span>
                )}
              </button>
              {open === r.id && (r.status === 'FAILED' ? <p className="px-5 pb-3 text-xs text-down">{r.error}</p> : <RunDetail id={r.id} />)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Scenario() {
  const qc = useQueryClient();
  const [tag, setTag] = useState<Tag | 'Semua'>('Semua');
  const q = useQuery({
    queryKey: ['scenario'],
    queryFn: () => api<ScenarioState>('/api/scenario'),
    refetchInterval: (query) => (query.state.data?.running ? 5000 : 60_000),
  });
  const scan = useMutation({
    mutationFn: () => api('/api/scenario/run', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenario'] });
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['scenario-runs'] }), 90_000);
    },
  });
  const d = q.data;
  const latest = d?.latest;
  const styles = latest?.styles ?? [];
  const picks = styles.flatMap((s) => s.picks.map((p) => ({ ...p, tag: s.tag }))).filter((p) => tag === 'Semua' || p.tag === tag);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Skenario Otomatis"
        description={`Rencana Trading dijalankan otomatis setiap ${d?.config.intervalHours ?? 6} jam untuk semua gaya trading, lalu hasil setiap rekomendasi dilacak.`}
        actions={
          <Button onClick={() => scan.mutate()} loading={scan.isPending} disabled={d?.running}>
            {!scan.isPending && <Play className="h-4 w-4" />} {d?.running ? 'Sedang memindai…' : 'Scan sekarang'}
          </Button>
        }
      />
      {q.error && <Notice tone="error">{(q.error as Error).message}</Notice>}
      {scan.error && <Notice tone="error">{(scan.error as Error).message}</Notice>}

      {d && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="blue">Modal Rp {d.config.capitalIdr.toLocaleString('id-ID')} per gaya</Badge>
            <Badge tone="neutral">Profil {d.config.risk}</Badge>
            <Badge tone="neutral">Maks. {d.config.maxPositions} koin</Badge>
            <Badge tone="neutral">{d.config.universe === 'top' ? '20 koin teraktif + watchlist' : 'Koin dashboard + watchlist'}</Badge>
            <span className="text-ink-3">Tag:</span>
            <TagChip tag="Harian" />
            <span className="text-ink-3">1J</span>
            <TagChip tag="Swing" />
            <span className="text-ink-3">4J</span>
            <TagChip tag="Posisi" />
            <span className="text-ink-3">1 hari</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Scan terakhir" value={latest ? fmtDate(latest.createdAt) : '–'} sub={latest ? `${TRIGGER_LABEL[latest.trigger] ?? latest.trigger} · ${Math.round((latest.durationMs ?? 0) / 1000)} detik` : undefined} />
            <Stat
              label="Scan berikutnya"
              value={
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-4 w-4 text-ink-3" />
                  {fmtDate(d.nextRunAt)}
                </span>
              }
            />
            <Stat label="Kurs saat scan" value={latest?.fxRate ? `Rp ${latest.fxRate.toLocaleString('id-ID', { maximumFractionDigits: 0 })}` : '–'} sub="per 1 USDT" />
            <Stat label="Total rekomendasi" value={styles.reduce((a, s) => a + s.picks.length, 0)} sub={styles.map((s) => `${s.tag} ${s.picks.length}`).join(' · ')} />
          </div>
          {d.running && <Notice tone="info" className="mt-4">Scan sedang berjalan (±1–2 menit). Halaman akan diperbarui otomatis.</Notice>}
        </Card>
      )}

      {latest && (
        <div className="grid gap-4 md:grid-cols-3">
          {styles.map((s) => (
            <Card key={s.tag} className={cn('cursor-pointer p-4 transition-shadow hover:shadow-md', tag === s.tag && 'ring-2 ring-primary')} onClick={() => setTag(tag === s.tag ? 'Semua' : s.tag)}>
              <div className="flex items-center justify-between">
                <TagChip tag={s.tag} />
                <span className="text-xs text-ink-3">timeframe {s.timeframe.toUpperCase()}</span>
              </div>
              {s.summary ? (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Stat label="Rekomendasi" value={s.picks.length} sub={`${s.summary.buySignals} sinyal beli dari ${s.summary.scanned} koin`} />
                  <Stat label="Modal dipakai" value={fmtUsd(s.summary.capitalUsed)} />
                  <Stat label="Untung jika target" value={<span className="text-up">+{fmtUsd(s.summary.totalProfitIfAllTargets)}</span>} />
                  <Stat label="Rugi jika cut loss" value={<span className="text-down">{fmtUsd(s.summary.totalLossIfAllStops)}</span>} />
                </div>
              ) : (
                <p className="mt-3 text-xs text-down">Gagal: {s.error}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {latest ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Rekomendasi scan terakhir</h2>
            <div className="flex gap-1.5">
              {(['Semua', 'Harian', 'Swing', 'Posisi'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTag(t)}
                  aria-pressed={tag === t}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium', tag === t ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-ink-2 hover:bg-bg')}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {picks.length ? (
            picks.map((p) => <PickCard key={`${p.tag}-${p.symbol}`} p={p} tag={p.tag} />)
          ) : (
            <Card>
              <EmptyState icon={<Radar className="h-8 w-8" />} title="Tidak ada koin yang layak dibeli pada scan ini">
                Untuk gaya {tag === 'Semua' ? 'mana pun' : tag}, tidak ada setup beli yang secara historis menguntungkan setelah biaya. Menahan kas juga keputusan yang valid.
              </EmptyState>
            </Card>
          )}
        </div>
      ) : (
        d && (
          <Card>
            <EmptyState icon={<Radar className="h-8 w-8" />} title="Belum ada scan">
              Scan pertama berjalan otomatis sesuai jadwal, atau tekan <b>Scan sekarang</b>.
            </EmptyState>
          </Card>
        )
      )}

      <RunHistory />
      <Notice tone="warn" title="Penting">
        Skenario ini adalah simulasi (paper trading) — tidak ada order yang dieksekusi. Setiap gaya trading disimulasikan terpisah dengan modal penuh. Hasil historis dan estimasi bukan jaminan keuntungan.
      </Notice>
    </div>
  );
}

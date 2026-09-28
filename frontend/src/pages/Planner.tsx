import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, CircleDollarSign, Clock, LineChart, ShieldAlert, Sparkles, Target, TriangleAlert } from 'lucide-react';
import { api } from '@/services/api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Segmented, Select, Stat } from '@/components/ui/primitives';
import { RiskBadge } from '@/components/ui/domain';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { baseAsset, currencySymbol, displayCurrency, fmtDate, fmtNum, fmtPct, fmtPriceSym, fmtUsd, fromDisplay } from '@/utils/format';
import { cn } from '@/utils/cn';

type Risk = 'konservatif' | 'moderat' | 'agresif';
type Tf = '1h' | '4h' | '1d';

interface PlanHistory {
  sampleSize: number;
  targetHit: number;
  stopHit: number;
  timeout: number;
  hitRate: number | null;
  medianCandlesToTarget: number | null;
  expectancyNetPct: number | null;
  averageTimeoutReturnPct: number | null;
  worstReturnPct: number | null;
  reliability: string;
}

interface Pick {
  rank: number;
  symbol: string;
  signal: string;
  signalLabel: string;
  technicalScore: number;
  entry: number;
  target: number;
  stop: number;
  targetPct: number;
  stopPct: number;
  riskReward: number | null;
  quantity: number;
  positionValue: number;
  profitIfTarget: number;
  lossIfStop: number;
  expectedValue: number;
  estimatedHoldMs: number | null;
  maxHoldMs: number;
  history: PlanHistory;
  reasons: string[];
  risks: string[];
  riskLevel: string;
  notes: string[];
}

interface PlanResponse {
  generatedAt: string;
  source: string;
  input: { capital: number; risk: Risk; timeframe: Tf; maxPositions: number };
  summary: { scanned: number; buySignals: number; picks: number; capitalUsed: number; cashReserve: number; totalProfitIfAllTargets: number; totalLossIfAllStops: number; totalExpectedValue: number; riskPerTrade: number };
  picks: Pick[];
  notRecommended: { symbol: string; signalLabel: string; technicalScore: number; reason: string; expectancyNetPct: number | null }[];
  sellSuggestions: { symbol: string; quantity: number; signalLabel: string; technicalScore: number; price: number; unrealizedPnl: number | null; unrealizedPnlPct: number | null; reasons: string[] }[];
  failed: string[];
  disclaimer: string;
}

const RISK_INFO: Record<Risk, string> = {
  konservatif: 'Maks. rugi ±0,5% modal per posisi',
  moderat: 'Maks. rugi ±1% modal per posisi',
  agresif: 'Maks. rugi ±2% modal per posisi',
};

const STYLE: { value: Tf; label: string; hint: string }[] = [
  { value: '1h', label: 'Harian (1J)', hint: 'Tahan beberapa jam – 1 hari' },
  { value: '4h', label: 'Swing (4J)', hint: 'Tahan beberapa hari' },
  { value: '1d', label: 'Posisi (1H)', hint: 'Tahan beberapa minggu' },
];

/** Durasi dalam Bahasa Indonesia, mis. "~9 jam", "~5 hari". */
function durasi(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '–';
  const jam = ms / 3_600_000;
  if (jam < 1) return `~${Math.round(ms / 60_000)} menit`;
  if (jam < 48) return `~${Math.round(jam)} jam`;
  const hari = jam / 24;
  return hari < 14 ? `~${Math.round(hari)} hari` : `~${Math.round(hari / 7)} minggu`;
}

function PickCard({ p }: { p: Pick }) {
  const h = p.history;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-bg/60 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">#{p.rank}</span>
          <div>
            <Link to={`/analysis/${p.symbol}`} className="text-base font-semibold hover:text-primary">
              {baseAsset(p.symbol)}
            </Link>
            <div className="text-xs text-ink-3">
              Sinyal {p.signalLabel} · skor {p.technicalScore.toFixed(0)}/100
            </div>
          </div>
        </div>
        <RiskBadge level={p.riskLevel} />
      </div>
      <CardBody className="pt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-primary/20 bg-primary-soft/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <CircleDollarSign className="h-3.5 w-3.5" /> Beli di sekitar
            </div>
            <div className="num mt-1 text-lg font-semibold">{fmtPriceSym(p.entry)}</div>
            <div className="num text-xs text-ink-2">
              {fmtNum(p.quantity, p.quantity >= 100 ? 0 : 6)} {baseAsset(p.symbol)} ≈ <b>{fmtUsd(p.positionValue)}</b>
            </div>
          </div>
          <div className="rounded-lg border border-up/30 bg-up-soft/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-up">
              <ArrowUpRight className="h-3.5 w-3.5" /> Jual (ambil untung) di
            </div>
            <div className="num mt-1 text-lg font-semibold">{fmtPriceSym(p.target)}</div>
            <div className="num text-xs text-up">
              {fmtPct(p.targetPct)} · untung <b>+{fmtUsd(p.profitIfTarget)}</b>
            </div>
          </div>
          <div className="rounded-lg border border-down/30 bg-down-soft/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-down">
              <ArrowDownRight className="h-3.5 w-3.5" /> Cut loss di
            </div>
            <div className="num mt-1 text-lg font-semibold">{fmtPriceSym(p.stop)}</div>
            <div className="num text-xs text-down">
              {fmtPct(p.stopPct)} · rugi <b>{fmtUsd(p.lossIfStop)}</b>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Estimasi lama tahan" tip="Median waktu sampai target tercapai pada kasus historis yang berhasil." value={<span className="inline-flex items-center gap-1"><Clock className="h-4 w-4 text-ink-3" />{durasi(p.estimatedHoldMs)}</span>} sub={`Jual paling lambat ${durasi(p.maxHoldMs).replace('~', '')}`} />
          <Stat label="Target tercapai (historis)" value={h.hitRate !== null ? `${h.hitRate}%` : '–'} sub={`${h.targetHit} target · ${h.stopHit} stop · ${h.timeout} waktu habis`} />
          <Stat label="Rata-rata hasil / trade" tip="Rata-rata hasil bersih rencana yang sama pada semua sinyal BELI historis, setelah fee & slippage." value={<span className={(h.expectancyNetPct ?? 0) >= 0 ? 'text-up' : 'text-down'}>{fmtPct(h.expectancyNetPct, 2)}</span>} sub={`dari ${h.sampleSize} kasus historis`} />
          <Stat label="Estimasi nilai harapan" tip="Ukuran posisi × rata-rata hasil historis. Perkiraan, bukan janji." value={<span className={p.expectedValue >= 0 ? 'text-up' : 'text-down'}>{p.expectedValue >= 0 ? '+' : ''}{fmtUsd(p.expectedValue)}</span>} sub={p.riskReward ? `Rasio untung:rugi 1 : ${p.riskReward}` : undefined} />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-up">Alasan</div>
            <ul className="space-y-1 text-[13px] text-ink-2">
              {p.reasons.map((r) => (
                <li key={r}>✓ {r}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-down">Risiko</div>
            <ul className="space-y-1 text-[13px] text-ink-2">
              {p.risks.length ? p.risks.map((r) => <li key={r}>⚠ {r}</li>) : <li className="text-ink-3">Tidak ada risiko teknikal menonjol.</li>}
            </ul>
          </div>
        </div>
        {p.notes.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg bg-bg p-3 text-xs text-ink-2">
            {p.notes.map((n) => (
              <li key={n} className="flex gap-1.5">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> {n}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 text-right">
          <Link to={`/analysis/${p.symbol}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            <LineChart className="h-3.5 w-3.5" /> Lihat chart & analisa lengkap
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

export default function Planner() {
  const idr = displayCurrency() === 'IDR';
  const [capital, setCapital] = useState(idr ? 10_000_000 : 1000);
  const [risk, setRisk] = useState<Risk>('moderat');
  const [tf, setTf] = useState<Tf>('4h');
  const [maxPositions, setMaxPositions] = useState(3);
  const [universe, setUniverse] = useState<'top' | 'tracked'>('top');
  const plan = useMutation({
    mutationFn: () => api<PlanResponse>('/api/planner', { method: 'POST', json: { capital: fromDisplay(capital), risk, timeframe: tf, maxPositions, universe } }),
  });
  const d = plan.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Rencana Trading"
        description="Masukkan modal Anda. Sistem memindai pasar, memilih koin dengan setup beli terbaik, lalu memberi harga beli, target jual, cut loss, lama tahan, dan estimasi untung/rugi berdasarkan data historis."
      />
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2 text-primary"><Target className="h-4 w-4" /> Buat rencana</span>} />
        <CardBody>
          <form
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              plan.mutate();
            }}
          >
            <Field label={`Modal (${currencySymbol()})`} hint={idr ? `Rp ${capital.toLocaleString('id-ID')}` : undefined}>
              <Input type="number" min={1} step="any" required value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
            </Field>
            <Field label="Profil risiko" hint={RISK_INFO[risk]}>
              <Select value={risk} onChange={(e) => setRisk(e.target.value as Risk)}>
                <option value="konservatif">Konservatif</option>
                <option value="moderat">Moderat</option>
                <option value="agresif">Agresif</option>
              </Select>
            </Field>
            <Field label="Gaya trading" hint={STYLE.find((s) => s.value === tf)?.hint}>
              <Segmented<Tf> value={tf} onChange={setTf} options={STYLE.map((s) => ({ value: s.value, label: s.label }))} className="flex w-full" />
            </Field>
            <Field label="Maks. jumlah koin">
              <Select value={maxPositions} onChange={(e) => setMaxPositions(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} koin
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cakupan pasar">
              <Select value={universe} onChange={(e) => setUniverse(e.target.value as 'top' | 'tracked')}>
                <option value="top">20 koin teraktif + watchlist</option>
                <option value="tracked">Koin dashboard + watchlist</option>
              </Select>
            </Field>
            <div className="md:col-span-2 xl:col-span-5">
              <Button type="submit" loading={plan.isPending} className="w-full sm:w-auto">
                {!plan.isPending && <Sparkles className="h-4 w-4" />} {plan.isPending ? 'Memindai pasar & mensimulasikan histori…' : 'Buat Rencana Trading'}
              </Button>
            </div>
          </form>
          {plan.error && <Notice tone="error" className="mt-4">{(plan.error as Error).message}</Notice>}
        </CardBody>
      </Card>

      {d && (
        <>
          <Card className="p-5">
            <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Koin dipindai" value={d.summary.scanned} sub={`${d.summary.buySignals} sinyal beli`} />
              <Stat label="Modal dipakai" value={fmtUsd(d.summary.capitalUsed)} sub={`Cadangan kas ${fmtUsd(d.summary.cashReserve)}`} />
              <Stat label="Untung jika semua target" value={<span className="text-up">+{fmtUsd(d.summary.totalProfitIfAllTargets)}</span>} />
              <Stat label="Rugi jika semua cut loss" value={<span className="text-down">{fmtUsd(d.summary.totalLossIfAllStops)}</span>} />
              <Stat label="Estimasi nilai harapan" tip="Jumlah estimasi berdasarkan rata-rata hasil historis tiap rencana." value={<span className={d.summary.totalExpectedValue >= 0 ? 'text-up' : 'text-down'}>{d.summary.totalExpectedValue >= 0 ? '+' : ''}{fmtUsd(d.summary.totalExpectedValue)}</span>} />
              <Stat label="Risiko per posisi" value={fmtUsd(d.summary.riskPerTrade)} sub={`Dibuat ${fmtDate(d.generatedAt)}`} />
            </div>
          </Card>

          {d.picks.length ? (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Rekomendasi beli</h2>
              {d.picks.map((p) => (
                <PickCard key={p.symbol} p={p} />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState icon={<ShieldAlert className="h-8 w-8" />} title="Saat ini tidak ada koin yang layak dibeli">
                Tidak ada setup beli yang secara historis menguntungkan setelah biaya pada gaya trading ini. Menahan kas juga keputusan yang valid. Coba gaya trading lain atau cek lagi setelah candle berikutnya.
              </EmptyState>
            </Card>
          )}

          {d.sellSuggestions.length > 0 && (
            <Card>
              <CardHeader title={<span className="text-down">Pertimbangkan jual dari portfolio</span>} subtitle="Koin yang Anda pegang dengan sinyal SELL saat ini" />
              <Table>
                <THead>
                  <TR>
                    <TH>Koin</TH>
                    <TH>Sinyal</TH>
                    <TH className="text-right">Jumlah</TH>
                    <TH className="text-right">Harga</TH>
                    <TH className="text-right">Untung/rugi belum terealisasi</TH>
                    <TH>Alasan</TH>
                  </TR>
                </THead>
                <TBody>
                  {d.sellSuggestions.map((s) => (
                    <TR key={s.symbol}>
                      <TD className="font-semibold">{baseAsset(s.symbol)}</TD>
                      <TD>
                        <Badge tone="down">{s.signalLabel}</Badge>
                      </TD>
                      <TD className="text-right">{fmtNum(s.quantity, 6)}</TD>
                      <TD className="text-right">{fmtPriceSym(s.price)}</TD>
                      <TD className={cn('text-right', (s.unrealizedPnl ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                        {fmtUsd(s.unrealizedPnl)} ({fmtPct(s.unrealizedPnlPct)})
                      </TD>
                      <TD className="max-w-xs truncate text-xs text-ink-3" title={s.reasons.join(', ')}>
                        {s.reasons.join(', ')}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}

          <Card>
            <CardHeader title="Tidak direkomendasikan" subtitle="Koin lain yang dipindai dan alasannya" />
            <Table>
              <THead>
                <TR>
                  <TH>Koin</TH>
                  <TH>Sinyal</TH>
                  <TH className="text-right">Skor</TH>
                  <TH>Alasan</TH>
                </TR>
              </THead>
              <TBody>
                {d.notRecommended.map((n) => (
                  <TR key={n.symbol}>
                    <TD className="font-semibold">
                      <Link to={`/analysis/${n.symbol}`} className="hover:text-primary">
                        {baseAsset(n.symbol)}
                      </Link>
                    </TD>
                    <TD>{n.signalLabel}</TD>
                    <TD className="text-right">{n.technicalScore.toFixed(0)}</TD>
                    <TD className="text-xs whitespace-normal text-ink-2">{n.reason}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {d.failed.length > 0 && <p className="px-5 py-3 text-xs text-warn">Gagal dipindai: {d.failed.join(', ')}</p>}
          </Card>
          <Notice tone="warn" title="Penting">
            {d.disclaimer}
          </Notice>
        </>
      )}
    </div>
  );
}

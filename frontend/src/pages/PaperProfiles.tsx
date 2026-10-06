import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/services/api';
import { Badge, Card, CardBody, CardHeader, Notice, Segmented } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { baseAsset, fmtDate } from '@/utils/format';
import { cn } from '@/utils/cn';
import { AXIS, fmtRp, MONEY_CODES, pct, PROFILE_LABEL, PROFILES, REJECT_LABEL, tone, type ProfileId } from './paperFormat';

/* ---------- live: the three accounts side by side ---------- */
interface Utilization { marks: number; avgInvestedPct: number; maxInvestedPct: number; avgInvested: number; maxInvested: number; avgCashPct: number; hoursInvestedPct: number }
interface CompareRow {
  profile: ProfileId;
  funnel: { signals: number; ruleRejected: number; accepted: number; acceptedPct: number; moneyRejected: number; entered: number };
  reasons: { code: string; label: string; n: number; primary: number }[];
  stats: { trades: number; targetPct: number; cutlossPct: number; timeoutPct: number; expectancyPct: number; profitFactor: number | null };
  equity: number;
  totalPnl: number;
  returnPct: number;
  maxDrawdownPct: number;
  openPositions: number;
  cash: number;
  invested: number;
  utilization: Utilization;
}
interface Compare { since: string; scans: { n: number; withSignal: number; signals: number }; profiles: CompareRow[] }

/** Plain-language verdict for a profile that hardly trades: no opportunity, or a filter that is too strict? */
function selectivityNote(c: Compare, r: CompareRow): string | null {
  const f = r.funnel;
  if (c.scans.n < 6) return null;
  if (!c.scans.signals) return `${PROFILE_LABEL[r.profile]}: belum ada signal sama sekali dalam ${c.scans.n} scan — pasar belum memberi peluang, bukan filter yang terlalu ketat.`;
  if (f.entered > 0 && r.utilization.avgInvestedPct >= 5) return null;
  const top = r.reasons.find((x) => !MONEY_CODES.has(x.code));
  const money = r.reasons.filter((x) => MONEY_CODES.has(x.code)).reduce((a, x) => a + x.n, 0);
  if (f.accepted && money >= f.accepted / 2) return `${PROFILE_LABEL[r.profile]}: ${f.accepted} signal lolos filter tapi ${money} ditolak money management (cash/exposure/posisi) — kapasitas modal yang membatasi, bukan filter.`;
  return `${PROFILE_LABEL[r.profile]}: ${f.signals} signal tersedia, hanya ${f.accepted} lolos (${pct(f.acceptedPct)}); penolakan terbanyak "${top ? REJECT_LABEL[top.code] : '–'}" (${top?.n ?? 0}×). Modal rata-rata terpakai ${pct(r.utilization.avgInvestedPct)} — cek di tab Riset apakah signal yang ditolak memang ber-expectancy negatif.`;
}

export function CompareCard() {
  const [hours, setHours] = useState<'all' | '24' | '168'>('all');
  const q = useQuery({ queryKey: ['paper', 'compare', hours], queryFn: () => api<Compare>(`/api/paper/compare${hours === 'all' ? '' : `?hours=${hours}`}`), refetchInterval: 120_000 });
  const c = q.data;
  if (q.isError) return <Notice tone="error" title="Perbandingan profil tidak tersedia">{(q.error as Error).message}</Notice>;
  if (!c) return null;
  const by = Object.fromEntries(c.profiles.map((p) => [p.profile, p])) as Record<ProfileId, CompareRow>;
  const codes = [...new Set(c.profiles.flatMap((p) => p.reasons.map((r) => r.code)))].sort((a, b) => Number(MONEY_CODES.has(a)) - Number(MONEY_CODES.has(b)) || (by.AGRESIF?.reasons.find((r) => r.code === b)?.n ?? 0) - (by.AGRESIF?.reasons.find((r) => r.code === a)?.n ?? 0));
  const notes = c.profiles.map((p) => selectivityNote(c, p)).filter(Boolean) as string[];
  const rows: [string, (r: CompareRow) => React.ReactNode, string?][] = [
    ['Signal tersedia', (r) => r.funnel.signals],
    ['Lolos filter profil', (r) => `${r.funnel.accepted} (${pct(r.funnel.acceptedPct)})`],
    ['Ditolak filter', (r) => r.funnel.ruleRejected],
    ['Ditolak money management', (r) => r.funnel.moneyRejected],
    ['Dibeli', (r) => r.funnel.entered],
    ['Trade selesai', (r) => r.stats.trades],
    ['TARGET', (r) => pct(r.stats.targetPct), 'text-up'],
    ['CUTLOSS', (r) => pct(r.stats.cutlossPct), 'text-down'],
    ['Expectancy / trade', (r) => pct(r.stats.expectancyPct, 3, true)],
    ['P&L', (r) => <span className={tone(r.totalPnl)}>{fmtRp(r.totalPnl, true)} ({pct(r.returnPct, 2, true)})</span>],
    ['Max drawdown', (r) => pct(r.maxDrawdownPct, 2), 'text-down'],
    ['Capital utilization (rata-rata)', (r) => pct(r.utilization.avgInvestedPct, 1)],
    ['Invested rata-rata / maks', (r) => `${fmtRp(r.utilization.avgInvested)} / ${fmtRp(r.utilization.maxInvested)}`],
    ['Cash rata-rata', (r) => pct(r.utilization.avgCashPct, 1)],
    ['Jam dengan posisi', (r) => pct(r.utilization.hoursInvestedPct, 0)],
    ['Posisi terbuka', (r) => r.openPositions],
  ];
  return (
    <Card>
      <CardHeader
        title="Perbandingan 3 profil (live)"
        subtitle={`${c.scans.n} scan per jam · ${c.scans.withSignal} scan dengan signal · ${c.scans.signals} signal breakout. Setiap profil punya akun Rp10.000.000 sendiri.`}
        action={<Segmented value={hours} onChange={setHours} options={[{ value: '24', label: '24 jam' }, { value: '168', label: '7 hari' }, { value: 'all', label: 'Semua' }]} />}
      />
      <CardBody className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <THead><TR><TH>Signal → hasil</TH>{PROFILES.map((p) => <TH key={p.id}><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />{p.label}</TH>)}</TR></THead>
            <TBody>
              {rows.map(([k, f, cls]) => (
                <TR key={k}><TD className="text-ink-2">{k}</TD>{PROFILES.map((p) => <TD key={p.id} className={cn('num', cls)}>{by[p.id] ? f(by[p.id]) : '–'}</TD>)}</TR>
              ))}
            </TBody>
          </Table>
        </div>
        {codes.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <THead><TR><TH>Alasan penolakan (satu signal bisa punya beberapa)</TH><TH>Jenis</TH>{PROFILES.map((p) => <TH key={p.id}>{p.label}</TH>)}</TR></THead>
              <TBody>
                {codes.map((code) => (
                  <TR key={code}>
                    <TD>{REJECT_LABEL[code] ?? code}</TD>
                    <TD className="text-xs text-ink-3">{MONEY_CODES.has(code) ? 'Money mgmt' : 'Filter'}</TD>
                    {PROFILES.map((p) => {
                      const r = by[p.id]?.reasons.find((x) => x.code === code);
                      return <TD key={p.id} className="num">{r ? `${r.n}` : '–'}{r?.primary ? <span className="text-[11px] text-ink-3"> · utama {r.primary}</span> : null}</TD>;
                    })}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        {notes.length > 0 && <Notice tone="info" title="Evaluasi selektivitas">{notes.map((n) => <div key={n}>{n}</div>)}</Notice>}
      </CardBody>
    </Card>
  );
}

/* ---------- live: every signal with each profile's decision ---------- */
interface SignalRow {
  time: string;
  symbol: string;
  features: { score: number; volRatio: number; atrPct: number; breakoutAtr: number; coinRegime: string; emaUp: boolean; btcState: string; btcRet30d: number; quality: string };
  decisions: Partial<Record<ProfileId, { decision: 'ACCEPT' | 'REJECT'; stage: string; reasons: { code: string; detail: string }[] }>>;
}

export function SignalLog() {
  const q = useQuery({ queryKey: ['paper', 'signals'], queryFn: () => api<SignalRow[]>('/api/paper/signals?limit=60'), refetchInterval: 120_000 });
  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader title="Log signal: diterima / ditolak per profil" subtitle="Signal = close 1h di atas high 20 jam dengan volume ≥ 1.5x. Tidak ada baris = tidak ada peluang; baris dengan REJECT = filter/money management yang menolak." />
      <CardBody className="overflow-x-auto p-0">
        {!rows.length ? (
          <p className="p-4 text-sm text-ink-3">Belum ada signal breakout sejak profil berjalan.</p>
        ) : (
          <Table>
            <THead><TR><TH>Waktu</TH><TH>Koin</TH><TH>Skor</TH><TH>Vol · ATR · Breakout</TH><TH>Regime · BTC</TH><TH>Kualitas</TH>{PROFILES.map((p) => <TH key={p.id}>{p.label}</TH>)}</TR></THead>
            <TBody>
              {rows.map((s) => (
                <TR key={s.time + s.symbol}>
                  <TD className="num whitespace-nowrap">{fmtDate(s.time)}</TD>
                  <TD className="font-semibold">{baseAsset(s.symbol)}</TD>
                  <TD className="num">{s.features.score.toFixed(0)}</TD>
                  <TD className="num whitespace-nowrap">{s.features.volRatio.toFixed(1)}x · {s.features.atrPct.toFixed(2)}% · {s.features.breakoutAtr.toFixed(2)}</TD>
                  <TD className="whitespace-nowrap text-xs">{s.features.coinRegime}{s.features.emaUp ? '' : ' (EMA↓)'} · BTC {s.features.btcState} {pct(s.features.btcRet30d, 1, true)}</TD>
                  <TD className="text-xs">{s.features.quality === 'DI_BAWAH_MINIMUM' ? <span className="text-ink-3">di bawah minimum</span> : PROFILE_LABEL[s.features.quality as ProfileId]}</TD>
                  {PROFILES.map((p) => {
                    const d = s.decisions[p.id];
                    if (!d) return <TD key={p.id}>–</TD>;
                    return (
                      <TD key={p.id} className="min-w-[150px] align-top">
                        <Badge tone={d.decision === 'ACCEPT' ? 'up' : d.stage === 'MONEY' ? 'warn' : 'neutral'}>{d.decision === 'ACCEPT' ? 'BELI' : 'TOLAK'}</Badge>
                        {d.reasons.length > 0 && <div className="mt-0.5 text-[11px] leading-snug text-ink-3">{d.reasons.map((r) => r.detail).join(' · ')}</div>}
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

/* ---------- research: how the three profiles were derived ---------- */
type Split = 'train' | 'valid' | 'test';
type Period = Split | 'full';
interface Cell { n: number; perMonth: number; expNet: number; expGross: number; targetPct: number; cutlossPct: number }
interface EvRow { label: string; train: Cell; valid: Cell; test: Cell }
interface PRow {
  trades: number; targetPct: number; cutlossPct: number; timeoutPct: number; expectancyPct: number; profitFactor: number; returnPct: number; maxDrawdownPct: number; finalEquity: number; avgHoldH: number; longestLossStreak: number;
  perMonth: { signals: number; trades: number };
  perMonthReturnPct: number;
  funnel: { signals: number; ruleRejected: number; rulePassed: number; entered: number; moneySkipped: number; reasons: Record<string, number>; primary: Record<string, number>; money: Record<string, number> };
  acceptedPct: number; avgInvestedPct: number; maxInvestedPct: number; avgCashPct: number; hoursInvestedPct: number; feesPaid: number;
}
interface StratCfg { minVolRatio: number; regimes: string[]; btcRet30dMin: number | null; requireEmaUp: boolean; minBreakoutAtr: number; minAtrPct: number; maxAtrPct: number; tpAtr: number | null; slAtr: number; maxHoldH: number }
interface MoneyCfg { riskPerTrade: number; maxPerCoin: number; maxPositions: number; cashReserve: number; maxExposure: number; maxClusterExposure: number }
interface ProfilesResearchData {
  feeRate: number;
  profiles: Record<ProfileId, { strategy: StratCfg; money: MoneyCfg }>;
  results: Record<ProfileId, { fee: Record<Period, PRow>; noFee: Record<Period, PRow> }>;
  equity: Record<ProfileId, { date: string; equity: number }[]>;
  evidence: Record<string, EvRow[]>;
  marginal: EvRow[];
  baselineV2: { returnPct: number; maxDrawdownPct: number; trades: number; profitFactor: number };
  /** Rules before the 2026-10-06 revision, same universe and fee. */
  v1?: Record<ProfileId, Record<Period, { trades: number; returnPct: number; maxDrawdownPct: number; perMonthReturnPct: number }>>;
  monthly?: Record<ProfileId, { month: string; pnl: number }[]>;
  universe?: string[];
}
/** Monthly return the user aims for per profile (2026-10-06). Shown against the backtest, not promised. */
const MONTH_TARGET: Record<ProfileId, number> = { AMAN: 10, MENENGAH: 20, AGRESIF: 30 };
const PERIOD: Record<Period, string> = { train: 'Training 2025', valid: 'Validasi 2026-H1', test: 'Test 2026-Q3', full: 'Penuh 21 bulan' };
const SPLITS: Split[] = ['train', 'valid', 'test'];
const EVIDENCE_TITLE: Record<string, string> = { volume: 'Volume (rasio vs rata-rata 20 jam)', btc: 'Kondisi BTC (return 30 hari)', regime: 'Regime koin', ema: 'Momentum (EMA20 vs EMA50)', atr: 'ATR 1h (= jarak stop / risk)', breakout: 'Kekuatan breakout', score: 'Skor engine' };

function EvidenceTable({ rows }: { rows: EvRow[] }) {
  return (
    <Table>
      <THead><TR><TH>Irisan</TH>{SPLITS.map((s) => <TH key={s}>{PERIOD[s]}</TH>)}</TR></THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.label}>
            <TD className="whitespace-nowrap">{r.label}</TD>
            {SPLITS.map((s) => (
              <TD key={s} className="num whitespace-nowrap text-xs">
                <span className={cn('font-semibold', tone(r[s].expNet))}>{pct(r[s].expNet, 2, true)}</span>
                <span className="text-ink-3"> · n {r[s].n} · CL {r[s].cutlossPct.toFixed(0)}%</span>
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function ProfilesResearch() {
  const q = useQuery({ queryKey: ['paper', 'research', 'profiles'], queryFn: () => api<ProfilesResearchData>('/api/paper/research/profiles'), staleTime: Infinity });
  const [fee, setFee] = useState<'fee' | 'noFee'>('fee');
  const r = q.data;
  if (q.isError) return <Notice tone="warn" title="Riset 3 profil belum tersedia">Backend belum di-deploy ulang ke versi 3 profil ({(q.error as Error).message}).</Notice>;
  if (!r) return <p className="text-sm text-ink-3">Memuat…</p>;
  const P = PROFILES.map((p) => p.id);
  const days = [...new Set(P.flatMap((p) => r.equity[p].map((x) => x.date)))].sort();
  const eqBy = Object.fromEntries(P.map((p) => [p, new Map(r.equity[p].map((x) => [x.date, x.equity]))]));
  const curve = days.map((date) => ({ date, ...Object.fromEntries(P.map((p) => [p, eqBy[p].get(date) ?? null])) }));
  const full = (p: ProfileId) => r.results[p][fee].full;
  const thr: [string, (s: StratCfg, m: MoneyCfg) => string][] = [
    ['Volume minimum', (s) => `≥ ${s.minVolRatio}x`],
    ['Breakout minimum', (s) => (s.minBreakoutAtr ? `≥ ${s.minBreakoutAtr} ATR di atas high 20 jam` : 'close > high 20 jam')],
    ['Regime koin', (s) => s.regimes.join(' / ')],
    ['BTC (return 30 hari)', (s) => (s.btcRet30dMin === null ? 'bebas' : `> ${s.btcRet30dMin}% (BTC Bull)`)],
    ['Momentum', (s) => (s.requireEmaUp ? 'EMA20 > EMA50' : 'bebas')],
    ['ATR 1h (risk)', (s) => `${s.minAtrPct}% – ${s.maxAtrPct}% (stop ${(s.slAtr * s.minAtrPct).toFixed(1)}–${(s.slAtr * s.maxAtrPct).toFixed(1)}%)`],
    ['Skor engine minimum', () => 'tidak dipakai (tidak berhubungan dengan hasil)'],
    ['Take profit / cut loss', (s) => `${s.tpAtr === null ? 'tanpa TP' : `${s.tpAtr} ATR`} / ${s.slAtr} ATR`],
    ['Timeout', (s) => `${s.maxHoldH} jam`],
    ['Risk maks / trade', (_s, m) => `${(m.riskPerTrade * 100).toFixed(2)}% modal`],
    ['Alokasi maks / koin', (_s, m) => `${(m.maxPerCoin * 100).toFixed(0)}%`],
    ['Posisi bersamaan', (_s, m) => `${m.maxPositions}`],
    ['Cash reserve / eksposur maks', (_s, m) => `${(m.cashReserve * 100).toFixed(0)}% / ${(m.maxExposure * 100).toFixed(0)}%`],
    ['Eksposur klaster korelasi', (_s, m) => `${(m.maxClusterExposure * 100).toFixed(0)}%`],
  ];
  const outcome: [string, (x: PRow) => React.ReactNode, string?][] = [
    ['Signal tersedia / bulan', (x) => x.perMonth.signals.toFixed(0)],
    ['Lolos filter', (x) => `${x.funnel.rulePassed} (${pct(x.acceptedPct)})`],
    ['Ditolak money management', (x) => x.funnel.moneySkipped],
    ['Trade (per bulan)', (x) => `${x.trades} (${x.perMonth.trades.toFixed(0)})`],
    ['TARGET', (x) => pct(x.targetPct), 'text-up'],
    ['CUTLOSS', (x) => pct(x.cutlossPct), 'text-down'],
    ['TIMEOUT', (x) => pct(x.timeoutPct)],
    ['Expectancy / trade (net)', (x) => pct(x.expectancyPct, 3, true)],
    ['Profit factor', (x) => x.profitFactor.toFixed(2)],
    ['Return rata-rata / bulan', (x) => <span className={tone(x.perMonthReturnPct)}>{pct(x.perMonthReturnPct ?? 0, 1, true)}</span>],
    ['Return (Rp10 jt)', (x) => <span className={tone(x.returnPct)}>{pct(x.returnPct, 1, true)} → {fmtRp(x.finalEquity)}</span>],
    ['Max drawdown', (x) => pct(x.maxDrawdownPct, 1), 'text-down'],
    ['Loss streak terpanjang', (x) => x.longestLossStreak],
    ['Capital utilization rata-rata / maks', (x) => `${pct(x.avgInvestedPct, 1)} / ${pct(x.maxInvestedPct, 0)}`],
    ['Cash rata-rata', (x) => pct(x.avgCashPct, 1)],
    ['Jam dengan posisi', (x) => pct(x.hoursInvestedPct, 0)],
  ];
  const reasonCodes = [...new Set(P.flatMap((p) => [...Object.keys(full(p).funnel.reasons), ...Object.keys(full(p).funnel.money)]))];
  return (
    <div className="space-y-4">
      <Notice tone="info" title="Revisi 6 Oktober 2026: exit tanpa target tetap, 59 koin">
        <p>
          Exit lama (TP 0,75–2 ATR, 8–12 jam) ternyata merugi di 38 koin yang tidak dipakai saat menyusun aturan. Exit baru: <b>tanpa take profit</b>
          (Aman: TP jauh 12 ATR), stop 2 ATR, keluar setelah 48 jam. Exit baru lebih baik untuk setiap profil, di setiap periode, di koin lama maupun baru.
          Konsekuensinya: win rate ~30–35% — banyak cut loss kecil, dibayar oleh sedikit kenaikan besar. Hasil sangat bergantung pada beberapa lonjakan besar
          (mis. MOVR, QNT, ZEC), jadi bulan-bulan tanpa lonjakan bisa merah.
        </p>
        <p className="mt-1">
          Universe {r.universe?.length ?? 59} koin. Agresif kini memakai filter Menengah (volume ≥ 3x) dengan ukuran posisi lebih besar — volume 1,5–3x
          menambah banyak trade tapi lebih sering rugi. Irisan yang merugi setelah fee (BTC Neutral, koin SIDEWAYS, EMA20 &lt; EMA50, ATR &lt; 1%) ditolak semua profil.
        </p>
      </Notice>

      {r.v1 && r.monthly && (
        <Card>
          <CardHeader title="Aturan lama vs baru, dan target bulanan" subtitle={`Return rata-rata per bulan, fee ${(r.feeRate * 100).toFixed(1)}%/sisi, tanpa compounding · target adalah keinginan, bukan janji`} />
          <CardBody className="overflow-x-auto p-0">
            <Table>
              <THead><TR><TH>Profil</TH>{(['train', 'valid', 'test', 'full'] as Period[]).map((k) => <TH key={k}>{PERIOD[k]}: lama → baru</TH>)}<TH>Target</TH><TH>Bulan ≥ target</TH><TH>Bulan merah</TH></TR></THead>
              <TBody>
                {P.map((p) => {
                  const months = r.monthly![p].map((m) => (m.pnl / 10_000_000) * 100);
                  return (
                    <TR key={p}>
                      <TD className="font-semibold">{PROFILE_LABEL[p]}</TD>
                      {(['train', 'valid', 'test', 'full'] as Period[]).map((k) => (
                        <TD key={k} className="num whitespace-nowrap text-xs">
                          <span className={tone(r.v1![p][k].perMonthReturnPct)}>{pct(r.v1![p][k].perMonthReturnPct, 1, true)}</span> →{' '}
                          <span className={cn('font-semibold', tone(r.results[p].fee[k].perMonthReturnPct))}>{pct(r.results[p].fee[k].perMonthReturnPct, 1, true)}</span>
                          <span className="text-ink-3"> · DD {pct(r.results[p].fee[k].maxDrawdownPct, 0)}</span>
                        </TD>
                      ))}
                      <TD className="num">{MONTH_TARGET[p]}%</TD>
                      <TD className="num">{months.filter((x) => x >= MONTH_TARGET[p]).length} / {months.length}</TD>
                      <TD className="num">{months.filter((x) => x < 0).length} / {months.length}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="I. Threshold per profil (hasil backtest)" subtitle="Setiap angka punya bukti di tabel K & L" />
        <CardBody className="overflow-x-auto p-0">
          <Table>
            <THead><TR><TH>Aturan</TH>{PROFILES.map((p) => <TH key={p.id}>{p.label}</TH>)}</TR></THead>
            <TBody>
              {thr.map(([k, f]) => (
                <TR key={k}><TD className="text-ink-2">{k}</TD>{P.map((p) => <TD key={p}>{f(r.profiles[p].strategy, r.profiles[p].money)}</TD>)}</TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="J. Funnel & hasil portofolio Rp10.000.000 per profil (21 bulan)"
          subtitle="Signal tersedia → lolos filter → dibeli → TARGET / CUTLOSS → P&L → drawdown. Tanpa compounding."
          action={<Segmented value={fee} onChange={setFee} options={[{ value: 'fee', label: `Fee ${(r.feeRate * 100).toFixed(1)}%` }, { value: 'noFee', label: 'Tanpa fee' }]} />}
        />
        <CardBody className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <THead><TR><TH>Metrik</TH>{PROFILES.map((p) => <TH key={p.id}>{p.label}</TH>)}</TR></THead>
              <TBody>
                {outcome.map(([k, f, cls]) => (
                  <TR key={k}><TD className="text-ink-2">{k}</TD>{P.map((p) => <TD key={p} className={cn('num', cls)}>{f(full(p))}</TD>)}</TR>
                ))}
              </TBody>
            </Table>
          </div>
          <div className="h-64" role="img" aria-label="Kurva ekuitas tiga profil">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#eef1f6" vertical={false} />
                <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(1)} jt`} tick={AXIS} axisLine={false} tickLine={false} width={60} domain={['auto', 'auto']} />
                <Tooltip formatter={(v, name) => [fmtRp(Number(v)), PROFILE_LABEL[name as ProfileId]]} labelClassName="text-ink-3" />
                <Legend formatter={(v: string) => <span className="text-xs text-ink-2">{PROFILE_LABEL[v as ProfileId]}</span>} />
                {PROFILES.map((p) => <Line key={p.id} dataKey={p.id} stroke={p.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-ink-3">Kurva memakai fee {(r.feeRate * 100).toFixed(1)}%/sisi. Pembanding: strategi V2 pertama (satu akun) dengan fee yang sama {pct(r.baselineV2.returnPct, 1, true)}, max DD {pct(r.baselineV2.maxDrawdownPct, 1)}.</p>
          <div className="overflow-x-auto">
            <Table>
              <THead><TR><TH>Periode</TH>{PROFILES.map((p) => <TH key={p.id}>{p.label}: trade · T/CL · exp · return · DD</TH>)}</TR></THead>
              <TBody>
                {(['train', 'valid', 'test'] as Period[]).map((k) => (
                  <TR key={k}>
                    <TD className="whitespace-nowrap">{PERIOD[k]}</TD>
                    {P.map((p) => {
                      const x = r.results[p][fee][k];
                      return <TD key={p} className="num whitespace-nowrap text-xs">{x.trades} · {x.targetPct.toFixed(0)}/{x.cutlossPct.toFixed(0)}% · <span className={tone(x.expectancyPct)}>{pct(x.expectancyPct, 2, true)}</span> · <span className={tone(x.returnPct)}>{pct(x.returnPct, 1, true)}</span> · {pct(x.maxDrawdownPct, 1)}</TD>;
                    })}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Alasan penolakan (backtest 21 bulan)" subtitle="Jumlah signal yang terkena setiap alasan — satu signal bisa punya beberapa alasan; 'utama' = alasan pertama" />
        <CardBody className="overflow-x-auto p-0">
          <Table>
            <THead><TR><TH>Alasan</TH><TH>Jenis</TH>{PROFILES.map((p) => <TH key={p.id}>{p.label}</TH>)}</TR></THead>
            <TBody>
              {reasonCodes.map((code) => (
                <TR key={code}>
                  <TD>{REJECT_LABEL[code] ?? code}</TD>
                  <TD className="text-xs text-ink-3">{MONEY_CODES.has(code) ? 'Money mgmt' : 'Filter'}</TD>
                  {P.map((p) => {
                    const f = full(p).funnel;
                    const n = MONEY_CODES.has(code) ? f.money[code] : f.reasons[code];
                    return <TD key={p} className="num">{n ?? '–'}{!MONEY_CODES.has(code) && f.primary[code] ? <span className="text-[11px] text-ink-3"> · utama {f.primary[code]}</span> : null}</TD>;
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="K. Nilai tambahan setiap pelonggaran (expectancy per trade setelah fee)" subtitle="Seberapa banyak peluang hilang karena terlalu konservatif, dan berapa loss tambahan saat threshold dilonggarkan" />
        <CardBody className="overflow-x-auto p-0"><EvidenceTable rows={r.marginal} /></CardBody>
      </Card>

      <Card>
        <CardHeader title="L. Bukti per threshold" subtitle="Expectancy per trade setelah fee 0,1%/sisi (exit baru: tanpa TP, stop 2 ATR, 48 jam), satu posisi per koin. Setiap irisan memakai aturan Agresif lama (paling longgar) kecuali dimensi yang diuji." />
        <CardBody className="space-y-4">
          {Object.entries(r.evidence).map(([k, rows]) => (
            <div key={k} className="overflow-x-auto">
              <div className="mb-1 text-xs font-semibold text-ink-2">{EVIDENCE_TITLE[k] ?? k}</div>
              <EvidenceTable rows={rows.filter((x) => x.train.n + x.valid.n + x.test.n > 0)} />
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

export function scanSummaryFor(profile: ProfileId, skipped: unknown): string | null {
  const s = skipped as { profiles?: Record<ProfileId, { note: string }> } | null;
  return s?.profiles?.[profile]?.note ?? null;
}

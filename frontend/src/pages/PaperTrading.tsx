import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FlaskConical, Play, Wallet } from 'lucide-react';
import { api } from '@/services/api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Notice, PageHeader, Segmented, Stat } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { baseAsset, fmtDate, fmtPriceSym } from '@/utils/format';
import { cn } from '@/utils/cn';

/* ---------- types ---------- */
interface Stats {
  trades: number;
  targetPct: number;
  cutlossPct: number;
  timeoutPct: number;
  winRate: number;
  avgPnl: number;
  medianPnl: number;
  avgWin: number;
  avgLoss: number;
  expectancyPct: number;
  profitFactor: number | null;
  avgHoldH: number;
  maxHoldH: number;
}
interface OpenPos {
  id: string;
  symbol: string;
  cluster: string;
  openedAt: string;
  timeoutAt: string;
  entry: number;
  price: number | null;
  tp: number;
  sl: number;
  cost: number;
  value: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  allocationPct: number;
}
interface Summary {
  startedAt: string;
  lastScanAt: string | null;
  baseCapital: number;
  deposits: number;
  paidInCapital: number;
  sizingBase: number;
  feesPaid: number;
  equity: number;
  cash: number;
  invested: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  returnPct: number;
  peakEquity: number;
  drawdownPct: number;
  maxDrawdownPct: number;
  stats: Stats;
  positions: OpenPos[];
  config: { strategy: Record<string, number | string>; money: Record<string, number | number[] | boolean>; settings: { feeRate: number; compounding: boolean } };
}
interface Trade {
  id: string;
  symbol: string;
  cluster: string;
  openedAt: string;
  closedAt: string;
  avgEntry: number;
  exitPrice: number;
  exitReason: 'TARGET' | 'CUTLOSS' | 'TIMEOUT';
  cost: number;
  fees: number;
  pnl: number;
  pnlPct: number;
  holdH: number;
  mfePct: number;
  maePct: number;
  tp: number;
  sl: number;
  equityAfter: number;
  cashAfter: number;
  meta: Record<string, number | string>;
}
interface LedgerPoint {
  time: number;
  event: string;
  equity: number;
  cash: number;
  invested: number;
  drawdownPct: number;
  highWaterMark: number;
}
interface Daily {
  date: string;
  buys: number;
  sells: number;
  target: number;
  cutloss: number;
  timeout: number;
  pnl: number;
  fees: number;
  topUp: number;
  startEquity: number;
  endEquity: number;
  returnPct: number;
}
interface Asset {
  symbol: string;
  cluster: string;
  trades: number;
  target: number;
  cutloss: number;
  timeout: number;
  invested: number;
  pnl: number;
  maxAllocation?: number;
  maxAlloc?: number;
  openAllocation?: number;
  returnPct?: number;
  returnOnInvested?: number;
}
interface Scan {
  id: number;
  time: string;
  btc: { ret30d?: number; ret24h?: number; regime?: string } | null;
  scanned: number;
  signals: number;
  entries: { symbol: string; price: number; amount: number; allocationPct: number }[];
  skipped: { symbol: string; reason: string }[];
  note: string | null;
}

/* ---------- formatting (Paper Trading is booked in Rupiah, independent of the display currency) ---------- */
const fmtRp = (v: number | null | undefined, signed = false) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const s = v < 0 ? '-' : signed && v > 0 ? '+' : '';
  return `${s}Rp ${Math.abs(v).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
};
const pct = (v: number | null | undefined, d = 1, signed = false) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${signed && v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink-2');
const REASON: Record<string, { label: string; tone: 'up' | 'down' | 'neutral' }> = { TARGET: { label: 'Target', tone: 'up' }, CUTLOSS: { label: 'Cut loss', tone: 'down' }, TIMEOUT: { label: 'Waktu habis', tone: 'neutral' } };
const AXIS = { fontSize: 11, fill: '#8491a5' };
const tickDate = (t: number) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short' }).format(t);

function ChartTip({ active, payload, render }: { active?: boolean; payload?: { payload: Record<string, number> }[]; render: (p: Record<string, number>) => React.ReactNode }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">{render(payload[0].payload)}</div>;
}

function EquityCurve({ points, base, marks }: { points: { time: number; equity: number; drawdownPct: number }[]; base: number; marks?: { time: number; label: string }[] }) {
  if (new Set(points.map((p) => p.time)).size < 2) return <p className="text-sm text-ink-3">Kurva ekuitas muncul setelah beberapa scan per jam.</p>;
  return (
    <div className="space-y-2">
      <div className="h-64" role="img" aria-label="Kurva ekuitas modal Rp1.000.000">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="peq" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2a78d6" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#2a78d6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eef1f6" vertical={false} />
            <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={40} />
            <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}rb`} tick={AXIS} axisLine={false} tickLine={false} width={56} domain={['auto', 'auto']} />
            <ReferenceLine y={base} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Modal awal', position: 'insideTopLeft', fontSize: 10, fill: '#8491a5' }} />
            {marks?.map((m) => <ReferenceLine key={m.time} x={m.time} stroke="#eb6834" strokeDasharray="4 4" label={{ value: m.label, position: 'insideTopRight', fontSize: 10, fill: '#b45309' }} />)}
            <Tooltip content={<ChartTip render={(p) => (<><div className="text-ink-3">{fmtDate(p.time)}</div><div className="num font-semibold">{fmtRp(p.equity)}</div><div className="num text-down">DD {pct(p.drawdownPct, 2)}</div></>)} />} />
            <Area type="monotone" dataKey="equity" stroke="#2a78d6" strokeWidth={2} fill="url(#peq)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="h-28" role="img" aria-label="Drawdown">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
            <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
            <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={AXIS} axisLine={false} tickLine={false} width={56} />
            <Area type="monotone" dataKey="drawdownPct" stroke="#d03b3b" strokeWidth={1.5} fill="#d03b3b" fillOpacity={0.12} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ---------- live tab ---------- */
function Live() {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ['paper'], queryFn: () => api<Summary>('/api/paper'), refetchInterval: 60_000 });
  const equity = useQuery({ queryKey: ['paper', 'equity'], queryFn: () => api<LedgerPoint[]>('/api/paper/equity'), refetchInterval: 300_000 });
  const trades = useQuery({ queryKey: ['paper', 'trades'], queryFn: () => api<Trade[]>('/api/paper/trades?limit=200'), refetchInterval: 120_000 });
  const daily = useQuery({ queryKey: ['paper', 'daily'], queryFn: () => api<Daily[]>('/api/paper/daily'), refetchInterval: 300_000 });
  const assets = useQuery({ queryKey: ['paper', 'assets'], queryFn: () => api<Asset[]>('/api/paper/assets'), refetchInterval: 300_000 });
  const scans = useQuery({ queryKey: ['paper', 'scans'], queryFn: () => api<Scan[]>('/api/paper/scans?limit=24'), refetchInterval: 120_000 });
  const scan = useMutation({ mutationFn: () => api('/api/paper/scan', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['paper'] }) });
  const s = summary.data;
  if (summary.isError) return <Notice tone="error" title="Paper Trading tidak tersedia">{(summary.error as Error).message}</Notice>;
  if (!s) return <p className="text-sm text-ink-3">Memuat…</p>;
  const st = s.stats;
  const nextScan = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + 3_600_000 + 45_000);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="PAPER TRADING V2"
          subtitle={`Mulai ${fmtDate(s.startedAt)} · scan terakhir ${s.lastScanAt ? fmtDate(s.lastScanAt) : '–'} · scan berikutnya ${fmtDate(nextScan)}`}
          action={<Button size="sm" variant="outline" loading={scan.isPending} onClick={() => scan.mutate()}><Play className="h-3.5 w-3.5" /> Scan sekarang</Button>}
        />
        <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Modal disetor" value={fmtRp(s.paidInCapital)} sub={s.deposits ? `Awal ${fmtRp(s.baseCapital)} + top-up ${fmtRp(s.deposits)}` : `Basis ukuran posisi ${fmtRp(s.sizingBase)}`} />
          <Stat label="Current Equity" value={fmtRp(s.equity)} tone={tone(s.totalPnl)} sub={`Peak ${fmtRp(s.peakEquity)}`} />
          <Stat label="Total P&L" value={fmtRp(s.totalPnl, true)} tone={tone(s.totalPnl)} sub={`Return ${pct(s.returnPct, 2, true)}`} />
          <Stat label="Max Drawdown" value={pct(s.maxDrawdownPct, 2)} tone="text-down" sub={`Sekarang ${pct(s.drawdownPct, 2)}`} />
          <Stat label="Cash" value={fmtRp(s.cash)} sub={`Invested ${fmtRp(s.invested)}`} />
          <Stat label="Open Positions" value={s.positions.length} sub={`Unrealized ${fmtRp(s.unrealizedPnl, true)}`} />
          <Stat label="TARGET" value={pct(st.targetPct)} tone="text-up" sub={`${st.trades} trade selesai`} />
          <Stat label="CUTLOSS" value={pct(st.cutlossPct)} tone="text-down" />
          <Stat label="TIMEOUT" value={pct(st.timeoutPct)} />
          <Stat label="Profit Factor" value={st.profitFactor === null ? '∞' : st.profitFactor.toFixed(2)} sub={`Win rate ${pct(st.winRate)}`} />
          <Stat label="Expectancy" value={pct(st.expectancyPct, 3, true)} tone={tone(st.expectancyPct)} sub={`${fmtRp(st.avgPnl, true)} / trade`} />
          <Stat label="Avg Holding" value={`${st.avgHoldH.toFixed(1)} jam`} sub={`maks ${st.maxHoldH.toFixed(1)} jam`} />
        </CardBody>
      </Card>

      <SettingsCard s={s} />

      <Card>
        <CardHeader title="Equity curve & drawdown" subtitle="Setiap BUY/SELL dan titik mark-to-market per jam dari capital ledger" />
        <CardBody>
          <EquityCurve points={(equity.data ?? []).map((p) => ({ time: p.time, equity: p.equity, drawdownPct: p.drawdownPct }))} base={s.baseCapital} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Posisi terbuka" subtitle="Alokasi = % dari basis ukuran posisi (equity jika compounding ON)" />
        <CardBody className="p-0">
          {s.positions.length === 0 ? (
            <div className="p-4"><EmptyState icon={<Wallet className="h-5 w-5" />} title="HOLD CASH">Tidak ada posisi. Cash adalah posisi yang valid saat tidak ada setup yang memenuhi syarat.</EmptyState></div>
          ) : (
            <Table>
              <THead><TR><TH>Koin</TH><TH>Alokasi</TH><TH>Entry</TH><TH>Harga</TH><TH>TP</TH><TH>SL</TH><TH>Unrealized</TH><TH>Timeout</TH></TR></THead>
              <TBody>
                {s.positions.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-semibold">{baseAsset(p.symbol)} <span className="text-[11px] text-ink-3">{p.cluster}</span></TD>
                    <TD className="num">{pct(p.allocationPct)} · {fmtRp(p.cost)}</TD>
                    <TD className="num">{fmtPriceSym(p.entry)}</TD>
                    <TD className="num">{fmtPriceSym(p.price)}</TD>
                    <TD className="num text-up">{fmtPriceSym(p.tp)}</TD>
                    <TD className="num text-down">{fmtPriceSym(p.sl)}</TD>
                    <TD className={cn('num', tone(p.unrealizedPnl))}>{fmtRp(p.unrealizedPnl, true)} ({pct(p.unrealizedPct, 2, true)})</TD>
                    <TD className="num text-ink-3">{fmtDate(p.timeoutAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Log scan per jam" subtitle="Kenapa sistem membeli — atau menahan cash" />
        <CardBody className="p-0">
          <Table>
            <THead><TR><TH>Waktu</TH><TH>BTC 30h / 24j</TH><TH>Lolos</TH><TH>Dibeli</TH><TH>Catatan</TH></TR></THead>
            <TBody>
              {(scans.data ?? []).map((x) => (
                <TR key={x.id}>
                  <TD className="num whitespace-nowrap">{fmtDate(x.time)}</TD>
                  <TD className="num">{pct(x.btc?.ret30d, 1, true)} / {pct(x.btc?.ret24h, 1, true)}</TD>
                  <TD className="num">{x.signals}/{x.scanned}</TD>
                  <TD>{x.entries.length ? x.entries.map((e) => `${baseAsset(e.symbol)} ${fmtRp(e.amount)}`).join(', ') : '–'}</TD>
                  <TD className="text-xs text-ink-3">{x.note ?? x.skipped.slice(0, 3).map((k) => `${baseAsset(k.symbol)}: ${k.reason}`).join(' · ')}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Riwayat transaksi" subtitle="Entry → alokasi → TP/SL → exit → P&L → cash → equity" />
        <CardBody className="p-0">
          {!trades.data?.length ? (
            <p className="p-4 text-sm text-ink-3">Belum ada trade yang selesai.</p>
          ) : (
            <Table>
              <THead><TR><TH>Tutup</TH><TH>Koin</TH><TH>Alokasi</TH><TH>Entry → Exit</TH><TH>Hasil</TH><TH>P&L (net)</TH><TH>Fee</TH><TH>Hold</TH><TH>MFE / MAE</TH><TH>Vol · ATR</TH><TH>Equity</TH></TR></THead>
              <TBody>
                {trades.data.map((t) => (
                  <TR key={t.id}>
                    <TD className="num whitespace-nowrap">{fmtDate(t.closedAt)}</TD>
                    <TD className="font-semibold">{baseAsset(t.symbol)}</TD>
                    <TD className="num">{fmtRp(t.cost)}</TD>
                    <TD className="num whitespace-nowrap">{fmtPriceSym(t.avgEntry)} → {fmtPriceSym(t.exitPrice)}</TD>
                    <TD><Badge tone={REASON[t.exitReason].tone}>{REASON[t.exitReason].label}</Badge></TD>
                    <TD className={cn('num', tone(t.pnl))}>{fmtRp(t.pnl, true)} ({pct(t.pnlPct, 2, true)})</TD>
                    <TD className="num text-ink-3">{fmtRp(t.fees)}</TD>
                    <TD className="num">{t.holdH.toFixed(1)}j</TD>
                    <TD className="num">{pct(t.mfePct, 2, true)} / {pct(t.maePct, 2)}</TD>
                    <TD className="num text-ink-3">{Number(t.meta.volRatio).toFixed(1)}x · {Number(t.meta.atrPct).toFixed(2)}%</TD>
                    <TD className="num">{fmtRp(t.equityAfter)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Ringkasan harian" subtitle="Equity berlanjut tiap hari (top-up tidak dihitung sebagai P&L)" />
          <CardBody className="p-0">
            <Table>
              <THead><TR><TH>Tanggal</TH><TH>Awal</TH><TH>BUY/SELL</TH><TH>T/CL/TO</TH><TH>P&L (net)</TH><TH>Fee</TH><TH>Akhir</TH><TH>Return</TH></TR></THead>
              <TBody>
                {(daily.data ?? []).slice().reverse().map((d) => (
                  <TR key={d.date}>
                    <TD className="num">{d.date}</TD>
                    <TD className="num">{fmtRp(d.startEquity)}</TD>
                    <TD className="num">{d.buys}/{d.sells}</TD>
                    <TD className="num">{d.target}/{d.cutloss}/{d.timeout}</TD>
                    <TD className={cn('num', tone(d.pnl))}>{fmtRp(d.pnl, true)}</TD>
                    <TD className="num text-ink-3">{fmtRp(d.fees)}</TD>
                    <TD className="num">{fmtRp(d.endEquity)}{d.topUp ? <span className="block text-[11px] text-primary">+ top-up {fmtRp(d.topUp)}</span> : null}</TD>
                    <TD className={cn('num', tone(d.returnPct))}>{pct(d.returnPct, 2, true)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Performa per aset" />
          <CardBody className="p-0">
            <AssetTable rows={assets.data ?? []} />
          </CardBody>
        </Card>
      </div>
      <ConfigCard cfg={s.config} />
    </div>
  );
}

function SettingsCard({ s }: { s: Summary }) {
  const qc = useQueryClient();
  const [fee, setFee] = useState(String(+(s.config.settings.feeRate * 100).toFixed(3)));
  const [topUp, setTopUp] = useState('500000');
  const refresh = () => qc.invalidateQueries({ queryKey: ['paper'] });
  const save = useMutation({ mutationFn: (body: { feeRatePct?: number; compounding?: boolean }) => api('/api/paper/settings', { method: 'PUT', json: body }), onSuccess: refresh });
  const add = useMutation({ mutationFn: (amount: number) => api('/api/paper/topup', { method: 'POST', json: { amount } }), onSuccess: refresh });
  const comp = s.config.settings.compounding;
  return (
    <Card>
      <CardHeader title="Biaya, compounding & top-up" subtitle={`Fee terbayar ${fmtRp(s.feesPaid)} · perubahan berlaku untuk trade berikutnya`} />
      <CardBody className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-ink-2">Fee per sisi (%)</div>
          <div className="flex gap-2">
            <Input type="number" step="0.005" min="0" max="1" value={fee} onChange={(e) => setFee(e.target.value)} className="w-28" />
            <Button size="sm" variant="outline" loading={save.isPending} onClick={() => save.mutate({ feeRatePct: Number(fee) })}>Simpan</Button>
          </div>
          <p className="text-[11px] text-ink-3">Binance spot 0,1% · dengan diskon BNB 0,075% · 0 = edge murni strategi.</p>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-ink-2">Compounding</div>
          <Segmented value={comp ? 'on' : 'off'} onChange={(v) => save.mutate({ compounding: v === 'on' })} options={[{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }]} />
          <p className="text-[11px] text-ink-3">{comp ? `Ukuran posisi ikut equity (basis sekarang ${fmtRp(s.sizingBase)}).` : `Ukuran posisi dari modal disetor ${fmtRp(s.paidInCapital)}.`}</p>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-ink-2">Top-up saldo virtual (Rp)</div>
          <div className="flex gap-2">
            <Input type="number" step="50000" min="10000" value={topUp} onChange={(e) => setTopUp(e.target.value)} className="w-36" />
            <Button size="sm" variant="outline" loading={add.isPending} onClick={() => add.mutate(Number(topUp))}>Tambah</Button>
          </div>
          <p className="text-[11px] text-ink-3">Masuk ke cash & modal disetor; tidak dihitung sebagai profit.</p>
        </div>
        {(save.isError || add.isError) && <Notice tone="error" className="md:col-span-3">{((save.error ?? add.error) as Error).message}</Notice>}
      </CardBody>
    </Card>
  );
}

function AssetTable({ rows }: { rows: Asset[] }) {
  if (!rows.length) return <p className="p-4 text-sm text-ink-3">Belum ada data.</p>;
  return (
    <Table>
      <THead><TR><TH>Aset</TH><TH>Trade</TH><TH>T/CL/TO</TH><TH>Total invested</TH><TH>Alokasi maks</TH><TH>P&L</TH><TH>Return</TH></TR></THead>
      <TBody>
        {rows.map((a) => (
          <TR key={a.symbol}>
            <TD className="font-semibold">{baseAsset(a.symbol)} <span className="text-[11px] text-ink-3">{a.cluster}</span></TD>
            <TD className="num">{a.trades}</TD>
            <TD className="num">{a.target}/{a.cutloss}/{a.timeout}</TD>
            <TD className="num">{fmtRp(a.invested)}</TD>
            <TD className="num">{fmtRp(a.maxAllocation ?? a.maxAlloc ?? 0)}</TD>
            <TD className={cn('num', tone(a.pnl))}>{fmtRp(a.pnl, true)}</TD>
            <TD className={cn('num', tone(a.pnl))}>{pct(a.returnPct ?? a.returnOnInvested, 2, true)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function ConfigCard({ cfg }: { cfg: Summary['config'] }) {
  const s = cfg.strategy as Record<string, number | string>;
  const m = cfg.money as Record<string, number>;
  const set = cfg.settings;
  const rows: [string, string][] = [
    ['Universe', '21 koin likuid Binance USDT (BTC, ETH, BNB, SOL, …)'],
    ['Entry', `Close 1h > high ${s.breakoutLookback} jam, volume ≥ ${s.minVolRatio}x rata-rata 20 jam, regime koin ${s.coinRegime}`],
    ['Filter BTC', `Return BTC 30 hari > ${s.btcRet30dMin}% (jika tidak → HOLD CASH)`],
    ['Take profit', `${s.tpAtr} × ATR(1h) dari harga fill`],
    ['Cut loss', `${s.slAtr} × ATR(1h) dari harga fill`],
    ['Timeout', `${s.maxHoldH} jam (maks. 24 jam)`],
    ['Risk / trade', `${(m.riskPerTrade * 100).toFixed(1)}% basis ukuran posisi jika kena cut loss`],
    ['Ukuran posisi', `Risk ÷ jarak SL, maks ${(m.maxPerCoin * 100).toFixed(0)}% basis per koin`],
    ['Posisi bersamaan', `Maks ${m.maxPositions}, 1 posisi per koin (tanpa re-entry selama masih terbuka)`],
    ['Cash reserve', `${(m.cashReserve * 100).toFixed(0)}% basis tidak pernah dipakai`],
    ['Eksposur maks', `Total ${(m.maxExposure * 100).toFixed(0)}% · per klaster korelasi ${(m.maxClusterExposure * 100).toFixed(0)}%`],
    ['Entry layer', 'Full entry (layer 50/50, 40/30/30, 50/30/20 & dinamis diuji — tidak memperbaiki PF)'],
    ['Biaya & compounding', `Fee ${(set.feeRate * 100).toFixed(3)}% per sisi · compounding ${set.compounding ? 'ON (ukuran dari equity)' : 'OFF (ukuran dari modal disetor)'} · top-up manual tersedia`],
  ];
  return (
    <Card>
      <CardHeader title="Konfigurasi V2" subtitle="Hasil riset — lihat tab Riset untuk bukti setiap angka" />
      <CardBody className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 border-b border-border/60 py-1.5"><span className="w-36 shrink-0 text-ink-3">{k}</span><span>{v}</span></div>
        ))}
      </CardBody>
    </Card>
  );
}

/* ---------- research tab ---------- */
type PeriodKey = 'train' | 'valid' | 'test' | 'full';
interface PSum { trades: number; targetPct: number; cutlossPct: number; timeoutPct: number; winRate: number; avgPnl: number; medianPnl: number; expectancyPct: number; profitFactor: number; totalPnl: number; returnPct: number; finalEquity: number; peakEquity: number; maxDrawdownPct: number; avgHoldH: number; maxHoldH: number; longestLossStreak: number; utilization?: number }
interface Bucket { label: string; n: number; targetPct: number; cutlossPct: number; timeoutPct: number; avgPnl: number; medianPnl: number; avgPnlPct: number; mfe: number; mae: number; avgHoldH: number; pf: number | null }
interface Research {
  periods: Record<PeriodKey, string[]>;
  compare: Record<PeriodKey, { v2: PSum; old: PSum }>;
  robust: { lab: string; train: { pf: number; ret: number; cl: number; tp: number }; valid: { pf: number; ret: number; cl: number; tp: number }; test: { pf: number; ret: number; cl: number; tp: number } }[];
  equityDaily: { date: string; equity: number; dd: number }[];
  monthly: { month: string; pnl: number }[];
  perAsset: Asset[];
  atrBuckets: Bucket[];
  atrPercentileBuckets: Bucket[];
  mfeMae: Record<string, { mfeAtrMedian: number; maeAtrMedian: number; n: number }>;
  v2CutlossCategories: Record<string, number>;
  v2CutlossN: number;
  feeSensitivity: { feePct: number; compounding: boolean; pf: number; returnPct: number; maxDrawdownPct: number; expectancyPct: number }[];
  old: {
    closed: { n: number; target: number; cutloss: number; timeout: number; pnlUsdt: number };
    winRatePct: number;
    avgTargetPct: number;
    avgCutlossPct: number;
    byStyle: Record<string, { n: number; target: number; cutloss: number; pnlUsdt: number }>;
    reentry: Record<'dup' | 'unique', { n: number; target: number; cutloss: number; pnlUsdt: number }>;
    cutlossCategories: Record<string, { n: number; pct: number }>;
    cutlossPrimary: Record<string, number>;
    medianAtr1hPct: number;
    maxConcurrentInvestedXCapital: number;
    maxSimultaneousPositionsOneCoin: number;
    medianTargetDistPct: number;
  };
}
const PERIOD_LABEL: Record<PeriodKey, string> = { train: 'Training 2025', valid: 'Validasi 2026-H1', test: 'Test 2026-Q3', full: 'Penuh 21 bulan' };

function ResearchTab() {
  const q = useQuery({ queryKey: ['paper', 'research'], queryFn: () => api<Research>('/api/paper/research'), staleTime: Infinity });
  const r = q.data;
  if (!r) return <p className="text-sm text-ink-3">Memuat…</p>;
  const o = r.old;
  const pts = r.equityDaily.map((d) => ({ time: Date.parse(`${d.date}T00:00:00+07:00`), equity: d.equity, drawdownPct: d.dd }));
  const marks = [{ time: Date.parse(r.periods.valid[0]), label: 'Validasi →' }, { time: Date.parse(r.periods.test[0]), label: 'Test →' }];
  const grid = r.robust.filter((x) => x.lab.startsWith('TP'));
  const tps = [...new Set(grid.map((g) => g.lab.split(' ')[0]))];
  const sls = [...new Set(grid.map((g) => g.lab.split(' ')[1]))];
  return (
    <div className="space-y-4">
      <Notice tone="info" title="Ringkasan riset">
        Mesin skor lama (BUY/STRONG BUY) tidak punya edge intraday: hasilnya sama dengan entry acak. Yang konsisten di training, validasi, dan test adalah
        <b> breakout 20 jam dengan volume ≥ 3x di koin ber-regime BULL, hanya saat BTC naik dalam 30 hari</b>, dengan target kecil (0,75 ATR) dan cut loss lebar (2,5 ATR).
        CUTLOSS ≤ 10% bisa dicapai (TP 0,5 ATR) tetapi kehilangan edge di data validasi — jadi dipilih CUTLOSS ~13% dengan expectancy positif di semua periode.
      </Notice>

      <Card>
        <CardHeader title="A. Strategi lama (data Paper Trading produksi)" subtitle={`${o.closed.n} trade selesai · diarsipkan sebelum reset`} />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="TARGET" value={`${o.closed.target} (${pct((o.closed.target / o.closed.n) * 100)})`} tone="text-up" />
            <Stat label="CUTLOSS" value={`${o.closed.cutloss} (${pct((o.closed.cutloss / o.closed.n) * 100)})`} tone="text-down" />
            <Stat label="Win rate" value={pct(o.winRatePct)} />
            <Stat label="Rata-rata TARGET / CUTLOSS" value={`${pct(o.avgTargetPct, 1, true)} / ${pct(o.avgCutlossPct)}`} />
            <Stat label="Target median" value={pct(o.medianTargetDistPct)} sub="terlalu jauh untuk 1 hari" />
            <Stat label="Eksposur maks" value={`${o.maxConcurrentInvestedXCapital.toFixed(0)}× modal`} tone="text-down" sub={`${o.maxSimultaneousPositionsOneCoin} posisi di 1 koin`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Table>
              <THead><TR><TH>Kategori CUTLOSS (multi-label)</TH><TH>Kasus</TH><TH>%</TH></TR></THead>
              <TBody>
                {Object.entries(o.cutlossCategories).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => (
                  <TR key={k}><TD>{k}</TD><TD className="num">{v.n}</TD><TD className="num">{pct(v.pct)}</TD></TR>
                ))}
              </TBody>
            </Table>
            <Table>
              <THead><TR><TH>Kelompok</TH><TH>n</TH><TH>TARGET</TH><TH>CUTLOSS</TH><TH>P&L USDT</TH></TR></THead>
              <TBody>
                {Object.entries(o.byStyle).map(([k, v]) => (
                  <TR key={k}><TD>{k}</TD><TD className="num">{v.n}</TD><TD className="num">{v.target}</TD><TD className="num">{v.cutloss}</TD><TD className={cn('num', tone(v.pnlUsdt))}>{v.pnlUsdt.toFixed(2)}</TD></TR>
                ))}
                <TR><TD>Re-entry (koin masih terbuka)</TD><TD className="num">{o.reentry.dup.n}</TD><TD className="num">{o.reentry.dup.target}</TD><TD className="num">{o.reentry.dup.cutloss}</TD><TD className="num text-down">{o.reentry.dup.pnlUsdt.toFixed(2)}</TD></TR>
                <TR><TD>Posisi unik</TD><TD className="num">{o.reentry.unique.n}</TD><TD className="num">{o.reentry.unique.target}</TD><TD className="num">{o.reentry.unique.cutloss}</TD><TD className="num text-up">{o.reentry.unique.pnlUsdt.toFixed(2)}</TD></TR>
              </TBody>
            </Table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="B. Backtest portofolio Rp1.000.000 — lama vs V2" subtitle="Tanpa fee, tanpa compounding, exit dicek per candle 5 menit (sentuh TP & SL di candle yang sama = cut loss)" />
        <CardBody className="p-0">
          <Table>
            <THead><TR><TH>Periode</TH><TH>Strategi</TH><TH>Trade</TH><TH>TARGET</TH><TH>CUTLOSS</TH><TH>TIMEOUT</TH><TH>Expectancy</TH><TH>PF</TH><TH>Return</TH><TH>Max DD</TH><TH>Hold</TH><TH>Loss streak</TH></TR></THead>
            <TBody>
              {(Object.keys(PERIOD_LABEL) as PeriodKey[]).flatMap((k) =>
                (['old', 'v2'] as const).map((w) => {
                  const x = r.compare[k][w];
                  return (
                    <TR key={k + w} className={w === 'v2' ? 'bg-primary-soft/30' : undefined}>
                      <TD className="whitespace-nowrap">{w === 'old' ? PERIOD_LABEL[k] : ''}</TD>
                      <TD className="font-semibold">{w === 'v2' ? 'V2' : 'Lama'}</TD>
                      <TD className="num">{x.trades}</TD>
                      <TD className="num text-up">{pct(x.targetPct)}</TD>
                      <TD className="num text-down">{pct(x.cutlossPct)}</TD>
                      <TD className="num">{pct(x.timeoutPct)}</TD>
                      <TD className={cn('num', tone(x.expectancyPct))}>{pct(x.expectancyPct, 3, true)}</TD>
                      <TD className="num">{x.profitFactor.toFixed(2)}</TD>
                      <TD className={cn('num', tone(x.returnPct))}>{pct(x.returnPct, 1, true)}</TD>
                      <TD className="num text-down">{pct(x.maxDrawdownPct, 1)}</TD>
                      <TD className="num">{x.avgHoldH.toFixed(1)}j</TD>
                      <TD className="num">{x.longestLossStreak}</TD>
                    </TR>
                  );
                }),
              )}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="B2. Pengaruh fee & compounding (V2, 21 bulan)" subtitle="Edge per trade tipis — fee menentukan apakah strategi untung" />
        <CardBody className="p-0">
          <Table>
            <THead><TR><TH>Fee per sisi</TH><TH>Compounding</TH><TH>Expectancy/trade</TH><TH>PF</TH><TH>Return</TH><TH>Max DD</TH></TR></THead>
            <TBody>
              {r.feeSensitivity.map((f) => (
                <TR key={`${f.feePct}${f.compounding}`}>
                  <TD className="num">{f.feePct.toFixed(3)}%</TD>
                  <TD>{f.compounding ? 'ON' : 'OFF'}</TD>
                  <TD className={cn('num', tone(f.expectancyPct))}>{pct(f.expectancyPct, 3, true)}</TD>
                  <TD className="num">{f.pf.toFixed(2)}</TD>
                  <TD className={cn('num', tone(f.returnPct))}>{pct(f.returnPct, 1, true)}</TD>
                  <TD className="num text-down">{pct(f.maxDrawdownPct, 1)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="C. Perkembangan Rp1.000.000 dengan V2 (Jan 2025 – Okt 2026)" subtitle={`Akhir ${fmtRp(r.compare.full.v2.finalEquity)} · peak ${fmtRp(r.compare.full.v2.peakEquity)} · max DD ${pct(r.compare.full.v2.maxDrawdownPct, 2)}`} />
        <CardBody className="space-y-4">
          <EquityCurve points={pts} base={1_000_000} marks={marks} />
          <div className="h-48" role="img" aria-label="P&L bulanan">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={r.monthly} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#eef1f6" vertical={false} />
                <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}rb`} tick={AXIS} axisLine={false} tickLine={false} width={56} />
                <ReferenceLine y={0} stroke="#cbd5e1" />
                <Tooltip cursor={{ fill: '#f1f5f9' }} content={<ChartTip render={(p) => (<><div className="text-ink-3">{String(p.month)}</div><div className="num font-semibold">{fmtRp(p.pnl, true)}</div></>)} />} />
                <Bar dataKey="pnl" isAnimationActive={false}>{r.monthly.map((m) => <Cell key={m.month} fill={m.pnl >= 0 ? '#0f8a45' : '#d03b3b'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="D. Robustness: TP × SL (Profit Factor training / validasi / test)" subtitle="Semua sel > 1 di ketiga periode → parameter stabil, bukan satu titik beruntung" />
        <CardBody className="overflow-x-auto p-0">
          <Table>
            <THead><TR><TH>TP \ SL</TH>{sls.map((s) => <TH key={s}>{s.replace('SL', '')} ATR</TH>)}</TR></THead>
            <TBody>
              {tps.map((t) => (
                <TR key={t}>
                  <TD className="font-semibold">{t.replace('TP', '')} ATR</TD>
                  {sls.map((s) => {
                    const g = grid.find((x) => x.lab === `${t} ${s}`)!;
                    const chosen = t === 'TP0.75' && s === 'SL2.5';
                    return (
                      <TD key={s} className={cn('num text-xs', chosen && 'bg-primary-soft font-semibold')}>
                        {g.train.pf.toFixed(2)} / {g.valid.pf.toFixed(2)} / {g.test.pf.toFixed(2)}
                        <div className="text-[10px] text-ink-3">CL {g.valid.cl.toFixed(0)}%</div>
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="p-4">
            <Table>
              <THead><TR><TH>Variasi lain</TH><TH>Training PF / return</TH><TH>Validasi PF / return</TH><TH>Test PF / return</TH><TH>CUTLOSS (val)</TH></TR></THead>
              <TBody>
                {r.robust.filter((x) => !x.lab.startsWith('TP')).map((x) => (
                  <TR key={x.lab}>
                    <TD>{x.lab}</TD>
                    <TD className="num">{x.train.pf.toFixed(2)} / {pct(x.train.ret, 1, true)}</TD>
                    <TD className="num">{x.valid.pf.toFixed(2)} / {pct(x.valid.ret, 1, true)}</TD>
                    <TD className="num">{x.test.pf.toFixed(2)} / {pct(x.test.ret, 1, true)}</TD>
                    <TD className="num">{pct(x.valid.cl)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <BucketCard title="E. Zona ATR(1h) — trade V2, 21 bulan" rows={r.atrBuckets} />
        <BucketCard title="F. ATR percentile (30 hari)" rows={r.atrPercentileBuckets} />
      </div>

      <Card>
        <CardHeader title="G. MFE / MAE & penyebab CUTLOSS V2" subtitle="Dalam satuan ATR(1h)" />
        <CardBody className="grid gap-4 lg:grid-cols-2">
          <Table>
            <THead><TR><TH>Hasil</TH><TH>n</TH><TH>MFE median</TH><TH>MAE median</TH></TR></THead>
            <TBody>
              {Object.entries(r.mfeMae).map(([k, v]) => (
                <TR key={k}><TD>{REASON[k]?.label ?? k}</TD><TD className="num">{v.n}</TD><TD className="num">{v.mfeAtrMedian.toFixed(2)}</TD><TD className="num">{v.maeAtrMedian.toFixed(2)}</TD></TR>
              ))}
            </TBody>
          </Table>
          <Table>
            <THead><TR><TH>Kategori CUTLOSS V2</TH><TH>Kasus</TH><TH>%</TH></TR></THead>
            <TBody>
              {Object.entries(r.v2CutlossCategories).map(([k, v]) => (
                <TR key={k}><TD>{k}</TD><TD className="num">{v}</TD><TD className="num">{pct((v / r.v2CutlossN) * 100)}</TD></TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="H. Kontribusi per aset (backtest 21 bulan)" />
        <CardBody className="p-0"><AssetTable rows={r.perAsset} /></CardBody>
      </Card>
    </div>
  );
}

function BucketCard({ title, rows }: { title: string; rows: Bucket[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="overflow-x-auto p-0">
        <Table>
          <THead><TR><TH>Zona</TH><TH>n</TH><TH>T / CL / TO</TH><TH>Avg P&L</TH><TH>Median</TH><TH>MFE / MAE</TH><TH>Hold</TH><TH>PF</TH></TR></THead>
          <TBody>
            {rows.map((b) => (
              <TR key={b.label}>
                <TD>{b.label}</TD>
                <TD className="num">{b.n}</TD>
                <TD className="num">{b.targetPct.toFixed(0)} / {b.cutlossPct.toFixed(0)} / {b.timeoutPct.toFixed(0)}%</TD>
                <TD className={cn('num', tone(b.avgPnl))}>{fmtRp(b.avgPnl, true)}</TD>
                <TD className="num">{fmtRp(b.medianPnl, true)}</TD>
                <TD className="num">{pct(b.mfe, 2, true)} / {pct(b.mae, 2)}</TD>
                <TD className="num">{b.avgHoldH.toFixed(1)}j</TD>
                <TD className="num">{b.pf?.toFixed(2) ?? '–'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );
}

export default function PaperTrading() {
  const [tab, setTab] = useState<'live' | 'research'>('live');
  return (
    <div className="space-y-4">
      <PageHeader
        title="Paper Trading V2"
        description="Simulasi modal virtual Rp1.000.000: breakout volume intraday, holding maks. 8 jam, fee & compounding bisa diatur. Bukan order nyata."
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'live', label: 'Live V2' }, { value: 'research', label: 'Riset & Backtest' }]} />}
      />
      {tab === 'live' ? <Live /> : <ResearchTab />}
      <p className="flex items-center gap-1.5 text-xs text-ink-3"><FlaskConical className="h-3.5 w-3.5" /> Hasil backtest bukan jaminan. Edge V2 tipis: backtest 21 bulan +33% tanpa fee, +11% dengan fee 0,075%/sisi, +3% dengan fee 0,1%/sisi (max DD −10%).</p>
    </div>
  );
}

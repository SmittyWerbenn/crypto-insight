import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FlaskConical, Play, RotateCcw, ShieldAlert } from 'lucide-react';
import { api, apiUrl } from '@/services/api';
import { useBacktest, useBacktestDrawdown, useBacktests, useBacktestTrades, useConfig } from '@/hooks/queries';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Segmented, Select, Stat } from '@/components/ui/primitives';
import { Change } from '@/components/ui/domain';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { DistributionChart, DrawdownChart, EquityChart, MonthlyChart } from '@/components/backtest/Charts';
import type { BacktestJob, BacktestMetrics, Trade } from '@/types/api';
import { baseAsset, currencySymbol, displayCurrency, fmtDate, fmtDateTime, fmtDuration, fmtNum, fmtPct, fmtPrice, fmtUsd, fromDisplay } from '@/utils/format';
import { cn } from '@/utils/cn';

type Mode = 'standard' | 'out-of-sample' | 'optimization' | 'walk-forward' | 'matrix';
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

interface FormState {
  symbol: string;
  strategy: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  feePct: number;
  slippagePct: number;
  mode: Mode;
  splitRatio: number;
  trainDays: number;
  testDays: number;
  objective: 'sharpe' | 'roi' | 'profitFactor';
  maxCombinations: number;
  ranges: Record<string, { on: boolean; min: number; max: number; step: number }>;
  params: Record<string, number | boolean>;
  matrixSymbols: string;
  matrixTimeframes: string[];
}

const initial = (): FormState => ({
  symbol: 'BTCUSDT',
  strategy: 'ma-rsi-macd',
  timeframe: '4h',
  startDate: iso(new Date(Date.now() - 180 * DAY)),
  endDate: iso(new Date()),
  // Entered in the display currency; converted to USDT for the engine
  initialCapital: displayCurrency() === 'IDR' ? 100_000_000 : 10000,
  positionSizePct: 10,
  stopLossPct: 5,
  takeProfitPct: 10,
  feePct: 0.1,
  slippagePct: 0.05,
  mode: 'standard',
  splitRatio: 0.7,
  trainDays: 90,
  testDays: 30,
  objective: 'sharpe',
  maxCombinations: 100,
  ranges: {},
  params: {},
  matrixSymbols: 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT',
  matrixTimeframes: ['1h', '4h', '1d'],
});

const RANGE_DEFAULTS: Record<string, { min: number; max: number; step: number }> = {
  rsiMin: { min: 40, max: 55, step: 5 },
  rsiMax: { min: 65, max: 80, step: 5 },
  maFast: { min: 10, max: 30, step: 10 },
  maSlow: { min: 40, max: 60, step: 10 },
  macdFast: { min: 8, max: 12, step: 4 },
  macdSlow: { min: 21, max: 26, step: 5 },
  macdSignal: { min: 7, max: 9, step: 2 },
  volumeMultiplier: { min: 0.8, max: 1.2, step: 0.2 },
  entryScore: { min: 60, max: 70, step: 5 },
  exitScore: { min: 40, max: 50, step: 5 },
  stopLoss: { min: 0.03, max: 0.07, step: 0.02 },
  takeProfit: { min: 0.06, max: 0.14, step: 0.04 },
  adxMin: { min: 15, max: 30, step: 5 },
  rocMin: { min: 0, max: 2, step: 1 },
  rsiExit: { min: 40, max: 50, step: 5 },
};

function comboCount(ranges: FormState['ranges']) {
  return Object.values(ranges)
    .filter((r) => r.on)
    .reduce((a, r) => a * (Math.floor((r.max - r.min) / r.step + 1e-9) + 1), 1);
}

function buildRequest(f: FormState) {
  const req: Record<string, unknown> = {
    symbol: f.symbol,
    timeframe: f.timeframe,
    strategy: f.strategy,
    startDate: new Date(f.startDate).toISOString(),
    endDate: new Date(`${f.endDate}T23:59:59Z`).toISOString(),
    initialCapital: Math.round(fromDisplay(f.initialCapital) * 100) / 100,
    positionSize: f.positionSizePct / 100,
    stopLoss: f.stopLossPct > 0 ? f.stopLossPct / 100 : undefined,
    takeProfit: f.takeProfitPct > 0 ? f.takeProfitPct / 100 : undefined,
    fee: f.feePct / 100,
    slippage: f.slippagePct / 100,
    mode: f.mode,
    params: Object.keys(f.params).length ? f.params : undefined,
    monteCarlo: { iterations: 1000, drawdownThreshold: 20 },
  };
  const active = Object.fromEntries(Object.entries(f.ranges).filter(([, r]) => r.on).map(([k, r]) => [k, { min: r.min, max: r.max, step: r.step }]));
  if (f.mode === 'out-of-sample' || f.mode === 'optimization') req.outOfSample = { splitRatio: f.splitRatio };
  if (f.mode === 'walk-forward') req.walkForward = { trainDays: f.trainDays, testDays: f.testDays };
  if ((f.mode === 'optimization' || f.mode === 'walk-forward') && Object.keys(active).length) req.optimization = { ranges: active, objective: f.objective, maxCombinations: f.maxCombinations };
  if (f.mode === 'matrix') req.matrix = { symbols: f.matrixSymbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean), timeframes: f.matrixTimeframes };
  return req;
}

function BacktestForm({ onStarted }: { onStarted: (id: string) => void }) {
  const { data: config } = useConfig();
  const [f, setF] = useState<FormState>(initial);
  const qc = useQueryClient();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const strategy = config?.strategies.find((s) => s.id === f.strategy);
  const run = useMutation({
    mutationFn: () => api<{ jobId: string }>('/api/backtest', { method: 'POST', json: buildRequest(f) }),
    onSuccess: (r) => {
      onStarted(r.jobId);
      void qc.invalidateQueries({ queryKey: ['backtests'] });
    },
  });
  const combos = comboCount(f.ranges);
  const optimizable = [...Object.entries(strategy?.defaultParams ?? {}).filter(([, v]) => typeof v === 'number').map(([k]) => k), 'stopLoss', 'takeProfit'];

  return (
    <Card>
      <CardHeader title="Konfigurasi backtest" subtitle="Sinyal saat candle close dieksekusi di open candle berikutnya — tanpa look-ahead" />
      <CardBody className="space-y-4">
        <Segmented<Mode>
          value={f.mode}
          onChange={(m) => set('mode', m)}
          className="flex w-full flex-wrap"
          options={[
            { value: 'standard', label: 'Standar' },
            { value: 'out-of-sample', label: 'In/Out-of-Sample' },
            { value: 'optimization', label: 'Optimasi' },
            { value: 'walk-forward', label: 'Walk-Forward' },
            { value: 'matrix', label: 'Koin × TF' },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          {f.mode !== 'matrix' ? (
            <Field label="Koin">
              <Input value={f.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            </Field>
          ) : (
            <Field label="Koin (pisahkan dengan koma)" className="col-span-2">
              <Input value={f.matrixSymbols} onChange={(e) => set('matrixSymbols', e.target.value.toUpperCase())} />
            </Field>
          )}
          <Field label="Strategi" className={f.mode === 'matrix' ? 'col-span-2' : ''}>
            <Select value={f.strategy} onChange={(e) => setF((s) => ({ ...s, strategy: e.target.value, ranges: {}, params: {} }))}>
              {config?.strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          {f.mode !== 'matrix' ? (
            <Field label="Timeframe">
              <Select value={f.timeframe} onChange={(e) => set('timeframe', e.target.value)}>
                {(config?.backtestTimeframes ?? ['15m', '1h', '4h', '1d']).map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Timeframe" className="col-span-2">
              <div className="flex gap-2">
                {['15m', '1h', '4h', '1d'].map((t) => (
                  <label key={t} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={f.matrixTimeframes.includes(t)} onChange={(e) => set('matrixTimeframes', e.target.checked ? [...f.matrixTimeframes, t] : f.matrixTimeframes.filter((x) => x !== t))} />
                    {t.toUpperCase()}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Field label={`Initial capital (${currencySymbol()})`} hint={displayCurrency() === 'IDR' ? `≈ ${fmtNum(fromDisplay(f.initialCapital), 0)} USDT` : undefined}>
            <Input type="number" min={1} value={f.initialCapital} onChange={(e) => set('initialCapital', Number(e.target.value))} />
          </Field>
          <Field label="Tanggal mulai">
            <Input type="date" value={f.startDate} max={f.endDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field label="Tanggal akhir">
            <Input type="date" value={f.endDate} max={iso(new Date())} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
          <Field label="Ukuran posisi (% ekuitas)">
            <Input type="number" min={1} max={100} step={1} value={f.positionSizePct} onChange={(e) => set('positionSizePct', Number(e.target.value))} />
          </Field>
          <Field label="Stop loss (%)" hint="0 = nonaktif">
            <Input type="number" min={0} step={0.5} value={f.stopLossPct} onChange={(e) => set('stopLossPct', Number(e.target.value))} />
          </Field>
          <Field label="Take profit (%)" hint="0 = nonaktif">
            <Input type="number" min={0} step={0.5} value={f.takeProfitPct} onChange={(e) => set('takeProfitPct', Number(e.target.value))} />
          </Field>
          <Field label="Biaya trading (% per sisi)">
            <Input type="number" min={0} step={0.01} value={f.feePct} onChange={(e) => set('feePct', Number(e.target.value))} />
          </Field>
          <Field label="Slippage (% per sisi)">
            <Input type="number" min={0} step={0.01} value={f.slippagePct} onChange={(e) => set('slippagePct', Number(e.target.value))} />
          </Field>
        </div>

        {strategy && f.mode !== 'matrix' && (
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-2">Parameter strategi</summary>
            <p className="px-3 text-[11px] text-ink-3">{strategy.description}</p>
            <div className="grid grid-cols-2 gap-3 p-3">
              {Object.entries(strategy.defaultParams).map(([k, def]) =>
                typeof def === 'boolean' ? (
                  <label key={k} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={Boolean(f.params[k] ?? def)} onChange={(e) => setF((s) => ({ ...s, params: { ...s.params, [k]: e.target.checked } }))} />
                    {k}
                  </label>
                ) : (
                  <Field key={k} label={k}>
                    <Input type="number" step="any" value={Number(f.params[k] ?? def)} onChange={(e) => setF((s) => ({ ...s, params: { ...s.params, [k]: Number(e.target.value) } }))} />
                  </Field>
                ),
              )}
            </div>
          </details>
        )}

        {(f.mode === 'out-of-sample' || f.mode === 'optimization') && (
          <Field label={`Porsi in-sample: ${Math.round(f.splitRatio * 100)}% · Out-of-sample: ${Math.round((1 - f.splitRatio) * 100)}%`}>
            <input type="range" min={0.5} max={0.9} step={0.05} value={f.splitRatio} onChange={(e) => set('splitRatio', Number(e.target.value))} className="w-full accent-[var(--color-primary)]" />
          </Field>
        )}
        {f.mode === 'walk-forward' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Periode training (hari)">
              <Input type="number" min={7} value={f.trainDays} onChange={(e) => set('trainDays', Number(e.target.value))} />
            </Field>
            <Field label="Periode test (hari)">
              <Input type="number" min={3} value={f.testDays} onChange={(e) => set('testDays', Number(e.target.value))} />
            </Field>
          </div>
        )}
        {(f.mode === 'optimization' || f.mode === 'walk-forward') && (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-2">Rentang pencarian parameter {f.mode === 'walk-forward' && <span className="font-normal text-ink-3">(opsional)</span>}</span>
              <Badge tone={combos > f.maxCombinations ? 'down' : 'blue'}>{combos} kombinasi</Badge>
            </div>
            <div className="space-y-1.5">
              {optimizable.map((k) => {
                const r = f.ranges[k] ?? { on: false, ...(RANGE_DEFAULTS[k] ?? { min: 0, max: 1, step: 1 }) };
                const upd = (patch: Partial<typeof r>) => setF((s) => ({ ...s, ranges: { ...s.ranges, [k]: { ...r, ...patch } } }));
                return (
                  <div key={k} className="grid grid-cols-[1fr_repeat(3,64px)] items-center gap-1.5 text-xs">
                    <label className="flex items-center gap-1.5 truncate">
                      <input type="checkbox" checked={r.on} onChange={(e) => upd({ on: e.target.checked })} />
                      {k}
                    </label>
                    {(['min', 'max', 'step'] as const).map((p) => (
                      <Input key={p} aria-label={`${k} ${p}`} disabled={!r.on} type="number" step="any" className="h-7 px-1.5 text-xs" value={r[p]} onChange={(e) => upd({ [p]: Number(e.target.value) })} />
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Tujuan (hanya training)">
                <Select value={f.objective} onChange={(e) => set('objective', e.target.value as FormState['objective'])}>
                  <option value="sharpe">Rasio Sharpe</option>
                  <option value="roi">ROI</option>
                  <option value="profitFactor">Profit factor</option>
                </Select>
              </Field>
              <Field label="Maks. kombinasi" hint="Batas maksimal 500">
                <Input type="number" min={1} max={500} value={f.maxCombinations} onChange={(e) => set('maxCombinations', Number(e.target.value))} />
              </Field>
            </div>
            <p className="mt-2 text-[11px] text-ink-3">Parameter dipilih hanya dari periode training; periode validasi/test tidak pernah dipakai untuk tuning.</p>
          </div>
        )}
        {run.error && <Notice tone="error">{(run.error as Error).message}</Notice>}
        <div className="flex gap-2">
          <Button onClick={() => run.mutate()} loading={run.isPending} disabled={f.mode === 'optimization' && combos <= 1} className="flex-1">
            {!run.isPending && <Play className="h-4 w-4" />} Jalankan Backtest
          </Button>
          <Button variant="outline" onClick={() => setF(initial())}>
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function MetricsGrid({ m }: { m: BacktestMetrics }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Modal Awal', fmtUsd(m.initialCapital)],
    ['Modal Akhir', fmtUsd(m.finalCapital)],
    ['Laba Bersih', <Change key="np" value={null} />, undefined],
    ['ROI', <Change key="roi" value={m.roi} />],
    ['Total Trade', m.totalTrades],
    ['Win Rate', m.winRate !== null ? `${m.winRate}%` : '–'],
    ['Menang / Kalah', `${m.winningTrades} / ${m.losingTrades}`],
    ['Profit Factor', m.profitFactor ?? '–'],
    ['Ekspektansi', fmtUsd(m.expectancy), m.expectancyPct !== null ? `${fmtPct(m.expectancyPct, 2)} / trade` : undefined],
    ['Max Drawdown', <span key="dd" className="text-down">{fmtPct(m.maxDrawdown)}</span>],
    ['Sharpe', fmtNum(m.sharpe)],
    ['Sortino', fmtNum(m.sortino)],
    ['Calmar', fmtNum(m.calmar)],
    ['Rata-rata Untung', fmtUsd(m.averageWin), fmtPct(m.averageWinPct)],
    ['Rata-rata Rugi', fmtUsd(m.averageLoss), fmtPct(m.averageLossPct)],
    ['Untung Terbesar', fmtUsd(m.largestWin)],
    ['Rugi Terbesar', fmtUsd(m.largestLoss)],
    ['Rata-rata Lama Tahan', fmtDuration(m.averageHoldingMs)],
    ['Biaya Dibayar', fmtUsd(m.totalFees)],
    ['Biaya Slippage', fmtUsd(m.totalSlippage)],
    ['ROI Beli & Tahan', <Change key="bh" value={m.buyAndHoldRoi} />],
    ['Eksposur', m.exposurePct !== null ? fmtPct(m.exposurePct, 1, false) : '–'],
  ];
  items[2] = ['Laba Bersih', <span key="np" className={m.netProfit >= 0 ? 'text-up' : 'text-down'}>{m.netProfit >= 0 ? '+' : ''}{fmtUsd(m.netProfit)}</span>];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 2xl:grid-cols-6">
      {items.map(([k, v, sub]) => (
        <Stat key={k} label={k} value={v} sub={sub} className="[&>div:nth-child(2)]:text-base" />
      ))}
    </div>
  );
}

function RiskPanel({ m, job }: { m: BacktestMetrics; job: BacktestJob }) {
  const warnings: string[] = [];
  if (m.maxDrawdown < -20) warnings.push(`Drawdown tinggi (${fmtPct(m.maxDrawdown)})`);
  if (m.totalTrades < 30) warnings.push(`Jumlah sampel rendah (${m.totalTrades} trade)`);
  if (m.valueAtRisk95 !== null && m.valueAtRisk95 > 3) warnings.push(`Volatilitas per candle tinggi (VaR95 ${m.valueAtRisk95}%)`);
  const oos = job.result?.outOfSample?.overfitting ?? job.result?.walkForward?.overfitting;
  if (oos?.overfit) warnings.push('Performa out-of-sample buruk');
  const rr = m.averageWin !== null && m.averageLoss ? Math.abs(m.averageWin / m.averageLoss) : null;
  return (
    <Card>
      <CardHeader title="Analisa Risiko" />
      <CardBody>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Max drawdown" value={<span className="text-down">{fmtPct(m.maxDrawdown)}</span>} />
          <Stat label="Value at Risk 95%" tip="VaR historis 1-candle dari ekuitas portofolio" value={m.valueAtRisk95 !== null ? `${m.valueAtRisk95}%` : '–'} />
          <Stat label="Rata-rata rugi" value={fmtUsd(m.averageLoss)} />
          <Stat label="Rugi terbesar" value={fmtUsd(m.largestLoss)} />
          <Stat label="Maks. rugi beruntun" value={m.maxConsecutiveLosses} />
          <Stat label="Rasio untung/rugi terealisasi" value={rr !== null ? rr.toFixed(2) : '–'} />
          <Stat label="Rata-rata MFE" tip="Pergerakan menguntungkan maksimum sebelum keluar" value={fmtPct(m.avgMfePct)} />
          <Stat label="Rata-rata MAE" tip="Pergerakan merugikan maksimum sebelum keluar" value={fmtPct(m.avgMaePct)} />
        </div>
        {warnings.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {warnings.map((w) => (
              <div key={w} className="flex items-center gap-2 text-[13px] text-warn">
                <ShieldAlert className="h-4 w-4" /> {w}
              </div>
            ))}
          </div>
        )}
        {m.ambiguousTrades > 0 && <p className="mt-3 text-xs text-ink-3">{m.ambiguousTrades} trade memiliki stop dan target dalam satu candle tanpa resolusi timeframe lebih kecil; dihitung konservatif sebagai stop loss.</p>}
      </CardBody>
    </Card>
  );
}

function TradeTable({ trades }: { trades: Trade[] }) {
  const [page, setPage] = useState(0);
  const per = 25;
  const rows = trades.slice(page * per, page * per + per);
  return (
    <>
      <Table>
        <THead>
          <TR>
            {['Masuk', 'Exit', 'Simbol', 'Jenis', 'Entry Px', 'Exit Px', 'Qty', 'Gross P&L', 'Fees', 'Slippage', 'Net P&L', 'Return', 'MFE', 'MAE', 'Holding', 'Exit Reason'].map((h) => (
              <TH key={h} className={['Masuk', 'Exit', 'Simbol', 'Jenis', 'Exit Reason'].includes(h) ? '' : 'text-right'}>
                {h}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((t, i) => (
            <TR key={i}>
              <TD>{fmtDateTime(t.entryTime)}</TD>
              <TD>{fmtDateTime(t.exitTime)}</TD>
              <TD>{baseAsset(t.symbol)}</TD>
              <TD>{t.side}</TD>
              <TD className="text-right">{fmtPrice(t.entryPrice)}</TD>
              <TD className="text-right">{fmtPrice(t.exitPrice)}</TD>
              <TD className="text-right">{fmtNum(t.quantity, 6)}</TD>
              <TD className="text-right">{fmtUsd(t.grossPnl)}</TD>
              <TD className="text-right text-ink-3">-{fmtUsd(t.fees)}</TD>
              <TD className="text-right text-ink-3">-{fmtUsd(t.slippageCost)}</TD>
              <TD className={cn('text-right font-medium', t.netPnl >= 0 ? 'text-up' : 'text-down')}>{fmtUsd(t.netPnl)}</TD>
              <TD className="text-right">
                <Change value={t.returnPct} />
              </TD>
              <TD className="text-right text-up">{fmtPct(t.mfePct, 1)}</TD>
              <TD className="text-right text-down">{fmtPct(t.maePct, 1)}</TD>
              <TD className="text-right">{fmtDuration(t.holdingMs)}</TD>
              <TD title={t.exitDetail}>
                <Badge tone={t.exitReason === 'TAKE_PROFIT' ? 'up' : t.exitReason === 'STOP_LOSS' ? 'down' : 'neutral'}>
                  {t.exitReason.replace('_', ' ')}
                  {t.ambiguous && ' *'}
                </Badge>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {trades.length > per && (
        <div className="flex items-center justify-between px-4 py-3 text-xs text-ink-3">
          <span>
            {page * per + 1}–{Math.min(trades.length, (page + 1) * per)} dari {trades.length}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Sebelumnya
            </Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * per >= trades.length} onClick={() => setPage(page + 1)}>
              Berikutnya
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function MetricCompare({ a, b, la, lb }: { a: BacktestMetrics; b: BacktestMetrics; la: string; lb: string }) {
  const rows: [string, (m: BacktestMetrics) => React.ReactNode][] = [
    ['ROI', (m) => <Change value={m.roi} />],
    ['Win Rate', (m) => (m.winRate !== null ? `${m.winRate}%` : '–')],
    ['Trade', (m) => m.totalTrades],
    ['Profit Factor', (m) => m.profitFactor ?? '–'],
    ['Sharpe', (m) => fmtNum(m.sharpe)],
    ['Max Drawdown', (m) => fmtPct(m.maxDrawdown)],
  ];
  return (
    <Table>
      <THead>
        <TR>
          <TH>Metrik</TH>
          <TH className="text-right">{la}</TH>
          <TH className="text-right">{lb}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map(([k, f]) => (
          <TR key={k}>
            <TD className="text-ink-3">{k}</TD>
            <TD className="text-right">{f(a)}</TD>
            <TD className="text-right">{f(b)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Results({ id }: { id: string }) {
  const { data: job, error } = useBacktest(id);
  const done = job?.status === 'COMPLETED';
  const trades = useBacktestTrades(id, done && job?.mode !== 'matrix');
  const dd = useBacktestDrawdown(id, done && job?.mode !== 'matrix');
  if (error) return <Notice tone="error">{(error as Error).message}</Notice>;
  if (!job) return null;
  if (job.status === 'QUEUED' || job.status === 'RUNNING')
    return (
      <Card className="p-6">
        <div className="text-sm font-medium">Backtest {job.status === 'QUEUED' ? 'dalam antrean' : 'sedang berjalan'}…</div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(5, job.progress)}%` }} />
        </div>
      </Card>
    );
  if (job.status === 'FAILED') return <Notice tone="error" title="Backtest tidak dapat diselesaikan.">{job.error?.replace(/^Backtest could not be completed\.\s*/, '')}</Notice>;
  const r = job.result!;

  if (r.mode === 'matrix' && r.matrix)
    return (
      <Card>
        <CardHeader title="Performa per Koin & Timeframe" subtitle={`${job.strategy} · pengaturan sama untuk setiap run`} />
        <Table>
          <THead>
            <TR>
              {['Koin', 'Timeframe', 'Trade', 'Win Rate', 'ROI', 'Rata-rata Return', 'Profit Factor', 'Max DD', 'Sharpe'].map((h) => (
                <TH key={h} className={h === 'Koin' || h === 'Timeframe' ? '' : 'text-right'}>
                  {h}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {r.matrix.map((row) => (
              <TR key={row.symbol + row.timeframe}>
                <TD className="font-medium">{baseAsset(row.symbol)}</TD>
                <TD>{row.timeframe.toUpperCase()}</TD>
                {row.metrics ? (
                  <>
                    <TD className="text-right">{row.metrics.totalTrades}</TD>
                    <TD className="text-right">{row.metrics.winRate !== null ? `${row.metrics.winRate}%` : '–'}</TD>
                    <TD className="text-right">
                      <Change value={row.metrics.roi} />
                    </TD>
                    <TD className="text-right">{fmtPct(row.metrics.expectancyPct)}</TD>
                    <TD className="text-right">{row.metrics.profitFactor ?? '–'}</TD>
                    <TD className="text-right text-down">{fmtPct(row.metrics.maxDrawdown)}</TD>
                    <TD className="text-right">{fmtNum(row.metrics.sharpe)}</TD>
                  </>
                ) : (
                  <TD colSpan={7} className="text-down">
                    {row.error}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    );

  const m = r.metrics!;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Ringkasan Performa"
          subtitle={`${job.symbol} · ${job.timeframe.toUpperCase()} · ${r.strategyName ?? job.strategy} · ${fmtDate(r.startTime ?? 0, false)} → ${fmtDate(r.endTime ?? 0, false)}`}
          action={
            <Button size="sm" variant="outline" asChild>
              <a href={apiUrl(`/api/backtest/${id}/export`)} download>
                <Download className="h-3.5 w-3.5" /> Ekspor Hasil
              </a>
            </Button>
          }
        />
        <CardBody>
          {(r.warnings?.length ?? 0) > 0 && (
            <Notice tone="warn" className="mb-4" title="Peringatan">
              <ul>
                {r.warnings!.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            </Notice>
          )}
          <MetricsGrid m={m} />
          <p className="mt-4 text-[11px] text-ink-3">Sudah termasuk biaya trading dan slippage di kedua sisi. Performa masa lalu tidak menjamin hasil masa depan.</p>
        </CardBody>
      </Card>

      {r.outOfSample && (
        <Card>
          <CardHeader title="In-Sample vs Out-of-Sample" subtitle={`Dibagi pada ${fmtDate(r.outOfSample.splitTime, false)} · ${Math.round(r.outOfSample.splitRatio * 100)}% / ${Math.round((1 - r.outOfSample.splitRatio) * 100)}%`} />
          <CardBody className="space-y-3">
            {r.outOfSample.overfitting.overfit && <Notice tone="error" title="PERINGATAN: Strategi mungkin overfit terhadap data historis.">{r.outOfSample.overfitting.warnings.join(' ')}</Notice>}
            {!r.outOfSample.overfitting.overfit && r.outOfSample.overfitting.warnings.length > 0 && <Notice tone="warn">{r.outOfSample.overfitting.warnings.join(' ')}</Notice>}
            {r.outOfSample.optimization && (
              <p className="text-xs text-ink-3">
                {r.outOfSample.optimization.tested} kombinasi diuji pada data in-sample ({r.outOfSample.optimization.skipped} tidak valid dilewati). Terpilih: <code className="font-mono">{JSON.stringify(r.outOfSample.optimization.bestParams)}</code>
              </p>
            )}
          </CardBody>
          <MetricCompare a={r.outOfSample.inSample.metrics} b={r.outOfSample.outOfSample.metrics} la="In-Sample" lb="Out-of-Sample" />
          {r.outOfSample.optimization && r.outOfSample.optimization.top.length > 0 && (
            <details className="border-t border-border">
              <summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-ink-2">Hasil training terbaik</summary>
              <Table>
                <TBody>
                  {r.outOfSample.optimization.top.map((t, i) => (
                    <TR key={i}>
                      <TD className="font-mono text-xs">{JSON.stringify(t.params)}</TD>
                      <TD className="text-right">obj {fmtNum(t.objective)}</TD>
                      <TD className="text-right">
                        <Change value={t.metrics.roi} />
                      </TD>
                      <TD className="text-right">{t.metrics.totalTrades} trades</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </details>
          )}
        </Card>
      )}

      {r.walkForward && (
        <Card>
          <CardHeader title="Analisa Walk-Forward" subtitle={`${r.walkForward.trainDays} hari train → ${r.walkForward.testDays} hari test · ${r.walkForward.windows.length} jendela · hasil test digabungkan di bawah`} />
          <CardBody>
            {r.walkForward.overfitting.overfit && <Notice tone="error" title="PERINGATAN: Strategi mungkin overfit terhadap data historis.">{r.walkForward.overfitting.warnings.join(' ')}</Notice>}
            {!r.walkForward.overfitting.overfit && r.walkForward.overfitting.warnings.length > 0 && <Notice tone="warn">{r.walkForward.overfitting.warnings.join(' ')}</Notice>}
          </CardBody>
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>Train</TH>
                <TH>Test</TH>
                <TH>Parameter</TH>
                <TH className="text-right">ROI Train</TH>
                <TH className="text-right">ROI Test</TH>
                <TH className="text-right">Trade test</TH>
              </TR>
            </THead>
            <TBody>
              {r.walkForward.windows.map((w) => (
                <TR key={w.index}>
                  <TD>{w.index + 1}</TD>
                  <TD className="text-xs">
                    {fmtDate(w.trainFrom, false)} – {fmtDate(w.trainTo, false)}
                  </TD>
                  <TD className="text-xs">
                    {fmtDate(w.testFrom, false)} – {fmtDate(w.testTo, false)}
                  </TD>
                  <TD className="max-w-[220px] truncate font-mono text-[11px]" title={w.note ?? ''}>
                    {w.bestParams ? JSON.stringify(w.bestParams) : <span className="text-ink-3">{w.combinationsTested ? 'default*' : 'default'}</span>}
                  </TD>
                  <TD className="text-right">
                    <Change value={w.train.roi} />
                  </TD>
                  <TD className="text-right">
                    <Change value={w.test.roi} />
                  </TD>
                  <TD className="text-right">{w.test.totalTrades}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Ekuitas Portofolio" subtitle="Nilai pasar di setiap penutupan candle" />
          <CardBody>{dd.data && <EquityChart points={dd.data} initialCapital={job.request.initialCapital} splitTime={r.outOfSample?.splitTime} />}</CardBody>
        </Card>
        <RiskPanel m={m} job={job} />
      </div>
      <Card>
        <CardHeader title="Drawdown" subtitle="Ekuitas di bawah puncak berjalan" />
        <CardBody>{dd.data && <DrawdownChart points={dd.data} />}</CardBody>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Return Bulanan" />
          <CardBody>{r.monthly?.length ? <MonthlyChart data={r.monthly} /> : <p className="text-sm text-ink-3">Tidak ada data</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Distribusi Sinyal" subtitle="Kategori skor teknikal setiap candle yang dievaluasi" />
          <CardBody>{r.signalDistribution && Object.values(r.signalDistribution).some(Boolean) ? <DistributionChart data={r.signalDistribution} /> : <p className="text-sm text-ink-3">Tidak tersedia untuk mode ini</p>}</CardBody>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Performa per Kondisi Pasar" subtitle="Rezim saat sinyal (MA50/MA200) dan volatilitas vs. median 100 candle" />
          <Table>
            <THead>
              <TR>
                <TH>Kondisi</TH>
                <TH className="text-right">Trade</TH>
                <TH className="text-right">Win Rate</TH>
                <TH className="text-right">Rata-rata Return</TH>
              </TR>
            </THead>
            <TBody>
              {r.byRegime?.map((g) => (
                <TR key={g.regime}>
                  <TD>{g.regime}</TD>
                  <TD className="text-right">{g.trades}</TD>
                  <TD className="text-right">{g.winRate !== null ? `${g.winRate}%` : '–'}</TD>
                  <TD className="text-right">
                    <Change value={g.avgReturnPct} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        {r.monteCarlo ? (
          <Card>
            <CardHeader title="Simulasi Monte Carlo" subtitle={`${r.monteCarlo.iterations} resampling dari ${r.monteCarlo.trades} return trade`} />
            <CardBody>
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Median modal akhir" value={fmtUsd(r.monteCarlo.medianEndingCapital)} />
                <Stat label="Terburuk 5%" value={fmtUsd(r.monteCarlo.worst5PctEndingCapital)} />
                <Stat label="Terbaik 5%" value={fmtUsd(r.monteCarlo.best5PctEndingCapital)} />
                <Stat label={`P(drawdown > ${r.monteCarlo.drawdownThreshold}%)`} value={`${r.monteCarlo.probDrawdownBeyondThreshold}%`} />
                <Stat label="Median max drawdown" value={fmtPct(r.monteCarlo.medianMaxDrawdown)} />
                <Stat label="P(akhir di bawah modal awal)" value={`${r.monteCarlo.probLoss}%`} />
              </div>
              <p className="mt-3 text-[11px] text-ink-3">{r.monteCarlo.note}</p>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Simulasi Monte Carlo" />
            <CardBody>
              <p className="text-sm text-ink-3">Butuh minimal 5 trade.</p>
            </CardBody>
          </Card>
        )}
      </div>
      <Card>
        <CardHeader title="Riwayat Trade" subtitle={`${trades.data?.length ?? 0} trade · * = keluar ambigu dalam candle`} />
        {trades.data?.length ? <TradeTable trades={trades.data} /> : <EmptyState title="Tidak ada trade" >Kondisi masuk strategi tidak pernah terpenuhi di periode ini.</EmptyState>}
      </Card>
    </div>
  );
}

export default function BacktestPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  const history = useBacktests();
  const sel = (x: string) => setParams({ id: x });
  const recent = useMemo(() => history.data?.slice(0, 8) ?? [], [history.data]);
  return (
    <div>
      <PageHeader title="Backtest" description="Uji strategi pada data historis Binance dengan biaya, slippage, walk-forward, dan validasi out-of-sample." />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <BacktestForm onStarted={sel} />
          <Card>
            <CardHeader title="Run terbaru" />
            {recent.length ? (
              <ul className="divide-y divide-border">
                {recent.map((b) => (
                  <li key={b.id}>
                    <button onClick={() => sel(b.id)} className={cn('flex w-full items-center justify-between px-5 py-2.5 text-left text-xs hover:bg-bg', b.id === id && 'bg-primary-soft')}>
                      <span>
                        <span className="font-semibold">{b.mode === 'matrix' ? 'Matriks' : baseAsset(b.symbol)}</span> · {b.timeframe} · {b.mode}
                        <span className="block text-ink-3">{fmtDate(b.createdAt)}</span>
                      </span>
                      {b.status === 'COMPLETED' ? <Change value={b.roi} /> : <Badge tone={b.status === 'FAILED' ? 'down' : 'blue'}>{b.status}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-5 text-xs text-ink-3">Belum ada run.</p>
            )}
          </Card>
        </div>
        <div className="min-w-0">
          {id ? (
            <Results id={id} />
          ) : (
            <Card>
              <EmptyState icon={<FlaskConical className="h-8 w-8" />} title="Atur dan jalankan backtest">
                Hasil mencakup ringkasan performa, kurva ekuitas, drawdown, riwayat trade dengan MFE/MAE, return bulanan, distribusi sinyal, analisa risiko, dan Monte Carlo.
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

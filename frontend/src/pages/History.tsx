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
              <TH className="text-right">Signals</TH>
              <TH className="text-right">Evaluated</TH>
              <TH className="text-right">Win Rate</TH>
              <TH className="text-right">Avg Return</TH>
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
        <p className="px-5 pb-5 text-sm text-ink-3">No evaluated signals yet.</p>
      )}
    </Card>
  );
}

function PerformanceDashboard({ p }: { p: PerformanceResponse }) {
  const o = p.overall;
  return (
    <>
      <Card>
        <CardHeader title="AI Signal Performance" subtitle={`Live-tracked signals · evaluation window ${p.definitions.evaluationWindowCandles} candles`} />
        <CardBody>
          {o.evaluated < 30 && <Notice tone="warn" className="mb-4">Limited historical sample ({o.evaluated} evaluated). Performance statistics may be unreliable.</Notice>}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7">
            <Stat label="Total signals" value={o.total} sub={`${o.open} open · ${p.holdSignals} hold`} />
            <Stat label="Successful" value={<span className="text-up">{o.successful}</span>} />
            <Stat label="Failed" value={<span className="text-down">{o.failed}</span>} />
            <Stat label="Win rate" value={o.winRate !== null ? `${o.winRate}%` : '–'} />
            <Stat label="Average return" value={<Change value={o.averageReturn} />} />
            <Stat label="Median return" value={<Change value={o.medianReturn} />} />
            <Stat label="Best / Worst" value={<><Change value={o.bestReturn} /> / <Change value={o.worstReturn} /></>} />
            <Stat label="Avg time to target" value={fmtDuration(o.averageTimeToTargetMs)} />
            <Stat label="Avg time to stop" value={fmtDuration(o.averageTimeToStopMs)} />
            <Stat label="Ambiguous (excluded)" value={o.ambiguous} />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
            Success = {String(p.definitions.success)}. Failure = {String(p.definitions.failure)}. Excluded: {String(p.definitions.excluded)}. Historical performance is not a guarantee of future performance.
          </p>
        </CardBody>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title="By Coin" rows={p.byCoin} />
        <Breakdown title="By Signal" rows={p.bySignal} />
        <Breakdown title="By Timeframe" rows={p.byTimeframe} />
        <Breakdown title="By Market Condition" rows={p.byMarketCondition} />
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
        <option value="">Any</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    </Field>
  );
  const r = q.data;
  return (
    <Card>
      <CardHeader title="Historical Performance Query" subtitle='e.g. "How did BUY signals on BTC perform when RSI 50–70, MACD bullish and price > MA50?"' />
      <CardBody>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Symbol">
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
          <Field label="Signal">
            <Select value={f.signal} onChange={set('signal')}>
              <option value="">Any</option>
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
              <option value="">Any</option>
              <option value="bullish">Bullish</option>
              <option value="bearish">Bearish</option>
            </Select>
          </Field>
          {tri('priceAboveMa20', 'Price > MA20')}
          {tri('priceAboveMa50', 'Price > MA50')}
          {tri('volumeAboveAvg', 'Volume > avg')}
          <Field label="Holding (candles)">
            <Input type="number" min={1} max={200} value={f.horizon} onChange={set('horizon')} />
          </Field>
        </div>
        <Button className="mt-4" onClick={run} loading={q.isFetching}>
          {!q.isFetching && <Search className="h-4 w-4" />} Run query
        </Button>
        {q.error && <Notice tone="error" className="mt-4">{(q.error as Error).message}</Notice>}
        {r && (
          <div className="mt-5 rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs text-ink-3">{r.candlesScanned} candles scanned</span>
              <ReliabilityBadge reliability={r.reliability} n={r.sampleSize} />
            </div>
            {r.warning && <Notice tone="warn" className="mb-3">{r.warning}</Notice>}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Sample size" value={r.sampleSize} />
              <Stat label="Win rate" value={r.winRate !== null ? `${r.winRate}%` : '–'} />
              <Stat label="Average return" value={<Change value={r.averageReturn} />} />
              <Stat label="Median return" value={<Change value={r.medianReturn} />} />
              <Stat label="Best return" value={<Change value={r.bestReturn} />} />
              <Stat label="Worst return" value={<Change value={r.worstReturn} />} />
              <Stat label="Avg holding time" value={fmtDuration(r.averageHoldingMs)} />
              <Stat label="Max drawdown (in trade)" value={<Change value={r.maxDrawdown} />} />
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
      <PageHeader title="Signal History" description="Every signal issued on a closed candle, with its feature snapshot and tracked outcome." />
      {perf.data && !perf.data.unavailable && <PerformanceDashboard p={perf.data} />}
      {perf.data?.unavailable && <Notice tone="warn">{perf.data.message}</Notice>}
      <Card>
        <CardHeader
          title="Signals"
          subtitle={`${signals.data?.total ?? 0} total`}
          action={
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Coin" className="h-8 w-24" value={filters.symbol} onChange={(e) => setFilters({ ...filters, symbol: e.target.value })} />
              <Select className="h-8 w-32" value={filters.signal} onChange={(e) => setFilters({ ...filters, signal: e.target.value })}>
                <option value="">All signals</option>
                {['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'].map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </Select>
              <Select className="h-8 w-32" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">All results</option>
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
                <TH>Date</TH>
                <TH>Symbol</TH>
                <TH>TF</TH>
                <TH>Signal</TH>
                <TH className="text-right">Score</TH>
                <TH className="text-right">
                  <ConfidenceHeader />
                </TH>
                <TH className="text-right">Entry</TH>
                <TH className="text-right">Target</TH>
                <TH className="text-right">Stop</TH>
                <TH>Result</TH>
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
                    <Badge tone={RESULT_TONE[s.result ?? ''] ?? 'neutral'}>{(s.result ?? '–').replace('_', ' ')}</Badge>
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
          <EmptyState icon={<HistoryIcon className="h-8 w-8" />} title="No signals yet">
            Signals are recorded by the analysis job (every 15 minutes) on closed candles.
          </EmptyState>
        )}
      </Card>
      <HistoricalQuery />
    </div>
  );
}

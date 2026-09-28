import { Link } from 'react-router-dom';
import { ArrowRight, Gauge } from 'lucide-react';
import { useAnalysis, useBacktests, useDaily, useOverview } from '@/hooks/queries';
import { Card, CardBody, CardHeader, Notice, Skeleton, Stat, Badge } from '@/components/ui/primitives';
import { Change, HPR_TIP, ReliabilityBadge, Sparkline } from '@/components/ui/domain';
import { DailyTable } from '@/components/dashboard/DailyTable';
import { MarketSummaryPanel } from '@/components/dashboard/MarketSummaryPanel';
import { useLive } from '@/stores/live';
import { baseAsset, fmtCompact, fmtDate, fmtPct, fmtPrice } from '@/utils/format';
import type { Mover } from '@/types/api';

function MarketCards() {
  const { data, isLoading, error } = useOverview();
  const tickers = useLive((s) => s.tickers);
  if (error)
    return (
      <Notice tone="error" title="Binance market data temporarily unavailable.">
        {data?.status.lastSuccess ? `Last successful update: ${fmtDate(data.status.lastSuccess)}` : (error as Error).message}
      </Notice>
    );
  const cards = data?.cards.slice(0, 4) ?? [];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {isLoading &&
        Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="mt-2 h-6 w-24" />
          </Card>
        ))}
      {cards.map((c) => {
        const live = tickers[c.symbol];
        return (
          <Link key={c.symbol} to={`/analysis/${c.symbol}`}>
            <Card className="p-4 transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">{c.base}</span>
                <Change value={live?.changePct ?? c.changePct} className="text-xs" />
              </div>
              <div className="num mt-1.5 text-lg font-semibold tracking-tight">${fmtPrice(live?.price ?? c.price)}</div>
              <div className="mt-2 flex items-end justify-between">
                <span className="num text-[11px] text-ink-3">Vol {fmtCompact(c.quoteVolume)}</span>
                <Sparkline data={c.sparkline} width={80} height={26} />
              </div>
            </Card>
          </Link>
        );
      })}
      {data && (
        <Card className="col-span-2 p-4 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Total Market Cap</span>
            {data.global && <Change value={data.global.totalMarketCapChangePct} className="text-xs" />}
          </div>
          <div className="num mt-1.5 text-lg font-semibold tracking-tight">{data.global ? fmtCompact(data.global.totalMarketCap) : '–'}</div>
          <div className="num mt-2 text-[11px] text-ink-3">
            {data.global ? `BTC dom ${data.global.btcDominance.toFixed(1)}% · ETH ${data.global.ethDominance.toFixed(1)}%` : 'Market cap source unavailable'}
          </div>
        </Card>
      )}
    </div>
  );
}

function MoverList({ title, items, metric }: { title: string; items: Mover[]; metric: 'change' | 'range' }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</div>
      <ul className="space-y-1.5">
        {items.map((m) => (
          <li key={m.symbol} className="flex items-center justify-between gap-2 text-[13px]">
            <Link to={`/analysis/${m.symbol}`} className="truncate font-medium hover:text-primary">
              {baseAsset(m.symbol)}
            </Link>
            {metric === 'change' ? <Change value={m.changePct} /> : <span className="num text-ink-2">{fmtPct(m.rangePct, 0, false)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MarketBreadth() {
  const { data } = useOverview();
  if (!data) return null;
  const b = data.breadth;
  const advPct = b.total ? (b.advancers / b.total) * 100 : 0;
  const decPct = b.total ? (b.decliners / b.total) * 100 : 0;
  return (
    <Card>
      <CardHeader title="Market-Wide" subtitle={`${b.total} liquid USDT pairs on ${data.source === 'mock' ? 'mock feed' : 'Binance'}`} />
      <CardBody>
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-up">{b.advancers} advancing</span>
          <Badge tone={b.label === 'POSITIVE' ? 'up' : b.label === 'NEGATIVE' ? 'down' : 'neutral'}>Breadth {b.label.toLowerCase()}</Badge>
          <span className="font-medium text-down">{b.decliners} declining</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${b.advancers} advancing, ${b.decliners} declining`}>
          <div className="bg-up" style={{ width: `${advPct}%` }} />
          <div className="bg-white" style={{ width: 2 }} />
          <div className="ml-auto bg-down" style={{ width: `${decPct}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Stat label="Median 24h change" value={<Change value={b.medianChangePct} />} />
          <Stat label="Binance USDT volume" value={fmtCompact(data.binanceUsdtVolume24h)} />
          <Stat label="BTC Dominance" value={data.global ? `${data.global.btcDominance.toFixed(1)}%` : '–'} />
          <Stat label="Global 24h volume" value={data.global ? fmtCompact(data.global.totalVolume) : '–'} />
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <MoverList title="Top Gainers" items={data.gainers} metric="change" />
          <MoverList title="Top Losers" items={data.losers} metric="change" />
          <MoverList title="Most Volatile (range)" items={data.mostVolatile} metric="range" />
        </div>
      </CardBody>
    </Card>
  );
}

function HistoricalCard() {
  const { data } = useAnalysis('BTCUSDT', '4h');
  const h = data?.technical.historical;
  return (
    <Card>
      <CardHeader title="Historical Performance" subtitle="BTC · similar setups to the current 4H candle" action={h && <ReliabilityBadge reliability={h.reliability} n={h.sampleSize} />} />
      <CardBody>
        {!h ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Similar setups" value={h.sampleSize} />
              <Stat label="Hist. positive rate" tip={HPR_TIP} value={h.historicalPositiveRate !== null ? `${h.historicalPositiveRate}%` : '–'} />
              <Stat label="Median 24H return" value={<Change value={h.forward.find((f) => f.hours === 24)?.median} />} />
              <Stat label="Median 48H return" value={<Change value={h.forward.find((f) => f.hours === 48)?.median} />} />
            </div>
            <p className="mt-3 text-[11px] text-ink-3">{h.note}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function BacktestCard() {
  const { data } = useBacktests();
  const last = data?.find((b) => b.status === 'COMPLETED' && b.roi !== null && b.mode !== 'matrix');
  return (
    <Card>
      <CardHeader
        title="Backtest"
        subtitle={last ? `${last.symbol} · ${last.timeframe} · ${last.strategy}` : 'Latest completed run'}
        action={
          <Link to={last ? `/backtest?id=${last.id}` : '/backtest'} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <CardBody>
        {last ? (
          <div className="grid grid-cols-2 gap-4">
            <Stat label="ROI" value={<Change value={last.roi} />} />
            <Stat label="Win rate" value={last.winRate !== null ? `${last.winRate}%` : '–'} />
            <Stat label="Max drawdown" value={<span className="text-down">{fmtPct(last.maxDrawdown)}</span>} />
            <Stat label="Trades" value={last.totalTrades ?? '–'} />
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-ink-3">
            <Gauge className="h-5 w-5" /> No backtest yet. <Link to="/backtest" className="font-medium text-primary">Run one</Link>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function Dashboard() {
  const daily = useDaily();
  return (
    <div className="space-y-5">
      <MarketCards />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <MarketSummaryPanel />
        </div>
        <MarketBreadth />
      </div>
      <Card>
        <CardHeader
          title="AI Daily Analysis"
          subtitle={daily.data ? `${daily.data.timeframe.toUpperCase()} closed candles · updated ${fmtDate(daily.data.generatedAt)}` : undefined}
          action={
            <Link to="/signals" className="inline-flex items-center gap-1 text-xs font-medium text-primary">
              All signals <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <DailyTable rows={daily.data?.rows} loading={daily.isLoading} />
        {daily.error && <Notice tone="error" className="m-4">{(daily.error as Error).message}</Notice>}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <HistoricalCard />
        <BacktestCard />
      </div>
    </div>
  );
}

import { useParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAnalysis, useAnalyzeNow, useKlines } from '@/hooks/queries';
import { api } from '@/services/api';
import { useLive, useUi } from '@/stores/live';
import { Badge, Button, Card, CardBody, CardHeader, Notice, Segmented, Skeleton, Stat } from '@/components/ui/primitives';
import { Change, RiskBadge } from '@/components/ui/domain';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PriceChart } from '@/components/charts/PriceChart';
import { AiAnalysisCard } from '@/components/analysis/AiAnalysisCard';
import { baseAsset, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice } from '@/utils/format';
import type { Ticker } from '@/types/extra';

const TFS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;

function TickerHeader({ symbol }: { symbol: string }) {
  const { data } = useQuery({ queryKey: ['ticker', symbol], queryFn: () => api<Ticker>(`/api/market/ticker/${symbol}`), refetchInterval: 15_000 });
  const live = useLive((s) => s.tickers[symbol]);
  const qc = useQueryClient();
  const add = useMutation({ mutationFn: () => api('/api/watchlist', { method: 'POST', json: { symbol } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }) });
  const price = live?.price ?? data?.lastPrice;
  const change = live?.changePct ?? data?.priceChangePercent;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {baseAsset(symbol)} <span className="text-ink-3">/ USDT</span>
            </h1>
            <Button size="sm" variant="ghost" onClick={() => add.mutate()} loading={add.isPending} title="Add to watchlist">
              <Star className="h-4 w-4" /> {add.isSuccess ? 'Watching' : 'Watch'}
            </Button>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="num text-2xl font-semibold">${fmtPrice(price)}</span>
            <Change value={change} className="text-sm" />
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="24h High" value={fmtPrice(data?.highPrice)} />
          <Stat label="24h Low" value={fmtPrice(data?.lowPrice)} />
          <Stat label="24h Volume" value={fmtCompact(data?.quoteVolume)} sub={`${fmtNum(data?.volume, 0)} ${baseAsset(symbol)}`} />
          <Stat label="Market Cap" value="–" sub="Not provided by Binance" />
        </div>
      </div>
    </Card>
  );
}

export default function CoinDetail() {
  const { symbol: raw = 'BTCUSDT' } = useParams();
  const symbol = raw.toUpperCase();
  const tf = useUi((s) => s.timeframe);
  const setTf = useUi((s) => s.setTimeframe);
  const klines = useKlines(symbol, tf, 300);
  const analysis = useAnalysis(symbol, tf);
  const analyze = useAnalyzeNow(symbol, tf);
  const t = analysis.data?.technical;
  const s = t?.snapshot;
  const d = analysis.data?.derivatives;

  return (
    <div className="space-y-5">
      <TickerHeader symbol={symbol} />
      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Chart" action={<Segmented value={tf} onChange={setTf} options={TFS.map((x) => ({ value: x, label: x.toUpperCase() }))} />} />
          <CardBody>
            {klines.error ? (
              <Notice tone="error" title="Binance market data temporarily unavailable.">{(klines.error as Error).message}</Notice>
            ) : klines.data ? (
              <PriceChart symbol={symbol} timeframe={tf} data={klines.data} levels={s ? { support: s.priceAction.support, resistance: s.priceAction.resistance } : undefined} />
            ) : (
              <Skeleton className="h-[560px] w-full" />
            )}
          </CardBody>
        </Card>
        <div className="xl:col-span-2">
          {analysis.error && <Notice tone="error" title="Analysis unavailable">{(analysis.error as Error).message}</Notice>}
          {analysis.data ? <AiAnalysisCard data={analysis.data} onAnalyze={(f) => analyze.mutate(f)} analyzing={analyze.isPending} /> : !analysis.error && <Skeleton className="h-[600px] w-full" />}
          {analyze.error && <Notice tone="error" className="mt-3">{(analyze.error as Error).message}</Notice>}
        </div>
      </div>

      {t && s && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card>
            <CardHeader title="Levels & Targets" subtitle="Computed from support/resistance, swings, Bollinger & ATR" action={<RiskBadge level={t.risk.level} />} />
            <CardBody>
              {t.levels ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Stat label="Entry reference" value={fmtPrice(t.levels.entry)} />
                    <Stat label={t.levels.direction === 'LONG' ? 'Target' : 'Bearish target'} value={fmtPrice(t.levels.target)} sub={t.levels.upsidePct !== null ? fmtPct(t.levels.upsidePct) : fmtPct(t.levels.downsidePct)} tone={t.levels.direction === 'LONG' ? 'text-up' : 'text-down'} />
                    <Stat label={t.levels.direction === 'LONG' ? 'Stop' : 'Invalidation'} value={fmtPrice(t.levels.stop)} sub={t.levels.direction === 'LONG' ? fmtPct(t.levels.downsidePct) : undefined} tone={t.levels.direction === 'LONG' ? 'text-down' : undefined} />
                    <Stat label="Risk / Reward" value={t.levels.riskReward ?? '–'} />
                  </div>
                  <ul className="mt-3 space-y-0.5 text-[11px] text-ink-3">
                    {t.levels.method.map((m) => (
                      <li key={m}>· {m}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-ink-3">Not enough data for levels.</p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4">
                <Stat label="Support" value={fmtPrice(s.priceAction.support)} />
                <Stat label="Resistance" value={fmtPrice(s.priceAction.resistance)} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Scenarios" subtitle="Engine-derived; AI only explains them" />
            <CardBody className="space-y-3">
              {t.scenarios && (
                <>
                  <div className="rounded-lg border border-up/30 bg-up-soft/50 p-3">
                    <div className="flex items-center justify-between">
                      <Badge tone="up">Bullish</Badge>
                      <span className="num text-sm font-semibold">
                        {fmtPrice(t.scenarios.bullish.target)} <Change value={t.scenarios.bullish.potential} className="text-xs" />
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-2">{analysis.data?.ai.analysis?.scenario.bullish.explanation ?? t.scenarios.bullish.trigger}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-bg p-3">
                    <div className="flex items-center justify-between">
                      <Badge tone="blue">Base</Badge>
                      <span className="num text-sm font-semibold">
                        {fmtPrice(t.scenarios.base.low)} – {fmtPrice(t.scenarios.base.high)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-2">{analysis.data?.ai.analysis?.scenario.base.explanation ?? t.scenarios.base.description}</p>
                  </div>
                  <div className="rounded-lg border border-down/30 bg-down-soft/50 p-3">
                    <div className="flex items-center justify-between">
                      <Badge tone="down">Bearish</Badge>
                      <span className="num text-sm font-semibold">
                        {fmtPrice(t.scenarios.bearish.target)} <Change value={t.scenarios.bearish.potential} className="text-xs" />
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-2">{analysis.data?.ai.analysis?.scenario.bearish.explanation ?? t.scenarios.bearish.trigger}</p>
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Derivatives" subtitle="Binance USDⓈ-M Futures · supporting evidence" />
            <CardBody>
              {d?.available ? (
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Funding rate" value={fmtPct(d.fundingRate, 4)} />
                  <Stat label="Open interest" value={fmtCompact(d.openInterestValue)} />
                  <Stat label="OI change (24h)" value={<Change value={d.openInterestChangePct} />} />
                  <Stat label="Long/Short ratio" value={fmtNum(d.longShortRatio, 2)} />
                  <Stat label="Futures volume" value={fmtCompact(d.futuresQuoteVolume)} />
                  <Stat label="Liquidations" value="–" sub="No public REST source" />
                </div>
              ) : (
                <Notice tone="info">Futures data unavailable{d?.error ? `: ${d.error}` : ''}. Binance Futures may be restricted in this region.</Notice>
              )}
              {analysis.data?.fearGreed && (
                <div className="mt-4 border-t border-border pt-4">
                  <Stat label="Fear & Greed index" value={`${analysis.data.fearGreed.value} · ${analysis.data.fearGreed.classification}`} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {t && s && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Technical Indicators" subtitle={`Closed ${t.timeframe.toUpperCase()} candle · ${t.candlesAnalyzed} candles analysed`} />
            <Table>
              <TBody>
                {(
                  [
                    ['SMA 20 / 50 / 200', `${fmtPrice(s.sma20)} / ${fmtPrice(s.sma50)} / ${fmtPrice(s.sma200)}`],
                    ['EMA 20 / 50', `${fmtPrice(s.ema20)} / ${fmtPrice(s.ema50)}`],
                    ['ADX', fmtNum(s.adx, 1)],
                    ['RSI (14)', fmtNum(s.rsi, 1)],
                    ['MACD / Signal / Hist', `${fmtNum(s.macd, 4)} / ${fmtNum(s.macdSignal, 4)} / ${fmtNum(s.macdHistogram, 4)} (${s.macdState.replace('_', ' ')})`],
                    ['Stoch RSI K / D', `${fmtNum(s.stochRsiK, 1)} / ${fmtNum(s.stochRsiD, 1)}`],
                    ['ROC (10)', fmtPct(s.roc)],
                    ['Bollinger %B', fmtNum(s.bbPercentB, 2)],
                    ['ATR (14)', `${fmtPrice(s.atr)} (${fmtPct(s.atrPct, 2, false)})`],
                    ['Historical volatility (ann.)', fmtPct(s.historicalVolatility, 1, false)],
                    ['Volume vs MA20', `${fmtNum(s.volumeRatio, 2)}x (${fmtPct(s.volumeChangePct, 1)})`],
                    ['OBV slope (10)', s.obvSlope === null ? '–' : s.obvSlope > 0 ? 'Rising' : 'Falling'],
                    ['Structure', `${s.priceAction.structure.replace('_', ' / ')}${s.priceAction.breakout ? ' · Breakout' : ''}${s.priceAction.breakdown ? ' · Breakdown' : ''}`],
                  ] as const
                ).map(([k, v]) => (
                  <TR key={k}>
                    <TD className="text-ink-3">{k}</TD>
                    <TD className="text-right">{v}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Score Breakdown" subtitle="Weights from config/scoring.ts" />
              <Table>
                <THead>
                  <TR>
                    <TH>Component</TH>
                    <TH className="text-right">Weight</TH>
                    <TH className="text-right">Points</TH>
                  </TR>
                </THead>
                <TBody>
                  {t.score.components.map((c) => (
                    <TR key={c.key}>
                      <TD>
                        {c.label}
                        {!c.available && <span className="ml-1 text-[10px] text-warn">(n/a – neutral)</span>}
                      </TD>
                      <TD className="text-right text-ink-3">{c.weight}</TD>
                      <TD className="text-right font-medium">{c.points.toFixed(1)}</TD>
                    </TR>
                  ))}
                  <TR>
                    <TD className="font-semibold">Total</TD>
                    <TD className="text-right text-ink-3">100</TD>
                    <TD className="text-right font-semibold">{t.technicalScore.toFixed(1)}</TD>
                  </TR>
                </TBody>
              </Table>
            </Card>
            <Card>
              <CardHeader title="Historical Forward Returns" subtitle={`${t.historical.sampleSize} similar setups · returns after N candles`} />
              <Table>
                <THead>
                  <TR>
                    <TH>After</TH>
                    <TH className="text-right">Median</TH>
                    <TH className="text-right">Average</TH>
                    <TH className="text-right">Best</TH>
                    <TH className="text-right">Worst</TH>
                    <TH className="text-right">Positive</TH>
                  </TR>
                </THead>
                <TBody>
                  {t.historical.forward.map((f) => (
                    <TR key={f.candles}>
                      <TD>
                        {f.label} <span className="text-[11px] text-ink-3">({f.candles}c)</span>
                      </TD>
                      <TD className="text-right">
                        <Change value={f.median} />
                      </TD>
                      <TD className="text-right">
                        <Change value={f.average} />
                      </TD>
                      <TD className="text-right text-up">{fmtPct(f.best)}</TD>
                      <TD className="text-right text-down">{fmtPct(f.worst)}</TD>
                      <TD className="text-right">{f.positiveRate !== null ? `${f.positiveRate}%` : '–'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className="px-5 py-3 text-[11px] text-ink-3">{t.historical.note}</p>
            </Card>
          </div>
        </div>
      )}
      {t?.dataQuality.warnings.length ? <Notice tone="warn" title="Data quality warning">{t.dataQuality.warnings.join(' ')}</Notice> : null}
      <p className="text-[11px] text-ink-3">Last analysis candle: {t ? fmtDate(t.candleTime) : '–'} · Source: {analysis.data?.source ?? '–'}</p>
    </div>
  );
}

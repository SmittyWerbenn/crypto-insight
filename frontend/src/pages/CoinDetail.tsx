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
import { TermLabel } from '@/components/ui/glossary-tip';
import { AiAnalysisCard } from '@/components/analysis/AiAnalysisCard';
import { baseAsset, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, fmtPriceSym, toDisplay } from '@/utils/format';
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
            <Button size="sm" variant="ghost" onClick={() => add.mutate()} loading={add.isPending} title="Tambah ke watchlist">
              <Star className="h-4 w-4" /> {add.isSuccess ? 'Dipantau' : 'Pantau'}
            </Button>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="num text-2xl font-semibold">{fmtPriceSym(price)}</span>
            <Change value={change} className="text-sm" />
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Tertinggi 24j" value={fmtPrice(data?.highPrice)} />
          <Stat label="Terendah 24j" value={fmtPrice(data?.lowPrice)} />
          <Stat label="Volume 24j" value={fmtCompact(data?.quoteVolume)} sub={`${fmtNum(data?.volume, 0)} ${baseAsset(symbol)}`} />
          <Stat label="Kapitalisasi Pasar" value="–" sub="Tidak disediakan Binance" />
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
          <CardHeader title="Grafik" action={<Segmented value={tf} onChange={setTf} options={TFS.map((x) => ({ value: x, label: x.toUpperCase() }))} />} />
          <CardBody>
            {klines.error ? (
              <Notice tone="error" title="Data pasar Binance sementara tidak tersedia.">{(klines.error as Error).message}</Notice>
            ) : klines.data ? (
              <PriceChart symbol={symbol} timeframe={tf} data={klines.data} levels={s ? { support: s.priceAction.support, resistance: s.priceAction.resistance } : undefined} />
            ) : (
              <Skeleton className="h-[560px] w-full" />
            )}
          </CardBody>
        </Card>
        <div className="xl:col-span-2">
          {analysis.error && <Notice tone="error" title="Analisa tidak tersedia">{(analysis.error as Error).message}</Notice>}
          {analysis.data ? <AiAnalysisCard data={analysis.data} onAnalyze={(f) => analyze.mutate(f)} analyzing={analyze.isPending} /> : !analysis.error && <Skeleton className="h-[600px] w-full" />}
          {analyze.error && <Notice tone="error" className="mt-3">{(analyze.error as Error).message}</Notice>}
        </div>
      </div>

      {t && s && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card>
            <CardHeader title="Level & Target" subtitle="Dihitung dari support/resistance, swing, Bollinger & ATR" action={<RiskBadge level={t.risk.level} />} />
            <CardBody>
              {t.levels ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Stat label="Harga acuan masuk" value={fmtPrice(t.levels.entry)} />
                    <Stat label={t.levels.direction === 'LONG' ? 'Target' : 'Target bearish'} value={fmtPrice(t.levels.target)} sub={t.levels.upsidePct !== null ? fmtPct(t.levels.upsidePct) : fmtPct(t.levels.downsidePct)} tone={t.levels.direction === 'LONG' ? 'text-up' : 'text-down'} />
                    <Stat label={t.levels.direction === 'LONG' ? 'Stop' : 'Invalidasi'} value={fmtPrice(t.levels.stop)} sub={t.levels.direction === 'LONG' ? fmtPct(t.levels.downsidePct) : undefined} tone={t.levels.direction === 'LONG' ? 'text-down' : undefined} />
                    <Stat label="Risiko / Imbalan" value={t.levels.riskReward ?? '–'} />
                  </div>
                  <ul className="mt-3 space-y-0.5 text-[11px] text-ink-3">
                    {t.levels.method.map((m) => (
                      <li key={m}>· {m}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-ink-3">Data belum cukup untuk menghitung level.</p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4">
                <Stat label="Support" value={fmtPrice(s.priceAction.support)} />
                <Stat label="Resistance" value={fmtPrice(s.priceAction.resistance)} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Skenario" subtitle="Dari engine; AI hanya menjelaskan" />
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
                      <Badge tone="blue">Dasar</Badge>
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
            <CardHeader title="Derivatif" subtitle="Binance USDⓈ-M Futures · bukti pendukung" />
            <CardBody>
              {d?.available ? (
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Funding rate" value={fmtPct(d.fundingRate, 4)} />
                  <Stat label="Open interest" value={fmtCompact(d.openInterestValue)} />
                  <Stat label="Perubahan OI (24j)" value={<Change value={d.openInterestChangePct} />} />
                  <Stat label="Rasio Long/Short" value={fmtNum(d.longShortRatio, 2)} />
                  <Stat label="Volume futures" value={fmtCompact(d.futuresQuoteVolume)} />
                  <Stat label="Likuidasi" value="–" sub="Tidak ada sumber publik" />
                </div>
              ) : (
                <Notice tone="info">Data futures tidak tersedia. Binance Futures mungkin dibatasi di wilayah server ini.</Notice>
              )}
              {analysis.data?.fearGreed && (
                <div className="mt-4 border-t border-border pt-4">
                  <Stat label="Indeks Fear & Greed" value={`${analysis.data.fearGreed.value} · ${analysis.data.fearGreed.classification}`} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {t && s && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Indikator Teknikal" subtitle={`Candle ${t.timeframe.toUpperCase()} yang sudah close · ${t.candlesAnalyzed} candle dianalisa`} />
            <Table>
              <TBody>
                {(
                  [
                    ['SMA 20 / 50 / 200', `${fmtPrice(s.sma20)} / ${fmtPrice(s.sma50)} / ${fmtPrice(s.sma200)}`],
                    ['EMA 20 / 50', `${fmtPrice(s.ema20)} / ${fmtPrice(s.ema50)}`],
                    ['ADX', fmtNum(s.adx, 1)],
                    ['RSI (14)', fmtNum(s.rsi, 1)],
                    ['MACD / Signal / Hist', `${fmtNum(s.macd === null ? null : toDisplay(s.macd), 4)} / ${fmtNum(s.macdSignal === null ? null : toDisplay(s.macdSignal), 4)} / ${fmtNum(s.macdHistogram === null ? null : toDisplay(s.macdHistogram), 4)} (${s.macdState.replace('_', ' ')})`],
                    ['Stoch RSI K / D', `${fmtNum(s.stochRsiK, 1)} / ${fmtNum(s.stochRsiD, 1)}`],
                    ['ROC (10)', fmtPct(s.roc)],
                    ['Bollinger %B', fmtNum(s.bbPercentB, 2)],
                    ['ATR (14)', `${fmtPrice(s.atr)} (${fmtPct(s.atrPct, 2, false)})`],
                    ['Volatilitas historis (tahunan)', fmtPct(s.historicalVolatility, 1, false)],
                    ['Volume vs MA20', `${fmtNum(s.volumeRatio, 2)}x (${fmtPct(s.volumeChangePct, 1)})`],
                    ['OBV slope (10)', s.obvSlope === null ? '–' : s.obvSlope > 0 ? 'Naik' : 'Turun'],
                    ['Struktur', `${s.priceAction.structure.replace('_', ' / ')}${s.priceAction.breakout ? ' · Breakout' : ''}${s.priceAction.breakdown ? ' · Breakdown' : ''}`],
                  ] as const
                ).map(([k, v]) => (
                  <TR key={k}>
                    <TD className="text-ink-3">
                      <TermLabel text={k} />
                    </TD>
                    <TD className="text-right">{v}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Rincian Skor" subtitle="Bobot dari config/scoring.ts" />
              <Table>
                <THead>
                  <TR>
                    <TH>Komponen</TH>
                    <TH className="text-right">Bobot</TH>
                    <TH className="text-right">Poin</TH>
                  </TR>
                </THead>
                <TBody>
                  {t.score.components.map((c) => (
                    <TR key={c.key}>
                      <TD>
                        {c.label}
                        {!c.available && <span className="ml-1 text-[10px] text-warn">(n/a – netral)</span>}
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
              <CardHeader title="Return ke Depan Historis" subtitle={`${t.historical.sampleSize} setup serupa · return setelah N candle`} />
              <Table>
                <THead>
                  <TR>
                    <TH>Setelah</TH>
                    <TH className="text-right">Median</TH>
                    <TH className="text-right">Rata-rata</TH>
                    <TH className="text-right">Terbaik</TH>
                    <TH className="text-right">Terburuk</TH>
                    <TH className="text-right">Positif</TH>
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
      {t?.dataQuality.warnings.length ? <Notice tone="warn" title="Peringatan kualitas data">{t.dataQuality.warnings.join(' ')}</Notice> : null}
      <p className="text-[11px] text-ink-3">Candle analisa terakhir: {t ? fmtDate(t.candleTime) : '–'} · Sumber: {analysis.data?.source ?? '–'}</p>
    </div>
  );
}

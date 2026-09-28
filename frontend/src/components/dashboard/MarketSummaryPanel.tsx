import { Bot, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { useRefreshSummary, useSummary } from '@/hooks/queries';
import { Card, CardBody, CardHeader, Button, Notice, Skeleton, InfoTip, Badge } from '@/components/ui/primitives';
import { ConditionPill, CONFIDENCE_TIP } from '@/components/ui/domain';
import { fmtDate, fmtPrice, baseAsset } from '@/utils/format';

export function MarketSummaryPanel() {
  const { data, isLoading, error } = useSummary();
  const refresh = useRefreshSummary();
  const s = data?.ai.summary;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" /> Ringkasan Pasar AI
          </span>
        }
        subtitle={data?.ai.generatedAt ? `Hari ini · dibuat ${fmtDate(data.ai.generatedAt)}${data.ai.model ? ` · ${data.ai.model}` : ''}` : 'Hari ini'}
        action={
          <Button size="sm" variant="outline" onClick={() => refresh.mutate()} loading={refresh.isPending} disabled={data?.ai.status === 'NOT_CONFIGURED'}>
            {!refresh.isPending && <RefreshCw className="h-3.5 w-3.5" />} Analisa Sekarang
          </Button>
        }
      />
      <CardBody>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}
        {error && <Notice tone="error" title="Data pasar tidak tersedia">{(error as Error).message}</Notice>}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Kondisi Pasar</div>
                <div className="mt-1">
                  <ConditionPill condition={data.condition} />
                </div>
              </div>
              <div className="ml-auto flex flex-wrap gap-2 text-xs text-ink-2">
                <Badge tone="neutral">Rata-rata skor {data.context.averageTechnicalScore}</Badge>
                <Badge tone={data.breadth.label === 'POSITIVE' ? 'up' : data.breadth.label === 'NEGATIVE' ? 'down' : 'neutral'}>
                  Breadth {data.breadth.advancers}↑ / {data.breadth.decliners}↓
                </Badge>
                {data.fearGreed && <Badge tone="blue">Fear &amp; Greed {data.fearGreed.value} · {data.fearGreed.classification}</Badge>}
                {s?.confidence !== undefined && (
                  <Badge tone="neutral" title={CONFIDENCE_TIP}>
                    Keyakinan AI {s?.confidence === null ? 'N/A' : `${s?.confidence}%`}
                  </Badge>
                )}
              </div>
            </div>

            {data.ai.status === 'NOT_CONFIGURED' && (
              <Notice tone="info" className="mt-4" title="Analisa AI belum dikonfigurasi">
                Atur API key penyedia AI di backend (<code className="font-mono">ANTHROPIC_API_KEY</code> atau <code className="font-mono">AI_COMPAT_API_KEY</code>) untuk mengaktifkan interpretasi AI. Data teknikal pasar di bawah tetap tersedia lengkap.
              </Notice>
            )}
            {data.ai.status === 'UNAVAILABLE' && (
              <Notice tone="warn" className="mt-4" title="Analisa AI sementara tidak tersedia.">
                Data teknikal pasar tetap tersedia. {data.ai.generatedAt ? `Analisa AI terakhir: ${fmtDate(data.ai.generatedAt)}.` : ''}
              </Notice>
            )}

            {s ? (
              <div className="mt-4">
                <h2 className="text-base font-semibold text-ink">{s.headline}</h2>
                <p className="mt-2 text-[14px] leading-relaxed whitespace-pre-line text-ink-2">{s.summary}</p>
                <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                  {(
                    [
                      ['Tren BTC', s.btcTrend],
                      ['Altcoin', s.altcoinTrend],
                      ['Breadth Pasar', s.breadth],
                      ['Volume', s.volume],
                      ['Volatilitas', s.volatility],
                      ['Sentimen', s.sentiment],
                      ['Derivatif', s.derivatives],
                      ['Konteks Historis', s.historicalContext],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="border-l-2 border-primary/20 pl-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{k}</dt>
                      <dd className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg bg-up-soft/60 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-up">
                      <Bot className="h-3.5 w-3.5" /> Peluang
                    </div>
                    <ul className="space-y-1 text-[13px] text-ink-2">
                      {s.opportunities.length ? s.opportunities.map((o, i) => <li key={i}>• {o}</li>) : <li className="text-ink-3">Tidak ada.</li>}
                    </ul>
                  </div>
                  <div className="rounded-lg bg-down-soft/60 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-down">
                      <TriangleAlert className="h-3.5 w-3.5" /> Risiko
                    </div>
                    <ul className="space-y-1 text-[13px] text-ink-2">
                      {s.risks.map((o, i) => (
                        <li key={i}>• {o}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                {s.keyLevels.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {s.keyLevels.map((k) => (
                      <span key={k.symbol} className="num rounded-md border border-border px-2 py-1 text-xs text-ink-2">
                        <b className="text-ink">{baseAsset(k.symbol)}</b> S {fmtPrice(k.support)} · R {fmtPrice(k.resistance)}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
                  <InfoTip text={CONFIDENCE_TIP} />
                  {s.uncertainty} Interpretasi AI atas data yang dihitung backend. Angka di teks AI dalam USDT. Performa historis tidak menjamin hasil di masa depan.
                </p>
              </div>
            ) : (
              data.ai.status === 'OK' && <p className="mt-3 text-sm text-ink-3">Belum ada ringkasan.</p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

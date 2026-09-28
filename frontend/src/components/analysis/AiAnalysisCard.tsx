import { Check, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import type { CoinAnalysisResponse } from '@/types/api';
import { Badge, Button, Card, CardBody, CardHeader, InfoTip, Notice, Stat } from '@/components/ui/primitives';
import { CONFIDENCE_TIP, ConditionPill, Confidence, HPR_TIP, SCORE_TIP, ScoreBar, SignalBadge, Change, ReliabilityBadge } from '@/components/ui/domain';
import { baseAsset, fmtDate } from '@/utils/format';

export function AiAnalysisCard({ data, onAnalyze, analyzing }: { data: CoinAnalysisResponse; onAnalyze: (force: boolean) => void; analyzing: boolean }) {
  const t = data.technical;
  const ai = data.ai;
  const a = ai.analysis;
  const h = t.historical;
  const f24 = h.forward.find((f) => f.hours === 24)?.median ?? null;
  const f48 = h.forward.find((f) => f.hours === 48)?.median ?? null;
  const positives = t.score.factors.filter((f) => f.type === 'positive');
  const negatives = t.score.factors.filter((f) => f.type === 'negative');
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" /> AI Analysis — {baseAsset(data.symbol)}/USDT
          </span>
        }
        subtitle={`${t.timeframe.toUpperCase()} · candle close ${fmtDate(t.candleCloseTime + 1)}${ai.generatedAt ? ` · AI ${fmtDate(ai.generatedAt)}` : ''}`}
        action={
          <Button size="sm" onClick={() => onAnalyze(Boolean(a))} loading={analyzing} disabled={ai.status === 'NOT_CONFIGURED'}>
            {!analyzing && <RefreshCw className="h-3.5 w-3.5" />} Analisa Sekarang
          </Button>
        }
      />
      <CardBody>
        <div className="grid grid-cols-3 gap-4 rounded-lg bg-bg p-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Sinyal</div>
            <div className="mt-1.5">
              <SignalBadge signal={t.signal} className="text-xs" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Skor Teknikal <InfoTip text={SCORE_TIP} />
            </div>
            <div className="mt-1">
              <ScoreBar score={t.technicalScore} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Keyakinan AI <InfoTip text={CONFIDENCE_TIP} />
            </div>
            <div className="mt-1 text-lg font-semibold">{ai.status === 'OK' ? <Confidence value={a?.confidence} /> : <span className="text-ink-3">N/A</span>}</div>
          </div>
        </div>

        {ai.status === 'NOT_CONFIGURED' && (
          <Notice tone="info" className="mt-3" title="Analisa AI belum dikonfigurasi">
            Analisa teknikal di bawah dihitung oleh engine backend. Atur ANTHROPIC_API_KEY untuk menambahkan interpretasi Claude.
          </Notice>
        )}
        {ai.status === 'UNAVAILABLE' && (
          <Notice tone="warn" className="mt-3" title="Analisa AI sementara tidak tersedia.">
            Data teknikal pasar tetap tersedia.{ai.lastSuccessfulAt ? ` Analisa AI terakhir: ${fmtDate(ai.lastSuccessfulAt)} (ditampilkan di bawah).` : ''}
          </Notice>
        )}
        {ai.status === 'NOT_REQUESTED' && !a && (
          <Notice tone="info" className="mt-3">
            Belum ada interpretasi AI untuk candle ini. Tekan <b>Analisa Sekarang</b> untuk memintanya.
          </Notice>
        )}

        {a && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <ConditionPill condition={a.marketCondition} />
              {ai.cached && <Badge tone="neutral">cache</Badge>}
              {ai.model && <Badge tone="neutral">{ai.model}</Badge>}
            </div>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{a.summary}</p>
            <div className="mt-3 rounded-lg border border-border p-3 text-[13px] leading-relaxed text-ink-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Interpretasi teknikal</div>
              {a.technicalInterpretation}
              <div className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Bukti historis</div>
              {a.historicalEvidence}
              <div className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Alasan tingkat keyakinan</div>
              {a.confidenceRationale}
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-up">Alasan</div>
            <ul className="space-y-1.5 text-[13px]">
              {(a?.reasons ?? positives.map((p) => p.text)).map((r, i) => (
                <li key={i} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-up" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-down">Risiko</div>
            <ul className="space-y-1.5 text-[13px]">
              {(a?.risks ?? negatives.map((p) => p.text).concat(t.risk.reasons)).map((r, i) => (
                <li key={i} className="flex gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Konteks historis</span>
            <ReliabilityBadge reliability={h.reliability} n={h.sampleSize} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Setup serupa" value={h.sampleSize} />
            <Stat label="Tingkat positif historis" tip={HPR_TIP} value={h.historicalPositiveRate !== null ? `${h.historicalPositiveRate}%` : '–'} />
            <Stat label="Median 24J" value={<Change value={f24} />} />
            <Stat label="Median 48J" value={<Change value={f48} />} />
          </div>
          {(h.reliability === 'LIMITED' || h.reliability === 'INSUFFICIENT') && <p className="mt-2 text-xs text-warn">Sampel historis terbatas. Statistik performa mungkin kurang andal.</p>}
        </div>
        {a?.uncertainty && <p className="mt-3 text-xs text-ink-3">{a.uncertainty}</p>}
        {ai.consistencyWarnings.length > 0 && (
          <p className="mt-2 text-[11px] text-ink-3" title={ai.consistencyWarnings.join('\n')}>
            {ai.consistencyWarnings.length} nilai dari AI diganti dengan angka hasil hitungan engine.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

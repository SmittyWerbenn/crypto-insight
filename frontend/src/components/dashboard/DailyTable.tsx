import { Link } from 'react-router-dom';
import type { DailyRow } from '@/types/api';
import { Change, Confidence, ConfidenceHeader, HPR_TIP, RiskBadge, SCORE_TIP, ScoreBar, SignalBadge } from '@/components/ui/domain';
import { InfoTip, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { baseAsset, fmtPct, fmtPrice } from '@/utils/format';
import { useLive } from '@/stores/live';

export function DailyTable({ rows, loading, extra }: { rows: DailyRow[] | undefined; loading?: boolean; extra?: (r: DailyRow) => React.ReactNode }) {
  const tickers = useLive((s) => s.tickers);
  if (loading && !rows)
    return (
      <div className="space-y-2 px-4 pb-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  if (!rows?.length) return <div className="px-5 pb-5 text-sm text-ink-3">No analysis available.</div>;
  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden md:block">
        <Table>
          <THead>
            <TR>
              <TH>Coin</TH>
              <TH className="text-right">Price</TH>
              <TH className="text-right">24h</TH>
              <TH>Signal</TH>
              <TH>
                <span className="inline-flex items-center gap-1">
                  Technical Score <InfoTip text={SCORE_TIP} />
                </span>
              </TH>
              <TH className="text-right">
                <ConfidenceHeader />
              </TH>
              <TH className="text-right">Upside</TH>
              <TH className="text-right">Downside</TH>
              <TH className="text-right">
                <span className="inline-flex items-center gap-1">
                  Hist. Win Rate <InfoTip text={HPR_TIP} />
                </span>
              </TH>
              <TH>Risk</TH>
              {extra && <TH />}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const live = tickers[r.symbol];
              return (
                <TR key={r.symbol} className="hover:bg-slate-50/70">
                  <TD>
                    <Link to={`/analysis/${r.symbol}`} className="font-semibold text-ink hover:text-primary">
                      {baseAsset(r.symbol)}
                    </Link>
                  </TD>
                  <TD className="text-right">{fmtPrice(live?.price ?? r.price)}</TD>
                  <TD className="text-right">
                    <Change value={live?.changePct ?? r.changePct} />
                  </TD>
                  <TD>
                    <SignalBadge signal={r.signal} />
                  </TD>
                  <TD>
                    <ScoreBar score={r.technicalScore} />
                  </TD>
                  <TD className="text-right">
                    <Confidence value={r.aiConfidence} />
                  </TD>
                  <TD className="text-right text-up">{r.upsidePct !== null ? fmtPct(r.upsidePct, 1) : <span className="text-ink-3">–</span>}</TD>
                  <TD className="text-right text-down">{r.downsidePct !== null ? fmtPct(r.downsidePct, 1) : '–'}</TD>
                  <TD className="text-right">
                    {r.historicalPositiveRate !== null ? (
                      <span title={`n=${r.historicalSampleSize}`} className={r.historicalReliability === 'LIMITED' || r.historicalReliability === 'INSUFFICIENT' ? 'text-ink-3' : ''}>
                        {r.historicalPositiveRate.toFixed(1)}%<span className="ml-1 text-[10px] text-ink-3">n={r.historicalSampleSize}</span>
                      </span>
                    ) : (
                      '–'
                    )}
                  </TD>
                  <TD>
                    <RiskBadge level={r.risk} />
                  </TD>
                  {extra && <TD className="text-right">{extra(r)}</TD>}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
      {/* Mobile cards */}
      <div className="space-y-2 px-3 pb-3 md:hidden">
        {rows.map((r) => {
          const live = tickers[r.symbol];
          return (
            <div key={r.symbol} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <Link to={`/analysis/${r.symbol}`} className="font-semibold">
                  {baseAsset(r.symbol)}
                </Link>
                <SignalBadge signal={r.signal} />
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="num text-sm">{fmtPrice(live?.price ?? r.price)}</span>
                <Change value={live?.changePct ?? r.changePct} className="text-xs" />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-ink-3">Score</div>
                  <div className="num font-semibold">{r.technicalScore.toFixed(0)}/100</div>
                </div>
                <div>
                  <div className="text-ink-3">Upside / Down</div>
                  <div className="num">
                    <span className="text-up">{r.upsidePct !== null ? fmtPct(r.upsidePct, 1) : '–'}</span> / <span className="text-down">{fmtPct(r.downsidePct, 1)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-ink-3">Hist. win</div>
                  <div className="num">{r.historicalPositiveRate !== null ? `${r.historicalPositiveRate}%` : '–'}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-ink-3">
                <span>
                  AI conf. <Confidence value={r.aiConfidence} />
                </span>
                <RiskBadge level={r.risk} />
                {extra?.(r)}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

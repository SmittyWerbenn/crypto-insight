import { useState } from 'react';
import { useDaily } from '@/hooks/queries';
import { Card, CardHeader, Notice, PageHeader, Segmented } from '@/components/ui/primitives';
import { DailyTable } from '@/components/dashboard/DailyTable';
import { MarketSummaryPanel } from '@/components/dashboard/MarketSummaryPanel';
import { fmtDate } from '@/utils/format';

export default function Signals() {
  const [tf, setTf] = useState('4h');
  const daily = useDaily(tf);
  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Signals"
        description="Analytical signals from the technical engine, interpreted by Claude. Not trade instructions; nothing is executed automatically."
        actions={<Segmented value={tf} onChange={setTf} options={['1h', '4h', '1d'].map((x) => ({ value: x, label: x.toUpperCase() }))} />}
      />
      <Notice tone="info">
        Signal bands: <b>80–100</b> Strong Buy · <b>65–79</b> Buy · <b>45–64</b> Hold · <b>30–44</b> Sell/Reduce · <b>0–29</b> Strong Sell. Technical score is a weighted checklist, not a probability. Upside/downside come from
        support/resistance, swing levels and ATR.
      </Notice>
      <Card>
        <CardHeader title={`Signals · ${tf.toUpperCase()}`} subtitle={daily.data ? `Generated ${fmtDate(daily.data.generatedAt)}` : undefined} />
        <DailyTable rows={daily.data?.rows} loading={daily.isLoading} />
        {daily.data?.failed.length ? <p className="px-5 pb-4 text-xs text-warn">Unavailable: {daily.data.failed.join(', ')}</p> : null}
      </Card>
      <MarketSummaryPanel />
    </div>
  );
}

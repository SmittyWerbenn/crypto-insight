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
        title="Sinyal AI"
        description="Sinyal analitis dari engine teknikal, diinterpretasi oleh Claude. Bukan instruksi trading; tidak ada yang dieksekusi otomatis."
        actions={<Segmented value={tf} onChange={setTf} options={['1h', '4h', '1d'].map((x) => ({ value: x, label: x.toUpperCase() }))} />}
      />
      <Notice tone="info">
        Rentang sinyal: <b>80–100</b> Beli Kuat · <b>65–79</b> Beli · <b>45–64</b> Tahan · <b>30–44</b> Jual/Kurangi · <b>0–29</b> Jual Kuat. Skor teknikal adalah checklist berbobot, bukan probabilitas. Potensi naik/turun berasal dari
        support/resistance, level swing, dan ATR.
      </Notice>
      <Card>
        <CardHeader title={`Sinyal · ${tf.toUpperCase()}`} subtitle={daily.data ? `Dibuat ${fmtDate(daily.data.generatedAt)}` : undefined} />
        <DailyTable rows={daily.data?.rows} loading={daily.isLoading} />
        {daily.data?.failed.length ? <p className="px-5 pb-4 text-xs text-warn">Tidak tersedia: {daily.data.failed.join(', ')}</p> : null}
      </Card>
      <MarketSummaryPanel />
    </div>
  );
}

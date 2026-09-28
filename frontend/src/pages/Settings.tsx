import { useConfig, useStatus } from '@/hooks/queries';
import { Badge, Card, CardBody, CardHeader, PageHeader, Segmented } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useUi } from '@/stores/live';
import { useFx } from '@/stores/fx';
import { fmtDate, type DisplayCurrency } from '@/utils/format';

export default function Settings() {
  const { data: status } = useStatus();
  const preferred = useFx((s) => s.preferred);
  const setPreferred = useFx((s) => s.setPreferred);
  const rate = useFx((s) => s.rate);
  const { data: config } = useConfig();
  const tf = useUi((s) => s.timeframe);
  const setTf = useUi((s) => s.setTimeframe);
  return (
    <div className="space-y-5">
      <PageHeader title="Pengaturan" description="Instalasi lokal satu pengguna. Pengaturan server diatur lewat environment variable." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Preferensi" />
          <CardBody className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span>Mata uang tampilan</span>
              <Segmented<DisplayCurrency> value={preferred} onChange={setPreferred} options={[{ value: 'IDR', label: 'Rupiah (IDR)' }, { value: 'USD', label: 'USD / USDT' }]} />
            </div>
            <div className="flex items-center justify-between">
              <span>Kurs</span>
              <span className="num text-right text-xs text-ink-2">
                {rate ? (
                  <>
                    1 USDT = Rp {rate.rate.toLocaleString('id-ID', { maximumFractionDigits: 2 })}
                    <span className="block text-ink-3">
                      {rate.source} · {fmtDate(rate.updatedAt)}
                    </span>
                  </>
                ) : (
                  'Tidak tersedia'
                )}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-3">
              Data pasar Binance berdenominasi USDT dan dikonversi ke Rupiah hanya untuk tampilan. Angka di teks analisis AI tetap dalam USDT.
            </p>
            <div className="flex items-center justify-between">
              <span>Timeframe grafik default</span>
              <Segmented value={tf} onChange={setTf} options={['15m', '1h', '4h', '1d'].map((x) => ({ value: x, label: x.toUpperCase() }))} />
            </div>
            <div className="flex items-center justify-between">
              <span>Zona waktu</span>
              <Badge tone="blue">{config?.timezone ?? 'Asia/Jakarta'}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Bahasa AI</span>
              <Badge>{config?.aiLanguage === 'id' ? 'Bahasa Indonesia' : 'English'}</Badge>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Status sistem" />
          <Table>
            <TBody>
              <TR>
                <TD>Sumber data</TD>
                <TD className="text-right">{status?.mock ? <Badge tone="warn">MOCK</Badge> : <Badge tone="blue">Binance</Badge>}</TD>
              </TR>
              <TR>
                <TD>Claude AI</TD>
                <TD className="text-right">{status?.ai.configured ? <Badge tone="up">{status.ai.model}</Badge> : <Badge tone="warn">Belum dikonfigurasi</Badge>}</TD>
              </TR>
              <TR>
                <TD>PostgreSQL</TD>
                <TD className="text-right">{status?.database ? <Badge tone="up">Terhubung</Badge> : <Badge tone="down">Tidak tersedia</Badge>}</TD>
              </TR>
              <TR>
                <TD>Redis</TD>
                <TD className="text-right">{status?.redis ? <Badge tone="up">Terhubung</Badge> : <Badge tone="warn">Cadangan in-memory</Badge>}</TD>
              </TR>
              {status?.services.map((s) => (
                <TR key={s.name}>
                  <TD>{s.name}</TD>
                  <TD className="text-right text-xs">
                    {s.connected ? <Badge tone="up">OK</Badge> : <Badge tone="down">Mati</Badge>} <span className="text-ink-3">{s.lastSuccess ? fmtDate(s.lastSuccess) : s.lastError}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
      {config && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Bobot skor" subtitle="backend/src/config/scoring.ts" />
            <Table>
              <THead>
                <TR>
                  <TH>Komponen</TH>
                  <TH className="text-right">Bobot</TH>
                </TR>
              </THead>
              <TBody>
                {Object.entries(config.scoring.weights).map(([k, v]) => (
                  <TR key={k}>
                    <TD>{k}</TD>
                    <TD className="text-right">{v}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Rentang sinyal & ambang" />
            <Table>
              <TBody>
                {config.scoring.bands.map((b) => (
                  <TR key={b.signal}>
                    <TD>{config.scoring.labels[b.signal]}</TD>
                    <TD className="text-right">≥ {b.min}</TD>
                  </TR>
                ))}
                <TR>
                  <TD>Sampel minimum andal</TD>
                  <TD className="text-right">{config.historical.minReliableSample}</TD>
                </TR>
                <TR>
                  <TD>Sampel metrik penuh</TD>
                  <TD className="text-right">{config.historical.fullMetricsSample}</TD>
                </TR>
                <TR>
                  <TD>Jendela evaluasi sinyal</TD>
                  <TD className="text-right">{config.targets.evaluationWindow} candles</TD>
                </TR>
                <TR>
                  <TD>Simbol dipantau</TD>
                  <TD className="text-right text-xs">{config.trackedSymbols.join(', ')}</TD>
                </TR>
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}

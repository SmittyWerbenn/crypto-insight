import { useConfig, useStatus } from '@/hooks/queries';
import { Badge, Card, CardBody, CardHeader, PageHeader, Segmented } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useUi } from '@/stores/live';
import { fmtDate } from '@/utils/format';

export default function Settings() {
  const { data: status } = useStatus();
  const { data: config } = useConfig();
  const tf = useUi((s) => s.timeframe);
  const setTf = useUi((s) => s.setTimeframe);
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Local single-user installation. Server settings are configured through environment variables." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Preferences" />
          <CardBody className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span>Default chart timeframe</span>
              <Segmented value={tf} onChange={setTf} options={['15m', '1h', '4h', '1d'].map((x) => ({ value: x, label: x.toUpperCase() }))} />
            </div>
            <div className="flex items-center justify-between">
              <span>Timezone</span>
              <Badge tone="blue">{config?.timezone ?? 'Asia/Jakarta'}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>AI language</span>
              <Badge>{config?.aiLanguage === 'id' ? 'Bahasa Indonesia' : 'English'}</Badge>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="System status" />
          <Table>
            <TBody>
              <TR>
                <TD>Data source</TD>
                <TD className="text-right">{status?.mock ? <Badge tone="warn">MOCK</Badge> : <Badge tone="blue">Binance</Badge>}</TD>
              </TR>
              <TR>
                <TD>Claude AI</TD>
                <TD className="text-right">{status?.ai.configured ? <Badge tone="up">{status.ai.model}</Badge> : <Badge tone="warn">Not configured</Badge>}</TD>
              </TR>
              <TR>
                <TD>PostgreSQL</TD>
                <TD className="text-right">{status?.database ? <Badge tone="up">Connected</Badge> : <Badge tone="down">Unavailable</Badge>}</TD>
              </TR>
              <TR>
                <TD>Redis</TD>
                <TD className="text-right">{status?.redis ? <Badge tone="up">Connected</Badge> : <Badge tone="warn">In-memory fallback</Badge>}</TD>
              </TR>
              {status?.services.map((s) => (
                <TR key={s.name}>
                  <TD>{s.name}</TD>
                  <TD className="text-right text-xs">
                    {s.connected ? <Badge tone="up">OK</Badge> : <Badge tone="down">Down</Badge>} <span className="text-ink-3">{s.lastSuccess ? fmtDate(s.lastSuccess) : s.lastError}</span>
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
            <CardHeader title="Scoring weights" subtitle="backend/src/config/scoring.ts" />
            <Table>
              <THead>
                <TR>
                  <TH>Component</TH>
                  <TH className="text-right">Weight</TH>
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
            <CardHeader title="Signal bands & thresholds" />
            <Table>
              <TBody>
                {config.scoring.bands.map((b) => (
                  <TR key={b.signal}>
                    <TD>{config.scoring.labels[b.signal]}</TD>
                    <TD className="text-right">≥ {b.min}</TD>
                  </TR>
                ))}
                <TR>
                  <TD>Min reliable sample</TD>
                  <TD className="text-right">{config.historical.minReliableSample}</TD>
                </TR>
                <TR>
                  <TD>Full-metrics sample</TD>
                  <TD className="text-right">{config.historical.fullMetricsSample}</TD>
                </TR>
                <TR>
                  <TD>Signal evaluation window</TD>
                  <TD className="text-right">{config.targets.evaluationWindow} candles</TD>
                </TR>
                <TR>
                  <TD>Tracked symbols</TD>
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

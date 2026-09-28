import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDate, fmtPct, fmtUsd } from '@/utils/format';

const AXIS = { fontSize: 11, fill: '#8491a5' };
const tickDate = (t: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short' }).format(t);

function Tip({ active, payload, render }: { active?: boolean; payload?: { payload: Record<string, number> }[]; render: (p: Record<string, number>) => React.ReactNode }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">{render(payload[0].payload)}</div>;
}

export function EquityChart({ points, initialCapital, splitTime }: { points: { time: number; equity: number }[]; initialCapital: number; splitTime?: number }) {
  return (
    <div className="h-72" role="img" aria-label="Kurva ekuitas portofolio">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2a78d6" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#2a78d6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef1f6" vertical={false} />
          <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis tickFormatter={(v) => fmtUsd(v, 0)} tick={AXIS} axisLine={false} tickLine={false} width={72} domain={['auto', 'auto']} />
          <ReferenceLine y={initialCapital} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Modal awal', position: 'insideTopLeft', fontSize: 10, fill: '#8491a5' }} />
          {splitTime && <ReferenceLine x={splitTime} stroke="#eb6834" strokeDasharray="4 4" label={{ value: 'Out-of-sample →', position: 'insideTopRight', fontSize: 10, fill: '#b45309' }} />}
          <Tooltip content={<Tip render={(p) => (<><div className="text-ink-3">{fmtDate(p.time)}</div><div className="num font-semibold">{fmtUsd(p.equity)}</div></>)} />} />
          <Area type="monotone" dataKey="equity" stroke="#2a78d6" strokeWidth={2} fill="url(#eq)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DrawdownChart({ points }: { points: { time: number; drawdownPct: number; peak: number; equity: number }[] }) {
  return (
    <div className="h-48" role="img" aria-label="Grafik drawdown">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="#eef1f6" vertical={false} />
          <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickDate} tick={AXIS} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={AXIS} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            content={
              <Tip
                render={(p) => (
                  <>
                    <div className="text-ink-3">{fmtDate(p.time)}</div>
                    <div className="num font-semibold text-down">{fmtPct(p.drawdownPct)}</div>
                    <div className="num text-ink-3">Peak {fmtUsd(p.peak)} · Equity {fmtUsd(p.equity)}</div>
                  </>
                )}
              />
            }
          />
          <Area type="monotone" dataKey="drawdownPct" stroke="#d03b3b" strokeWidth={1.5} fill="#d03b3b" fillOpacity={0.12} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonthlyChart({ data }: { data: { month: string; returnPct: number }[] }) {
  return (
    <div className="h-56" role="img" aria-label="Return bulanan">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid stroke="#eef1f6" vertical={false} />
          <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} />
          <YAxis tickFormatter={(v) => `${v}%`} tick={AXIS} axisLine={false} tickLine={false} width={44} />
          <ReferenceLine y={0} stroke="#cbd5e1" />
          <Tooltip cursor={{ fill: '#f1f5f9' }} content={<Tip render={(p) => (<><div className="text-ink-3">{String(p.month)}</div><div className={`num font-semibold ${p.returnPct >= 0 ? 'text-up' : 'text-down'}`}>{fmtPct(p.returnPct)}</div></>)} />} />
          <Bar dataKey="returnPct" radius={[4, 4, 4, 4]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.month} fill={d.returnPct >= 0 ? '#0f8a45' : '#d03b3b'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DistributionChart({ data }: { data: Record<string, number> }) {
  const order = ['STRONG_SELL', 'SELL', 'HOLD', 'BUY', 'STRONG_BUY'];
  const rows = order.map((k) => ({ k, label: k.replace('_', ' '), v: data[k] ?? 0 }));
  const color: Record<string, string> = { STRONG_SELL: '#d03b3b', SELL: '#e98585', HOLD: '#94a3b8', BUY: '#5fb887', STRONG_BUY: '#0f8a45' };
  return (
    <div className="h-48" role="img" aria-label="Distribusi sinyal per candle">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="#eef1f6" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} content={<Tip render={(p) => (<><div className="text-ink-3">{String(p.label)}</div><div className="num font-semibold">{p.v} candles</div></>)} />} />
          <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.k} fill={color[r.k]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

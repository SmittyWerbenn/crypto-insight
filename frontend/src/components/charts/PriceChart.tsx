import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { KlinesResponse } from '@/hooks/queries';
import { useKlineStream } from '@/hooks/useStream';
import { cn } from '@/utils/cn';
import { fmtPrice } from '@/utils/format';

const C = {
  up: '#0f8a45',
  down: '#d03b3b',
  grid: '#eef1f6',
  text: '#64748b',
  ma20: '#2a78d6', // series 1 blue
  ma50: '#eb6834', // series 2 orange
  ma200: '#4a3aa7', // series 7 violet
  bb: '#94a3b8',
  signal: '#eb6834',
};

type Overlay = 'ma20' | 'ma50' | 'ma200' | 'bb';
const OVERLAYS: { key: Overlay; label: string; color: string }[] = [
  { key: 'ma20', label: 'MA20', color: C.ma20 },
  { key: 'ma50', label: 'MA50', color: C.ma50 },
  { key: 'ma200', label: 'MA200', color: C.ma200 },
  { key: 'bb', label: 'Bollinger', color: C.bb },
];

/** Data stays in USDT; the price axis and labels are formatted in the display currency. */
const priceFormat = { type: 'custom' as const, minMove: 1e-8, formatter: (p: number) => fmtPrice(p) };

const t = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const line = (times: number[], vals: (number | null)[]) => times.flatMap((tm, i) => (vals[i] === null || vals[i] === undefined ? [] : [{ time: t(tm), value: vals[i] as number }]));

/**
 * Candles + MA/Bollinger overlays with Volume, RSI and MACD panes (one y-scale per pane).
 * The live candle is updated from the backend kline SSE stream.
 */
export function PriceChart({ symbol, timeframe, data, levels }: { symbol: string; timeframe: string; data: KlinesResponse | undefined; levels?: { support: number | null; resistance: number | null } }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeries = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [overlays, setOverlays] = useState<Record<Overlay, boolean>>({ ma20: true, ma50: true, ma200: true, bb: false });

  useEffect(() => {
    if (!el.current || !data?.candles.length) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: C.text, fontFamily: 'Inter, sans-serif', fontSize: 11, panes: { separatorColor: '#e4e8f0' } },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#e4e8f0' },
      timeScale: { borderColor: '#e4e8f0', timeVisible: !['1d', '1w'].includes(timeframe), secondsVisible: false },
      localization: { timeFormatter: (ts: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(ts * 1000) },
    });
    chart.current = c;
    const times = data.candles.map((k) => k.openTime);
    const cs = c.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down, priceLineVisible: true, priceFormat });
    cs.setData(data.candles.map((k) => ({ time: t(k.openTime), open: k.open, high: k.high, low: k.low, close: k.close })));
    candleSeries.current = cs;
    const ind = data.indicators;
    if (ind) {
      if (overlays.ma20) c.addSeries(LineSeries, { color: C.ma20, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat }).setData(line(times, ind.sma20));
      if (overlays.ma50) c.addSeries(LineSeries, { color: C.ma50, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat }).setData(line(times, ind.sma50));
      if (overlays.ma200) c.addSeries(LineSeries, { color: C.ma200, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat }).setData(line(times, ind.sma200));
      if (overlays.bb) {
        for (const k of ['bbUpper', 'bbLower'] as const)
          c.addSeries(LineSeries, { color: C.bb, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat }).setData(line(times, ind[k]));
      }
    }
    if (levels?.support) cs.createPriceLine({ price: levels.support, color: C.up, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Support' });
    if (levels?.resistance) cs.createPriceLine({ price: levels.resistance, color: C.down, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Resistance' });

    // Volume pane
    const vs = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);
    vs.setData(data.candles.map((k) => ({ time: t(k.openTime), value: k.volume, color: k.close >= k.open ? 'rgba(15,138,69,0.45)' : 'rgba(208,59,59,0.45)' })));
    volSeries.current = vs;
    if (ind) c.addSeries(LineSeries, { color: C.ma20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 1).setData(line(times, ind.volumeMa));

    if (ind) {
      // RSI pane with 30/70 guides
      const rsi = c.addSeries(LineSeries, { color: C.ma200, lineWidth: 2, priceLineVisible: false }, 2);
      rsi.setData(line(times, ind.rsi));
      rsi.createPriceLine({ price: 70, color: '#cbd5e1', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
      rsi.createPriceLine({ price: 30, color: '#cbd5e1', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
      // MACD pane
      c.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 3).setData(
        times.flatMap((tm, i) => (ind.macdHistogram[i] === null ? [] : [{ time: t(tm), value: ind.macdHistogram[i] as number, color: (ind.macdHistogram[i] as number) >= 0 ? 'rgba(15,138,69,0.5)' : 'rgba(208,59,59,0.5)' }])),
      );
      c.addSeries(LineSeries, { color: C.ma20, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 3).setData(line(times, ind.macd));
      c.addSeries(LineSeries, { color: C.signal, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 3).setData(line(times, ind.macdSignal));
    }
    const panes = c.panes();
    panes[0]?.setStretchFactor(5);
    panes[1]?.setStretchFactor(1.1);
    panes[2]?.setStretchFactor(1.3);
    panes[3]?.setStretchFactor(1.3);
    c.timeScale().fitContent();
    return () => {
      c.remove();
      chart.current = null;
    };
  }, [data, overlays, timeframe, levels?.support, levels?.resistance]);

  useKlineStream(symbol, timeframe, (k) => {
    candleSeries.current?.update({ time: t(k.openTime), open: k.open, high: k.high, low: k.low, close: k.close });
    volSeries.current?.update({ time: t(k.openTime), value: k.volume, color: k.close >= k.open ? 'rgba(15,138,69,0.45)' : 'rgba(208,59,59,0.45)' });
  });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {OVERLAYS.map((o) => (
          <button
            key={o.key}
            onClick={() => setOverlays((s) => ({ ...s, [o.key]: !s[o.key] }))}
            aria-pressed={overlays[o.key]}
            className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium', overlays[o.key] ? 'border-border bg-surface text-ink' : 'border-transparent bg-bg text-ink-3')}
          >
            <span className="h-0.5 w-3 rounded" style={{ background: o.color, opacity: overlays[o.key] ? 1 : 0.4 }} />
            {o.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ink-3">Panel: Harga · Volume · RSI(14) · MACD(12,26,9)</span>
      </div>
      <div ref={el} className="h-[560px] w-full" role="img" aria-label={`${symbol} ${timeframe} candlestick chart with indicators`} />
    </div>
  );
}

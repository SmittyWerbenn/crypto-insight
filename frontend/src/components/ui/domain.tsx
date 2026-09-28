import { ArrowDownRight, ArrowUpRight, Minus, ShieldAlert } from 'lucide-react';
import type { MarketCondition, Signal } from '@/types/api';
import { cn } from '@/utils/cn';
import { fmtPct } from '@/utils/format';
import { Badge, InfoTip } from './primitives';

const SIGNAL_LABEL: Record<Signal, string> = { STRONG_BUY: 'Beli Kuat', BUY: 'Beli', HOLD: 'Tahan', SELL: 'Jual / Kurangi', STRONG_SELL: 'Jual Kuat' };

export function SignalBadge({ signal, className }: { signal: Signal; className?: string }) {
  const tone = signal === 'STRONG_BUY' || signal === 'BUY' ? 'up' : signal === 'HOLD' ? 'blue' : 'down';
  const Icon = tone === 'up' ? ArrowUpRight : tone === 'down' ? ArrowDownRight : Minus;
  return (
    <Badge tone={tone} className={cn(signal.startsWith('STRONG') && 'ring-1 ring-current/30', className)}>
      <Icon className="h-3 w-3" />
      {SIGNAL_LABEL[signal]}
    </Badge>
  );
}

const RISK_LABEL: Record<string, string> = { LOW: 'Rendah', LOW_MEDIUM: 'Rendah-Sedang', MEDIUM: 'Sedang', HIGH: 'Tinggi' };
export function RiskBadge({ level }: { level: string }) {
  const tone = level === 'HIGH' ? 'down' : level === 'MEDIUM' ? 'warn' : 'neutral';
  return (
    <Badge tone={tone}>
      {level === 'HIGH' && <ShieldAlert className="h-3 w-3" />}
      {RISK_LABEL[level] ?? level}
    </Badge>
  );
}

export const CONDITION_LABEL: Record<MarketCondition, string> = {
  BULLISH_STRONG: 'Bullish Kuat',
  BULLISH_MODERATE: 'Bullish Moderat',
  NEUTRAL: 'Netral',
  BEARISH_MODERATE: 'Bearish Moderat',
  BEARISH_STRONG: 'Bearish Kuat',
};

export function ConditionPill({ condition }: { condition: MarketCondition }) {
  const bull = condition.startsWith('BULLISH');
  const bear = condition.startsWith('BEARISH');
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-semibold', bull ? 'bg-up-soft text-up' : bear ? 'bg-down-soft text-down' : 'bg-primary-soft text-primary')}>
      {bull ? <ArrowUpRight className="h-4 w-4" /> : bear ? <ArrowDownRight className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
      {CONDITION_LABEL[condition].toUpperCase()}
    </span>
  );
}

export function Change({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className="text-ink-3">–</span>;
  return <span className={cn('num font-medium', value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-ink-2', className)}>{fmtPct(value)}</span>;
}

/** 0-100 technical score with band ticks at 30/45/65/80. */
export function ScoreBar({ score, compact }: { score: number; compact?: boolean }) {
  const color = score >= 65 ? 'bg-up' : score >= 45 ? 'bg-series-1' : 'bg-down';
  return (
    <div className="flex items-center gap-2">
      <span className="num w-9 text-right font-semibold">{score.toFixed(0)}</span>
      {!compact && (
        <div className="relative h-1.5 w-20 rounded-full bg-slate-100" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="Skor teknikal">
          <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.max(2, score)}%` }} />
          {[30, 45, 65, 80].map((t) => (
            <span key={t} className="absolute top-0 h-1.5 w-0.5 bg-white" style={{ left: `${t}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Confidence({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-ink-3" title="Tidak tersedia">N/A</span>;
  return <span className="num font-medium">{value.toFixed(0)}%</span>;
}

export const CONFIDENCE_TIP = 'Keyakinan AI mencerminkan kualitas dan konsistensi setup analisa saat ini berdasarkan data yang tersedia. BUKAN probabilitas harga naik atau trade akan untung.';
export const SCORE_TIP = 'Skor teknikal adalah checklist indikator berbobot (0–100). BUKAN probabilitas.';
export const HPR_TIP = 'Persentase setup historis serupa yang memberi return positif setelah horizon hasil. Perilaku historis, bukan ramalan.';

export function ConfidenceHeader() {
  return (
    <span className="inline-flex items-center gap-1">
      Keyakinan AI <InfoTip text={CONFIDENCE_TIP} />
    </span>
  );
}

export function Sparkline({ data, width = 96, height = 28, className }: { data: number[]; width?: number; height?: number; className?: string }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - 2 - ((v - min) / (max - min || 1)) * (height - 4)}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? 'var(--color-up)' : 'var(--color-down)'} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const RELIABILITY_LABEL: Record<string, string> = { GOOD: 'andal', MODERATE: 'cukup', LIMITED: 'terbatas', INSUFFICIENT: 'kurang' };

export function ReliabilityBadge({ reliability, n }: { reliability: string; n: number }) {
  const tone = reliability === 'GOOD' ? 'up' : reliability === 'MODERATE' ? 'blue' : 'warn';
  return (
    <Badge tone={tone} title={`Sample size ${n}`}>
      n={n} · {RELIABILITY_LABEL[reliability] ?? reliability.toLowerCase()}
    </Badge>
  );
}

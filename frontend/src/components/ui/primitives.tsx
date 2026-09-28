import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { AutoGlossaryTip } from './glossary-tip';

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)} {...p} />;
}

export function CardHeader({ title, subtitle, action, className }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5', className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-2">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pb-4 sm:px-5 sm:pb-5', className)} {...p} />;
}

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white hover:bg-primary/90',
        outline: 'border border-border bg-surface text-ink hover:bg-bg',
        ghost: 'text-ink-2 hover:bg-bg hover:text-ink',
        danger: 'text-down hover:bg-down-soft',
      },
      size: { sm: 'h-8 px-2.5 text-xs', md: 'h-9 px-3.5', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, ...p }, ref) => {
  if (asChild)
    return (
      <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...p}>
        {children}
      </Slot>
    );
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...p}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
});
Button.displayName = 'Button';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-slate-100 text-ink-2',
      blue: 'bg-primary-soft text-primary',
      up: 'bg-up-soft text-up',
      down: 'bg-down-soft text-down',
      warn: 'bg-warn-soft text-warn',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn('h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-primary focus:ring-2 focus:ring-primary/15', className)}
    {...p}
  />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn('h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/15', className)} {...p} />
));
Select.displayName = 'Select';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-2">
        {label}
        <AutoGlossaryTip label={label.replace(/\s*\(.*\)$/, '')} />
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button type="button" aria-label="Info" className={cn('inline-flex text-ink-3 hover:text-ink-2', className)}>
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={6} className="z-50 max-w-xs rounded-lg bg-ink px-3 py-2 text-xs leading-relaxed text-white shadow-lg">
            {text}
            <TooltipPrimitive.Arrow className="fill-ink" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function Notice({ tone = 'warn', title, children, className }: { tone?: 'warn' | 'info' | 'error'; title?: string; children?: React.ReactNode; className?: string }) {
  const styles = { warn: 'border-amber-200 bg-warn-soft text-amber-900', info: 'border-blue-200 bg-primary-soft text-blue-900', error: 'border-red-200 bg-down-soft text-red-900' }[tone];
  return (
    <div className={cn('flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed', styles, className)} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-[13px] text-ink-3">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, tip, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; tip?: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
        {label}
        {tip ? <InfoTip text={tip} /> : <AutoGlossaryTip label={label} />}
      </div>
      <div className={cn('num mt-1 truncate text-lg font-semibold text-ink', tone)}>{value}</div>
      {sub && <div className="num mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex rounded-lg border border-border bg-bg p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-md px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors', o.value === value ? 'bg-surface text-primary shadow-sm' : 'hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

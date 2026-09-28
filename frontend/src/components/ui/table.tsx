import * as React from 'react';
import { cn } from '@/utils/cn';
import { AutoGlossaryTip } from './glossary-tip';

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...p} />
    </div>
  );
}
export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} />;
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export function TR({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-border/70 last:border-0', className)} {...p} />;
}
export function TH({ className, children, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn('h-9 bg-slate-50/80 px-3 text-left text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap text-ink-3 first:pl-4 last:pr-4', className)} {...p}>
      {typeof children === 'string' ? (
        <span className="inline-flex items-center gap-1">
          {children}
          <AutoGlossaryTip label={children} />
        </span>
      ) : (
        children
      )}
    </th>
  );
}
export function TD({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('num h-11 px-3 whitespace-nowrap text-ink first:pl-4 last:pr-4', className)} {...p} />;
}

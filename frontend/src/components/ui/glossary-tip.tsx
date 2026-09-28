import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { findTerm, getTerm, type GlossaryTerm } from '@/data/glossary';
import { cn } from '@/utils/cn';

/** Ikon kecil yang menampilkan penjelasan istilah saat di-hover, dan membuka Kamus Istilah saat diklik. */
export function GlossaryTip({ term, className }: { term: GlossaryTerm; className?: string }) {
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <Link
            to={`/glossary#${term.id}`}
            aria-label={`Penjelasan: ${term.term}`}
            className={cn('inline-flex align-middle text-ink-3 normal-case hover:text-primary', className)}
            onClick={(e) => e.stopPropagation()}
          >
            <BookOpen className="h-3.5 w-3.5" />
          </Link>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={6} className="z-50 max-w-xs rounded-lg bg-ink px-3 py-2 text-xs leading-relaxed font-normal tracking-normal text-white normal-case shadow-lg">
            <div className="mb-0.5 font-semibold">{term.term}</div>
            {term.short}
            <div className="mt-1 text-[10px] text-slate-300">Klik ikon untuk penjelasan lengkap</div>
            <TooltipPrimitive.Arrow className="fill-ink" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/** Tip otomatis jika `label` cocok dengan istilah di kamus; tidak merender apa pun jika tidak cocok. */
export function AutoGlossaryTip({ label, id, className }: { label?: unknown; id?: string; className?: string }) {
  const term = id ? getTerm(id) : typeof label === 'string' ? findTerm(label) : undefined;
  return term ? <GlossaryTip term={term} className={className} /> : null;
}

/** Teks label + tip kamus (untuk baris tabel dsb.). */
export function TermLabel({ text, id }: { text: string; id?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {text}
      <AutoGlossaryTip label={text} id={id} />
    </span>
  );
}

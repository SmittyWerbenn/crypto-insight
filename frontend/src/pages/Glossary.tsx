import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BookOpen, Search } from 'lucide-react';
import { GLOSSARY, type GlossaryCategory } from '@/data/glossary';
import { Card, EmptyState, Input, PageHeader } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';

const CATEGORIES: GlossaryCategory[] = ['Dasar', 'Indikator', 'Harga & Level', 'Sinyal & Skor', 'Risiko & Performa', 'Backtest', 'Derivatif & Sentimen'];

export default function Glossary() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<GlossaryCategory | 'Semua'>('Semua');
  const { hash } = useLocation();
  const active = hash.replace('#', '');

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return GLOSSARY.filter((t) => (cat === 'Semua' || t.category === cat) && (!needle || [t.term, t.short, t.long, ...(t.aliases ?? [])].join(' ').toLowerCase().includes(needle)));
  }, [q, cat]);

  // Scroll to the term linked from a tooltip (/glossary#rsi)
  useEffect(() => {
    if (!active) return;
    setCat('Semua');
    setQ('');
    const t = setTimeout(() => document.getElementById(`term-${active}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kamus Istilah"
        description={`${GLOSSARY.length} istilah trading & analisa yang dipakai di aplikasi ini, dijelaskan dengan bahasa sederhana. Arahkan kursor ke ikon buku di seluruh aplikasi untuk penjelasan singkat.`}
      />
      <Card className="p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input autoFocus placeholder="Cari istilah, mis. RSI, drawdown, cut loss…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Cari istilah" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(['Semua', ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              aria-pressed={cat === c}
              className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', cat === c ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-ink-2 hover:bg-bg')}
            >
              {c}
            </button>
          ))}
        </div>
      </Card>

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen className="h-8 w-8" />} title="Istilah tidak ditemukan">
            Coba kata kunci lain.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((t) => (
            <Card key={t.id} id={`term-${t.id}`} className={cn('scroll-mt-24 p-5 transition-shadow', active === t.id && 'ring-2 ring-primary')}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold text-ink">{t.term}</h2>
                <span className="shrink-0 rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">{t.category}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-ink-2">{t.short}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t.long}</p>
              {t.example && (
                <p className="mt-2 rounded-lg bg-bg px-3 py-2 text-[13px] text-ink-2">
                  <span className="font-semibold text-ink">Contoh: </span>
                  {t.example}
                </p>
              )}
              {t.inApp && (
                <p className="mt-2 text-xs text-ink-3">
                  <span className="font-semibold">Di aplikasi: </span>
                  {t.inApp}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

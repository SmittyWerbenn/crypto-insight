import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  CandlestickChart,
  FlaskConical,
  History,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Newspaper,
  Search,
  Settings,
  Star,
  Target,
  Radar,
  BookA,
  User,
  X,
} from 'lucide-react';
import { api, API_BASE } from '@/services/api';
import { useStatus } from '@/hooks/queries';
import { useGlobalStream } from '@/hooks/useStream';
import { useAuth } from '@/stores/auth';
import { useLive } from '@/stores/live';
import { useFx, useFxSync } from '@/stores/fx';
import { cn } from '@/utils/cn';
import { fmtDate, fmtNum, fmtPriceSym } from '@/utils/format';

const NAV = [
  { to: '/', label: 'Dasbor', icon: LayoutDashboard, end: true },
  { to: '/planner', label: 'Rencana Trading', icon: Target },
  { to: '/paper', label: 'Paper Trading V2', icon: Radar },
  { to: '/markets', label: 'Pasar', icon: LineChart },
  { to: '/signals', label: 'Sinyal AI', icon: Bot },
  { to: '/watchlist', label: 'Watchlist', icon: Star },
  { to: '/portfolio', label: 'Portofolio', icon: Briefcase },
  { to: '/analysis/BTCUSDT', label: 'Analisa Teknikal', icon: CandlestickChart },
  { to: '/backtest', label: 'Backtest', icon: FlaskConical },
  { to: '/history', label: 'Riwayat Sinyal', icon: History },
  { to: '/alerts', label: 'Peringatan', icon: Bell },
  { to: '/news', label: 'Berita', icon: Newspaper },
  { to: '/glossary', label: 'Kamus Istilah', icon: BookA },
  { to: '/settings', label: 'Pengaturan', icon: Settings },
];

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
        <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
          <path d="M6 22l7-7 4 4 9-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">CryptoInsight</div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Analitik AI</div>
      </div>
    </Link>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="mt-6 flex flex-col gap-0.5" aria-label="Utama">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn('flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors', isActive ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-bg hover:text-ink')
          }
        >
          <n.icon className="h-4 w-4" />
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  return (
    <div className="mt-auto rounded-lg border border-border bg-bg p-3 text-[11px] leading-relaxed text-ink-3">
      <BookOpen className="mb-1 h-3.5 w-3.5" />
      Hanya sinyal analitis — bukan saran keuangan. CryptoInsight AI tidak pernah menempatkan order.
    </div>
  );
}

function CoinSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ['symbols', q],
    queryFn: () => api<{ symbol: string; baseAsset: string }[]>(`/api/market/symbols?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 1,
    staleTime: 60_000,
  });
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const go = (s: string) => {
    setQ('');
    setOpen(false);
    nav(`/analysis/${s}`);
  };
  return (
    <div ref={ref} className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === 'Enter' && data?.[0] && go(data[0].symbol)}
        placeholder="Cari koin..."
        aria-label="Cari koin"
        className="h-9 w-full rounded-lg border border-border bg-bg pr-3 pl-9 text-sm outline-none placeholder:text-ink-3 focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/15"
      />
      {open && q && data && (
        <div className="absolute top-11 z-40 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          {data.length === 0 && <div className="px-3 py-2 text-sm text-ink-3">Pasangan USDT tidak ditemukan</div>}
          {data.slice(0, 8).map((s) => (
            <button key={s.symbol} onClick={() => go(s.symbol)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-bg">
              <span className="font-medium">{s.baseAsset}</span>
              <span className="text-xs text-ink-3">{s.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const items = useLive((s) => s.notifications);
  const markAllRead = useLive((s) => s.markAllRead);
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          markAllRead();
        }}
        aria-label={`Notifikasi (${unread} belum dibaca)`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-bg"
      >
        <Bell className="h-4.5 w-4.5" />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-down ring-2 ring-surface" />}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-lg border border-border bg-surface shadow-lg">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold text-ink-2">Peringatan terpicu</div>
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-ink-3">Belum ada peringatan terpicu di sesi ini.</div>
          ) : (
            items.slice(0, 8).map((n) => (
              <div key={n.id + n.at} className="border-b border-border/60 px-3 py-2 text-xs last:border-0">
                <div className="font-semibold">
                  {n.symbol} · {n.type.replace(/_/g, ' ')}
                </div>
                <div className="text-ink-3">
                  Nilai {n.type.startsWith('PRICE_') ? fmtPriceSym(n.triggeredValue) : fmtNum(n.triggeredValue)} · {fmtDate(n.at)}
                </div>
              </div>
            ))
          )}
          <Link to="/alerts" onClick={() => setOpen(false)} className="block px-3 py-2 text-center text-xs font-medium text-primary hover:bg-bg">
            Kelola peringatan
          </Link>
        </div>
      )}
    </div>
  );
}

function FxBadge() {
  const rate = useFx((s) => s.rate);
  const active = useFx((s) => s.active);
  return (
    <Link to="/settings" className="text-right leading-tight" title={rate ? `Source: ${rate.source}` : 'Kurs IDR belum tersedia'}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Kurs {active === 'IDR' ? 'IDR' : 'USD'}</div>
      <div className="num text-xs font-medium text-ink">{rate ? `1 USDT = Rp ${rate.rate.toLocaleString('id-ID', { maximumFractionDigits: 0 })}` : '–'}</div>
    </Link>
  );
}

function LogoutButton() {
  const qc = useQueryClient();
  const { token, setToken } = useAuth();
  if (!token) return null;
  return (
    <button
      onClick={() => {
        setToken(null);
        qc.clear();
      }}
      className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-bg"
      aria-label="Keluar"
      title="Keluar"
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  const { data: status } = useStatus();
  const lastEvent = useLive((s) => s.lastEvent);
  const connected = status?.binance.connected ?? false;
  const last = useMemo(() => lastEvent ?? (status?.binance.lastSuccess ? new Date(status.binance.lastSuccess).getTime() : null), [lastEvent, status]);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur lg:px-6">
      <button onClick={onMenu} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-bg lg:hidden" aria-label="Buka menu">
        <Menu className="h-5 w-5" />
      </button>
      <CoinSearch />
      <div className="ml-auto flex items-center gap-4">
        <div className="hidden items-center gap-4 md:flex">
          <div className="text-right leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{status?.source === 'mock' ? 'Data mock' : 'Binance'}</div>
            <div className={cn('flex items-center justify-end gap-1.5 text-xs font-medium', connected ? 'text-up' : 'text-down')}>
              <span className={cn('h-2 w-2 rounded-full', connected ? 'bg-up' : 'bg-down')} />
              {connected ? 'Terhubung' : 'Terputus'}
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
          <FxBadge />
          <div className="h-8 w-px bg-border" />
          <div className="text-right leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Pembaruan terakhir</div>
            <div className="num text-xs font-medium text-ink">{fmtDate(last)}</div>
          </div>
        </div>
        <Notifications />
        <Link to="/settings" className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary" aria-label="Profil & pengaturan">
          <User className="h-4 w-4" />
        </Link>
        <LogoutButton />
      </div>
    </header>
  );
}

export function AppLayout() {
  useGlobalStream();
  useFxSync();
  const [menu, setMenu] = useState(false);
  const { data: status, error: statusError } = useStatus();
  const fxActive = useFx((s) => s.active);
  const fxRate = useFx((s) => s.rate?.rate ?? 0);
  const fxPreferred = useFx((s) => s.preferred);
  const fxError = useFx((s) => s.error);
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 lg:flex">
        <Brand />
        <Nav />
        <SidebarFooter />
      </aside>
      <Dialog.Root open={menu} onOpenChange={setMenu}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface px-3 py-5 shadow-xl lg:hidden" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Navigasi</Dialog.Title>
            <div className="flex items-center justify-between">
              <Brand />
              <Dialog.Close className="rounded-lg p-1.5 text-ink-2 hover:bg-bg" aria-label="Tutup menu">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>
            <Nav onNavigate={() => setMenu(false)} />
            <SidebarFooter />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setMenu(true)} />
        {statusError && !status && (
          <div className="border-b border-red-200 bg-down-soft px-4 py-1.5 text-center text-xs font-medium text-red-900">
            Backend API tidak dapat dihubungi{API_BASE ? ` (${API_BASE})` : ''}. Data pasar, analisa, dan backtest membutuhkan backend CryptoInsight yang aktif.
          </div>
        )}
        {status?.mock && (
          <div className="border-b border-amber-200 bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-amber-900">MODE MOCK — data sintetis untuk pengembangan. Bukan harga pasar nyata.</div>
        )}
        {fxPreferred === 'IDR' && fxActive !== 'IDR' && fxError && (
          <div className="border-b border-amber-200 bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-amber-900">Kurs USDT→IDR sedang tidak tersedia — harga sementara ditampilkan dalam USD.</div>
        )}
        {/* Remount when the display currency/rate changes so every formatted value is refreshed */}
        <main key={`${fxActive}-${fxRate}`} className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-5 lg:px-6 lg:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

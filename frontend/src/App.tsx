import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useParams } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { Skeleton } from '@/components/ui/primitives';
import Dashboard from '@/pages/Dashboard';

const CoinDetail = lazy(() => import('@/pages/CoinDetail'));
const Backtest = lazy(() => import('@/pages/Backtest'));
const Markets = lazy(() => import('@/pages/Markets'));
const Signals = lazy(() => import('@/pages/Signals'));
const Watchlist = lazy(() => import('@/pages/Watchlist'));
const Portfolio = lazy(() => import('@/pages/Portfolio'));
const History = lazy(() => import('@/pages/History'));
const Alerts = lazy(() => import('@/pages/Alerts'));
const News = lazy(() => import('@/pages/News'));
const Settings = lazy(() => import('@/pages/Settings'));
const Planner = lazy(() => import('@/pages/Planner'));
const Glossary = lazy(() => import('@/pages/Glossary'));

const page = (el: React.ReactNode) => <Suspense fallback={<Skeleton className="h-96 w-full" />}>{el}</Suspense>;

/** Supports the short URL form /BTCUSDT. */
function SymbolRedirect() {
  const { symbol = '' } = useParams();
  return /^[A-Za-z0-9]{2,20}USDT$/i.test(symbol) ? <Navigate to={`/analysis/${symbol.toUpperCase()}`} replace /> : <Navigate to="/" replace />;
}

// On GitHub Pages the app lives under /<repo>/; BASE_URL comes from Vite's `base`.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/planner', element: page(<Planner />) },
      { path: '/markets', element: page(<Markets />) },
      { path: '/signals', element: page(<Signals />) },
      { path: '/watchlist', element: page(<Watchlist />) },
      { path: '/portfolio', element: page(<Portfolio />) },
      { path: '/analysis/:symbol', element: page(<CoinDetail />) },
      { path: '/backtest', element: page(<Backtest />) },
      { path: '/history', element: page(<History />) },
      { path: '/alerts', element: page(<Alerts />) },
      { path: '/news', element: page(<News />) },
      { path: '/glossary', element: page(<Glossary />) },
      { path: '/settings', element: page(<Settings />) },
      { path: '/:symbol', element: <SymbolRedirect /> },
    ],
  },
], { basename });

export default function App() {
  return <RouterProvider router={router} />;
}

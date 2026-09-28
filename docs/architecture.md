# Architecture

```
Binance REST (spot, futures)      Binance WebSocket (miniTicker, kline)
          │                                     │
          ▼                                     ▼
  BinanceClient ──(failover)──► data-api.binance.vision     MarketStream ──► Redis pub/sub ──► SSE /api/stream ──► Browser
          │
          ▼
  candles.service  ◄──►  PostgreSQL (ohlcv)           CoinGecko (market cap)  alternative.me (Fear & Greed)  CryptoPanic (news, optional)
          │
          ▼
  Technical engine (indicators.ts, price-action.ts, engine.ts)   — causal, pure functions
          │
          ▼
  Scoring (scoring.ts, risk.ts, targets.ts)  ◄── config/scoring.ts
          │
          ├──► Historical similarity + forward returns (historical/similarity.ts)
          ├──► Backtest engine (backtest/*) ◄── BullMQ queue (Redis) ── POST /api/backtest
          ├──► Signal lifecycle (signals/*) ── cron tracker every 5 min
          │
          ▼
  analysis.service: builds structured context ──► Claude (structured JSON) ──► Zod validation ──► consistency enforcement
          │
          ▼
  PostgreSQL (ai_analysis, signals, signal_features, signal_results, technical_indicators) + Redis cache
          │
          ▼
  Fastify REST API ──► React dashboard
```

## Principles

1. **Claude is not a data source.** Every number (price, indicator, level, statistic, backtest metric) is computed by the backend. Claude receives a JSON context and returns interpretation. `analysis/consistency.ts` overwrites any backend-owned number Claude returns (signal, score, historical context, scenario levels, key levels) and records a warning.
2. **No look-ahead.** Indicators are causal (`output[i]` depends only on `input[0..i]`); swing pivots carry a `confirmedAt` index; the backtest executes decisions made at candle *T* on candle *T+1*'s open; strategy contexts throw `LookAheadError` for future indices. See `backend/src/services/backtest/lookahead.test.ts`.
3. **No fake data.** `MOCK_MODE=true` swaps the entire provider (`MockProvider`) and labels everything as mock in API and UI. With `MOCK_MODE=false` there is no code path that returns synthetic market data. If AI is not configured, the UI states so; it never shows a fabricated analysis.
4. **Graceful degradation.** Binance down → 503 with last successful update; Futures geo-blocked → derivatives marked unavailable; Claude down → technical data still served, last valid AI analysis shown with its timestamp; Redis down → in-memory cache + in-process queue; Postgres down → market/analysis/backtests still work (results cached), user features return 503.

## Backend layout

| Path | Responsibility |
|---|---|
| `config/env.ts` | Zod-validated environment |
| `config/scoring.ts` | Weights, signal bands, historical/target thresholds (single source) |
| `config/timeframes.ts` | Supported timeframes, lower-timeframe map, annualisation |
| `services/binance` | REST client with failover + limiter, mock provider, WebSocket stream, service status |
| `services/market` | OHLCV store (Postgres-backed sync), overview, movers, breadth, global market |
| `services/technical` | Indicators, price action, snapshots |
| `services/scoring` | Score, signal, risk, targets, scenarios |
| `services/historical` | Similar-setup search, forward returns, condition study |
| `services/backtest` | Engine, strategies, metrics, data quality, walk-forward, OOS, optimisation, Monte Carlo, job queue |
| `services/signals` | Signal persistence, outcome evaluation, performance aggregation |
| `services/claude` | Anthropic SDK client, prompts, schemas |
| `services/analysis` | Orchestration, market summary, daily table |
| `services/sentiment` | Fear & Greed, news |
| `services/alerts`, `services/portfolio` | Alerts, watchlist, portfolio |
| `jobs/scheduler.ts` | Analysis cycle, signal tracker, price-alert listener |
| `routes/*` | HTTP endpoints (thin; no business logic) |

## Realtime

Backend subscribes to Binance combined streams (`<sym>@miniTicker`, `<sym>@kline_<analysisTf>`), publishes to Redis channels, and the browser receives them over one SSE connection. Charts request an extra kline stream (`/api/stream?kline=BTCUSDT:1h`), ref-counted on the backend via Binance `SUBSCRIBE`/`UNSUBSCRIBE`. The WebSocket reconnects with exponential backoff and alternates to the public mirror.

Indicators are recomputed per closed candle (cached by candle open time). AI runs on a 15-minute cron but only calls Claude for a coin when a new candle has closed, and refreshes the market summary at most every `AI_MARKET_SUMMARY_MINUTES` — or on "Analyze Now".

## Single user

Version 1 is a self-hosted, single-user app: a local user is seeded by the migration and owns the watchlist, portfolio and alerts. There is no authentication; do not expose it publicly without adding an auth proxy.

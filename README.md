# CryptoInsight AI

AI crypto analytics, signal and backtesting platform. It pulls market data from **Binance**, computes indicators, scores, levels, historical statistics and backtests **in the backend**, and uses **Claude** only to interpret that structured data in plain language.

> CryptoInsight AI is **not a trading bot**. It never places orders. Signals (STRONG BUY … STRONG SELL) are analytical, not a guarantee of profit. Historical performance does not guarantee future results.

## Project Overview

| Question | Where it is answered |
|---|---|
| What is the market condition now? | Dashboard → AI Market Summary, market-wide breadth, dominance, movers |
| Which assets have an interesting setup? | AI Daily Analysis / AI Signals (score, signal, upside/downside, risk) |
| Why this signal? | Coin page → reasons/risks, score breakdown, indicator table |
| Potential upside / downside? | Levels & targets from support/resistance, swings, Bollinger, ATR |
| How did similar setups behave historically? | Historical similarity: sample size, positive rate, forward returns |
| How does the strategy perform historically after fees & slippage? | Backtest (equity, drawdown, trades, MFE/MAE, monthly, Monte Carlo) |
| Does it hold out-of-sample / walk-forward? | Backtest modes with overfitting warnings |
| How have live signals performed? | Signal History + performance by coin / signal / timeframe / regime |

## Architecture

See [docs/architecture.md](docs/architecture.md).

```
Binance (REST + WebSocket) → Market service → Postgres (OHLCV) / Redis
   → Technical engine → Scoring → Historical similarity → Backtest engine
   → Structured context → Claude (JSON) → Zod + consistency checks → API → React dashboard (SSE live prices)
```

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, shadcn-style components (Radix primitives), TanStack Query, Zustand, lightweight-charts (candles/indicators), Recharts (backtest charts), Lucide icons.
- **Backend:** Node.js, TypeScript, Fastify, Zod, SSE, `ws` (Binance stream), BullMQ, node-cron, pino.
- **Database:** PostgreSQL 16 + Drizzle ORM (SQL migrations in `database/migrations`).
- **Cache / queue:** Redis 7.
- **AI:** Anthropic Claude via `@anthropic-ai/sdk` (structured JSON outputs).

## Installation

### Docker (recommended)

```bash
cp .env.example .env     # add ANTHROPIC_API_KEY (optional), change POSTGRES_PASSWORD
docker compose up -d --build
# → http://localhost:8080
```

### Local development

Requirements: Node 22+, PostgreSQL 16, Redis 7 (both optional in dev: the backend falls back to in-memory cache/queue and disables user features without a DB).

```bash
npm run install:all
cp .env.example backend/.env         # adjust DATABASE_URL / REDIS_URL
npm run dev:backend                  # http://localhost:3000
npm run dev:frontend                 # http://localhost:5173 (proxies /api)
```

Offline: set `MOCK_MODE=true` for deterministic synthetic data (clearly labelled "MOCK MODE" in the UI; never mixed with real data).

## Environment Variables

All variables are documented in [.env.example](.env.example). Key ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Storage |
| `BINANCE_API_URL`, `BINANCE_API_FALLBACK_URL`, `BINANCE_WS_URL`, `BINANCE_WS_FALLBACK_URL`, `BINANCE_FUTURES_API_URL`, `BINANCE_FUTURES_WS_URL` | Configurable Binance endpoints |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` | Claude (backend only) |
| `AI_PROVIDER`, `AI_COMPAT_*` | Use an OpenAI-compatible provider instead of Claude (e.g. Google Gemini free tier) |
| `AI_LANGUAGE` | `id` (Bahasa Indonesia) or `en` |
| `TRACKED_SYMBOLS`, `ANALYSIS_TIMEFRAME` | Coins/timeframe for the dashboard and jobs |
| `AI_ANALYSIS_CRON`, `SIGNAL_TRACKER_CRON`, `AI_MARKET_SUMMARY_MINUTES` | Job cadence & AI cost control |
| `APP_TIMEZONE` | Default `Asia/Jakarta` |
| `MOCK_MODE` | `false` in production |

## Binance API

Public market data only (no API key, no trading). Spot: 24h tickers, klines (paginated), order book, exchange info, combined WebSocket streams. Futures (if reachable): funding, open interest (+24h change), global long/short ratio, futures volume. Requests are rate-limited in-process (6 concurrent) and fail over to Binance's public market-data mirror. Binance does not publish market cap, so total market cap and dominance come from CoinGecko (optional); per-coin market cap is shown as unavailable.

## Claude API

`claude-opus-5` by default with adaptive thinking and structured JSON output. Claude receives only backend-computed context and cannot change any number — see [docs/ai-analysis.md](docs/ai-analysis.md). Without an API key the platform works fully; AI panels state "AI analysis not configured".

Alternative provider: set `AI_PROVIDER=openai-compatible` with `AI_COMPAT_API_KEY` (and optionally `AI_COMPAT_BASE_URL` / `AI_COMPAT_MODEL`). The default points at Google Gemini's OpenAI-compatible endpoint (`gemini-3.1-flash-lite`; any model from its `/models` list works), which has a free tier (key from https://aistudio.google.com/apikey). The same prompts, JSON schema, validation and consistency checks apply. If a provider does not support `json_schema` structured output, set `AI_COMPAT_JSON_MODE=json_object`.

## Database

Tables: `users, coins, market_snapshots, ohlcv, technical_indicators, ai_analysis, signals, signal_results, signal_features, backtests, backtest_trades, backtest_equity, backtest_metrics, strategies, watchlists, portfolio, portfolio_transactions, alerts, news, sentiment`. Migrations run automatically at startup.

## Redis

Ticker/overview/indicator/AI caching, pub/sub fan-out of the Binance stream to SSE clients, BullMQ backtest queue, and distributed rate limiting.

## Technical Indicators & Scoring Engine

SMA20/50/200, EMA20/50, ADX, RSI, MACD, Stochastic RSI, ROC, Bollinger, ATR, historical volatility, volume MA, OBV, swing structure, breakout/breakdown, clustered support/resistance. Weighted 0–100 score configured in `backend/src/config/scoring.ts`. Details: [docs/technical-analysis.md](docs/technical-analysis.md).

## AI Analysis

Market summary, daily analysis table, per-coin analysis with reasons, risks, scenarios, historical evidence and a confidence value that is explicitly **not** a probability. Runs every 15 minutes (Claude called once per closed candle per coin) and on "Analyze Now".

## Backtest Engine

Modular strategies (`ma-rsi-macd`, `trend-following`, `momentum`), next-open execution, fees + slippage on both sides, stop-loss/take-profit with gap handling and lower-timeframe intrabar resolution, equity/drawdown, full metrics, MFE/MAE, monthly returns, regime breakdown, Monte Carlo, data-quality gate, queued jobs, CSV export. Details: [docs/backtesting.md](docs/backtesting.md).

## Historical Signal Performance

Every signal on a closed candle is stored with a feature snapshot and tracked through `PENDING → OPEN → TARGET_HIT | STOP_HIT | TIMEOUT | INVALIDATED | AMBIGUOUS` (24-candle window, lower-timeframe resolution of same-candle hits). Performance is aggregated overall and by coin, signal, timeframe and market condition. The historical query answers questions like *"BUY BTC when RSI 50–70, MACD bullish, price > MA50"*.

## Walk-Forward Testing

Rolling train/test windows (default 90/30 days); optional grid search on the training window only; compounded out-of-sample equity; in-sample vs out-of-sample comparison with overfitting warnings; capped, reported search space.

## Risk Metrics

Max drawdown, VaR 95%, average/largest loss, max consecutive losses, realised reward/risk, volatility, MFE/MAE, Monte Carlo drawdown probabilities, with warnings for high volatility, high drawdown, low sample size and poor out-of-sample performance.

## API Documentation

[docs/api.md](docs/api.md)

## Docker

`docker compose up -d` starts `frontend` (nginx, port 8080), `backend`, `postgres`, `redis`. The frontend can also be deployed to **GitHub Pages** via GitHub Actions with the backend hosted separately — see [docs/deployment.md](docs/deployment.md).

## Testing

```bash
npm run build   # backend tsc + frontend tsc/vite
npm run test    # backend (vitest, 70 tests) + frontend
```

Backend coverage: indicators (RSI reference data, MACD, MA/EMA, Bollinger, ATR, causality), scoring (bullish/bearish/neutral, bands, targets, scenarios), backtesting (next-open entry/exit, SL/TP, gaps, ambiguity, fees, slippage, position size, drawdown, ROI, MFE/MAE, data quality, walk-forward, OOS, grid limits, Monte Carlo), **no look-ahead bias** (including the Day1/Day2/Day3 case), signal outcomes, alerts, portfolio accounting, Claude (valid JSON, invalid JSON, missing fields, API error, timeout, refusal, truncation, caching, consistency enforcement), and API integration in mock mode.

## Production Deployment

See [docs/deployment.md](docs/deployment.md): TLS, `APP_PASSWORD` login, strong DB password, single backend replica, volume backups.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Header shows **Disconnected** / 503 `BINANCE_UNAVAILABLE` | Network blocks Binance. The backend already fails over to `data-api.binance.vision`; check `/api/status` and outbound firewall. |
| Derivatives "unavailable" | Binance Futures is geo-restricted from your server's region. |
| "AI analysis not configured" | Set `ANTHROPIC_API_KEY` (or `AI_PROVIDER=openai-compatible` + `AI_COMPAT_API_KEY`) and recreate the backend container. |
| "AI analysis temporarily unavailable" | Claude timeout, rate limit or invalid output; technical data still works; see backend logs (`AI coin analysis failed`). |
| Watchlist/Portfolio/Alerts return 503 | PostgreSQL not reachable (`DATABASE_URL`). |
| Backtest fails with "Data quality warning" | More than 5% missing/invalid candles in the range — choose a different period/timeframe. |
| Backtest fails with "Insufficient historical data" | Fewer than 30 candles in the selected window, or the symbol is too new. |
| Few or no signals in Signal History | Signals are recorded on closed candles by the 15-minute job; 4H means ~6 per coin per day. |

# API Reference

Base URL: `/api` (proxied by nginx in Docker; `http://localhost:3000/api` directly). JSON everywhere. Errors: `{ error, message, details? }`. Validation errors → 400 with `details[]`. Binance outage → 503 `BINANCE_UNAVAILABLE` with `lastSuccessfulUpdate`. Rate limit: `RATE_LIMIT_MAX`/min per IP (stricter on AI and backtest POSTs).

Timeframes: `1m 5m 15m 1h 4h 1d 1w` (`1D`/`1W` accepted). Backtests: `15m 1h 4h 1d`.

## System
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/status` | Data source, Binance/Futures/WebSocket/Claude/DB/Redis status with last success |
| GET | `/config` | Timeframes, scoring weights & bands, strategies, thresholds, tracked symbols |
| GET | `/stream[?kline=BTCUSDT:1h]` | Server-Sent Events: `hello`, `ticker`, `kline`, `candle-closed`, `alert` |
| GET | `/news[?coin=BTC]` | News & vote-based sentiment (requires `CRYPTOPANIC_API_KEY`) |
| GET | `/sentiment` | Fear & Greed + news sentiment breakdown |

## Market
| Method | Path | Description |
|---|---|---|
| GET | `/market/overview` | Tracked cards (price, 24h %, volume, sparkline), global market cap & dominance, breadth, gainers/losers/volatile |
| GET | `/market/global` | CoinGecko global + Fear & Greed |
| GET | `/market/ticker/:symbol` | 24h ticker (live price overlay from WebSocket) |
| GET | `/market/klines/:symbol?timeframe=4h&limit=500&indicators=true` | OHLCV (+ live candle) and optional SMA20/50/200, Bollinger, RSI, MACD, volume MA arrays |
| GET | `/market/orderbook/:symbol` | Top 20 bids/asks |
| GET | `/market/derivatives/:symbol` | Funding, OI, OI change, long/short, futures volume (`available:false` if blocked) |
| GET | `/market/gainers` `/losers` `/volatility` `?limit=` | Movers among liquid USDT pairs |
| GET | `/market/symbols?q=` | Symbol search |

## Analysis
| Method | Path | Description |
|---|---|---|
| GET | `/analysis/status` | AI configuration |
| GET | `/analysis/summary` | Market-wide context + AI market summary (cached/rate-limited) |
| POST | `/analysis/summary` | Force-refresh the AI market summary |
| GET | `/analysis/daily?timeframe=4h` | AI Daily Analysis table rows |
| GET | `/analysis/:symbol?timeframe=4h` | Full technical analysis + stored AI (never calls Claude) |
| POST | `/analysis/:symbol?timeframe=4h` body `{force?:boolean}` | "Analyze Now" — runs Claude (cache reused unless `force`) |

## Signals
| Method | Path | Description |
|---|---|---|
| GET | `/signals?signal=&status=&timeframe=&from=&to=&limit=&offset=` | Signal history with feature snapshot & outcome |
| GET | `/signals/:symbol` | Same, one symbol |
| GET | `/signals/performance[?timeframe=]` | Overall + by coin / signal / timeframe / market condition |
| GET | `/signals/query?symbol=BTCUSDT&timeframe=4h&signal=BUY&rsiMin=50&rsiMax=70&macd=bullish&priceAboveMa50=true&horizon=6` | Historical condition study: sample size, win rate, avg/median/best/worst return, holding time, max drawdown |

## Backtest
| Method | Path | Description |
|---|---|---|
| GET | `/backtest/strategies` | Strategy catalogue & default params |
| GET | `/backtest` | Recent runs |
| POST | `/backtest` | Queue a run → `202 {jobId, status:"QUEUED"}` |
| GET | `/backtest/:id` | Status, progress, request, result (summary, monthly, regimes, distribution, Monte Carlo, OOS / walk-forward / matrix) |
| GET | `/backtest/:id/trades` | Trade log |
| GET | `/backtest/:id/equity` | Equity curve |
| GET | `/backtest/:id/drawdown` | Peak, equity, drawdown % |
| GET | `/backtest/:id/metrics` | Metrics |
| GET | `/backtest/:id/export` | Trades CSV |

Request:
```json
{
  "symbol": "BTCUSDT", "timeframe": "4h", "strategy": "ma-rsi-macd",
  "startDate": "2026-04-01T00:00:00Z", "endDate": "2026-09-27T00:00:00Z",
  "initialCapital": 10000, "positionSize": 0.1, "stopLoss": 0.05, "takeProfit": 0.1,
  "fee": 0.001, "slippage": 0.0005,
  "mode": "standard | out-of-sample | optimization | walk-forward | matrix",
  "params": { "rsiMin": 50 },
  "outOfSample": { "splitRatio": 0.7 },
  "walkForward": { "trainDays": 90, "testDays": 30 },
  "optimization": { "ranges": { "rsiMin": { "min": 45, "max": 55, "step": 5 } }, "objective": "sharpe", "maxCombinations": 100 },
  "matrix": { "symbols": ["BTCUSDT", "ETHUSDT"], "timeframes": ["1h", "4h", "1d"] },
  "monteCarlo": { "iterations": 1000, "drawdownThreshold": 20 }
}
```

## Watchlist / Portfolio / Alerts (require PostgreSQL)
| Method | Path | Body |
|---|---|---|
| GET | `/watchlist` | – |
| POST | `/watchlist` | `{symbol}` |
| DELETE | `/watchlist/:symbol` | – |
| GET | `/portfolio` | – (summary, positions, transactions) |
| POST | `/portfolio/transaction` | `{symbol, side: BUY|SELL, quantity, price, executedAt?, note?}` |
| DELETE | `/portfolio/transaction/:id` | – |
| GET | `/alerts` | – |
| POST | `/alerts` | `{symbol, type, value?}` — types `PRICE_ABOVE PRICE_BELOW RSI_ABOVE RSI_BELOW SCORE_ABOVE SCORE_BELOW SIGNAL_BUY SIGNAL_STRONG_BUY SIGNAL_SELL` |
| DELETE | `/alerts/:id` | – |
